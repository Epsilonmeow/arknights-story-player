const named=c=>c.shared_npc===false&&(c.name_kind==='named_identity'||c.name_status==='confirmed_from_script')&&!!c.name;
const backgroundTerms={
  '21_G9_rhodes_xqoffice':['办事处','办公室'],'21_G7_decisivebattlealley_d':['白昼街巷','白天街巷','砖石街巷','街巷'],'21_G6_decisivebattlealley_n':['夜间街巷','夜晚街巷','昏暗街巷'],
  '21_G4_victoria_street_d_ruins':['白昼街道废墟','街道废墟','废墟街道'],'21_G5_victoria_street_n_ruins':['夜间街道废墟','暗色街道废墟'],'21_G2_opera_room':['地图室','作战室'],
  bg_offce:['深色办公室'],bg_ltroom:['会客室'],bg_manorindoor:['宴会厅','宴会长桌'],'21_G8_cammunibase':['燃烧的塔台','塔台区域'],bg_windows:['室内窗边','明亮窗户'],
  bg_corridor:['设备走廊'],bg_canteen:['食堂'],bg_safehouseindoor:['安全屋'],bg_aircraft_2:['舱内向外'],bg_bridge:['舰桥','控制室'],bg_hall_2:['华丽大厅','柱廊大厅'],
  bg_motorroom:['机柜通道','机房'],bg_infirmary:['医疗室','医务室','诊疗室'],bg_lock_1:['白红隔间'],bg_aircraft:['货舱'],bg_snowconutry_4:['雪地村落','雪地木屋'],bg_snowconutryinside:['木屋内','木屋餐厅'],bg_snow_2:['雪原']
};
export const variantKey=a=>a.id.includes('#')?a.id.split('#').at(-1):a.id.includes('$')?'default$'+a.id.split('$').at(-1):'default';
export function mergeChapter(base,library={},backgrounds={}){
  const pack=structuredClone(base),sourceGroups=new Map((library.characters??[]).map(c=>[c.id,c])),canonical=new Map(),groupIds={},poses={};
  pack.illustrations??={};pack.illustrationPolicies={};pack.assetSignatures={};
  for(const [id,c]of Object.entries(pack.characters))canonical.set(c.name,id);
  for(const c of library.characters??[]){
    const isNamed=named(c),legacy=!!base.characters[c.id],galleryOnly=!c.name||c.shared_npc===true;
    if(galleryOnly){groupIds[c.id]=null;continue;}
    const id=isNamed?(canonical.get(c.name)??c.id):c.id;groupIds[c.id]=id;if(isNamed)canonical.set(c.name,id);
    const defaultAsset=(library.assets??[]).find(a=>a.id===c.default_asset_id);if(!defaultAsset)continue;
    const prefix=id!==c.id?c.id+':':'';
    pack.characters[id]??={name:c.name,default:prefix+variantKey(defaultAsset),variants:{},variantInfo:{},outfit:c.outfit?.description??null};
    const target=pack.characters[id];target.autoEligible=isNamed||legacy;target.playerEligible=isNamed;target.sourceGroups=[...new Set([...(target.sourceGroups??[]),c.id])];
    if(isNamed){for(const name of [c.name,c.real_name,...(c.aliases??[]).map(x=>x.name)].filter(Boolean)){if(!pack.aliases[name]||pack.aliases[name]===id)pack.aliases[name]=id;}}
    const ref=(library.calibration??[]).find(x=>x.character_id===c.id);
    if(ref?.head_bbox){const [l,t,r,b]=ref.head_bbox;poses[id]??={canvas:ref.canvas,headTop:[(l+r)/2,t],headHeight:b-t,source:'manual group reference; approximate, not native screen scale',variants:{}};}
    else if(ref?.method==='nonhuman_composition_reference')poses[id]={nonhuman:true,canvas:ref.canvas};
  }
  const registered=[];
  for(const source of library.assets??[]){
    const group=sourceGroups.get(source.character_id),id=groupIds[source.character_id];
    const legacy=base.assets.find(a=>a.id===source.id);
    const auto=source.type==='character'?!!id&&pack.characters[id].autoEligible===true:source.type==='background'?source.id!=='bg_black':source.id==='21_I14';
    const prefix=source.type==='character'&&id&&id!==source.character_id?source.character_id+':':'';
    const a={id:source.id,originalId:source.id,type:source.type,name:source.name??null,characterId:id??null,variant:prefix+variantKey(source),file:source.file,sha256:source.sha256,size:source.size,eligible:auto,manualOnly:!auto,description:source.description,label:source.display_label??source.name??source.id,outfit:group?.outfit?.description??null,composition:source.composition?.kind,uses:source.uses,provenance:{source:source.source,identity:group?.name_evidence??source.name_evidence??[],restrictions:source.usage_restrictions??[]},matchTerms:backgroundTerms[source.id]??source.suitable_scenes??[],place:source.name??null,timeOfDay:source.time_of_day??null,lighting:source.lighting??null};
    if(source.type==='character'&&id){const c=pack.characters[id],v=a.variant;c.variants[v]??=a.file;c.variantInfo[v]??={assetId:a.id,description:a.description,composition:a.composition,eligible:auto};
      const ref=source.head_bbox;if(ref&&source.composition?.kind==='whole_body_replacement'&&poses[id]){const [l,t,r,b]=ref;poses[id].variants??={};poses[id].variants[v]={canvas:source.size,headTop:[(l+r)/2,t],headHeight:b-t};}
    }
    if(source.type==='background')pack.backgrounds[a.id]??=a.file;
    if(source.type==='illustration'){pack.illustrations[a.id]=a.file;pack.illustrationPolicies[a.id]={automatic:auto,restrictions:a.provenance.restrictions};}
    if(legacy){const existing=pack.assets.find(x=>x.id===a.id);Object.assign(existing,{variant:legacy.id.includes('#')?legacy.id.split('#').at(-1):'default',uses:a.uses,matchTerms:a.matchTerms,manualOnly:a.manualOnly});}
    else pack.assets.push(a);
    registered.push(a);
  }
  // The three non-chapter generic scenes remain available; catalog art is never a stage background.
  for(const e of backgrounds.entries??[]){if(!e.priority||pack.backgrounds[e.id])continue;pack.backgrounds[e.id]=e.file;pack.assets.push({id:e.id,type:'background',file:e.file,name:e.label,description:e.visibleEnvironment,eligible:true,matchTerms:e.matchTerms,sha256:e.sha256??null});}
  for(const a of pack.assets){const c=a.characterId?pack.characters[a.characterId]:null;pack.assetSignatures[a.id]=JSON.stringify([a.sha256??a.file,a.characterId??null,c?.name??null,a.eligible!==false,a.composition??null]);}
  pack.chapterRegistry=registered;pack.chapterGroups=library.characters??[];
  const backgroundEntries=registered.filter(a=>a.type==='background'&&backgroundTerms[a.id]).map(a=>({id:a.id,file:a.file,label:(a.label??a.id)+'（近似画面）',originalAssetId:a.id,matchTerms:a.matchTerms,priority:1}));
  return {pack,poses,backgroundEntries,counts:{total:registered.length,automatic:registered.filter(a=>a.eligible).length,restricted:registered.filter(a=>!a.eligible).length,autoCharacters:registered.filter(a=>a.type==='character'&&a.eligible).length,autoGroups:new Set(registered.filter(a=>a.type==='character'&&a.eligible).map(a=>a.characterId)).size,restrictedCharacters:registered.filter(a=>a.type==='character'&&!a.eligible).length,backgrounds:registered.filter(a=>a.type==='background'&&a.eligible).length,illustrations:registered.filter(a=>a.type==='illustration'&&a.eligible).length}};
}
export function referencedAssets(rows,initial,pack){
  const refs={};const add=id=>{if(id&&pack.assetSignatures?.[id])refs[id]=pack.assetSignatures[id];};
  for(const s of [...Object.values(initial??{}),...(rows??[])]){
    add(s.background);add(s.illustration);for(const id of [...(s.display??[]),...(s.communication??[])]){const c=pack.characters[id],v=s.variants?.[id]??c?.default;if(c?.variantInfo?.[v]?.assetId)add(c.variantInfo[v].assetId);}
  }return refs;
}
export function assetRecordMatches(record,pack){return !record?.assetRefs||Object.entries(record.assetRefs).every(([id,signature])=>pack.assetSignatures?.[id]===signature);}
