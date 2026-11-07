import {backgroundAllowed,backgroundScore,candidatePlaces} from './background-policy.mjs';
import {npcCandidates,npcActorsFrom} from './npc.mjs';
const own=(object,key)=>Object.hasOwn(object??{},key);
export function selectCandidates(parsed,pack,previous={}) {
  const text=parsed.fragments.map(f=>f.raw).join('\n');
  const prior=Object.values(previous),names=new Set(prior.flatMap(s=>[...(s.present??[]),...(s.remote??[])])),priorIds=new Set(prior.flatMap(s=>[...(s.display??[]),...(s.communication??[])]));
  const place=prior.map(s=>s.place??'').join(' '),nodes=new Set(prior.map(s=>s.nodeId).filter(Boolean));
  const eligible=(pack.assets??[]).filter(a=>a.eligible);
  const matched=Object.entries(pack.characters).filter(([id,c])=>!c.npcBinding&&(!pack.npcPortraits?.[id]||priorIds.has(id))).map(([id,c])=>{const aliases=Object.entries(pack.aliases).filter(([,target])=>target===id).map(([n])=>n);return {id,c,score:priorIds.has(id)||names.has(c.name)?100:c.playerOnly||pack.currentPlayerId===id?90:[c.name,...aliases].some(n=>mentions(text,n))?20:0};}).filter(x=>x.score>0&&x.c.autoEligible!==false).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  // Candidate coverage is per reply, not a limit on the people shown in one scene.
  // Keep every confirmed match; prior actors/player priority must not evict new speakers.
  const chosen=matched,assets=[];
  const characters=chosen.map(({id,c})=>{
    const available=eligible.filter(a=>a.characterId===id),priorVariants=prior.map(s=>s.variants?.[id]).filter(Boolean);
    const selected=[];for(const v of [c.default,...priorVariants]){const a=available.find(a=>(a.variant??(a.id.includes('#')?a.id.split('#').at(-1):'default'))===v);if(a&&!selected.includes(a))selected.push(a);}
    for(const a of available.sort((a,b)=>expressionScore(b.description,text)-expressionScore(a.description,text)||a.id.localeCompare(b.id)))if(selected.length<4&&!selected.includes(a))selected.push(a);
    assets.push(...selected);return {id,name:c.name,aliases:Object.entries(pack.aliases).filter(([n,target])=>target===id&&n!==c.name).map(([n])=>n),outfit:c.outfit??null,defaultVariant:c.default,variants:selected.map(a=>({id:a.id,variant:a.variant??(a.id.includes('#')?a.id.split('#').at(-1):'default'),description:a.description,composition:a.composition,emotion:null}))};
  }).filter(c=>c.variants.length);
  const locations=candidatePlaces(parsed,previous);
  const scenery=parsed.fragments.filter(f=>f.kind==='narration').map(f=>f.raw.replace(/[「『“\"].*?[」』”\"]/gs,'')).join('\n');
  const backgrounds=eligible.filter(a=>a.type==='background'&&(!a.scenePolicy?.requiredPlaceTerms?.length||locations.some(p=>backgroundAllowed(a,p)))&&(a.id!=='bg_black'||/黑底|纯黑画面/.test(text)||prior.some(s=>s.background==='bg_black'))).map(a=>({a,score:prior.some(s=>s.background===a.id&&backgroundAllowed(a,s.place))?100:Math.max(0,...locations.map(p=>backgroundScore(a,p)))*4+environmentScore(a,scenery,'')})).sort((a,b)=>b.score-a.score||a.a.id.localeCompare(b.a.id)).filter((x,i)=>x.score>0||['21_G3_victoria_street_d','21_G1_interrogat_room','bg_warehouse','bg_wilderness_1'].includes(x.a.id)).slice(0,6).map(({a})=>{assets.push(a);return {id:a.id,name:a.name,description:a.description,place:a.place,lighting:a.lighting,timeOfDay:a.timeOfDay,physicalPlaceKnown:a.physicalPlaceKnown,scenePolicy:a.scenePolicy,restrictions:a.provenance?.restrictions??[]};});
  const illustrations=eligible.filter(a=>a.type==='illustration'&&canUseIllustration(a.id,parsed,pack)).slice(0,2).map(a=>{assets.push(a);return {id:a.id,description:a.description,restrictions:a.provenance?.restrictions??[],usage:'仅正文明确符合该情节时使用；不能据图补造事实，不是背景/立绘'};});
  return {characters,backgrounds,illustrations,npcPortraits:npcCandidates(parsed,pack,previous),knownNPCs:npcActorsFrom(previous),withoutPortrait:(pack.withoutPortrait??[]).filter(n=>!own(pack.aliases,n)),assetCount:assets.length,characterCount:characters.length,backgroundCount:backgrounds.length,illustrationCount:illustrations.length,nodes:[],evidence:'仅确定性筛选；原作脚本不提交模型。外观描述不是官方情绪。每轨道按正文判定，不强制原作路线。'};
}
const mentions=(text,name)=>!!name&&(name.length>1?text.includes(name):new RegExp('(^|[\\s「『“，。！？：:、])'+name+'(?=[\\s」』”，。！？：:、]|说|问|答|走|看|抬|转|站)').test(text));
// Advisory only: valid cached annotations remain readable and unchanged.
// This checks consistency within the annotation, not whether its story interpretation is true.
export function portraitDiagnostics(rows,pack){
  const idFor=name=>Object.entries(pack.npcActors??{}).find(([,a])=>a.name===name)?.[0]??pack.aliases?.[name]??Object.entries(pack.characters??{}).find(([,c])=>c.name===name)?.[0];
  const samePerson=(name,speaker,id)=>name===speaker||!!id&&idFor(name)===id;
  const notes=[];
  for(const r of rows??[]){
    if(r.fallback||r.kind!=='dialogue'||!r.speaker||r.illustration)continue;
    const id=idFor(r.speaker),c=pack.characters?.[id];
    if(c?.playerOnly||!(r.present??[]).some(n=>samePerson(n,r.speaker,id))||(r.remote??[]).some(n=>samePerson(n,r.speaker,id))||(id&&(r.communication??[]).includes(id)))continue;
    const usable=c&&c.autoEligible!==false&&Object.keys(c.variants??{}).some(v=>c.variantInfo?.[v]?.eligible!==false);
    if(!usable)notes.push({id:r.id,speaker:r.speaker,characterId:null,reason:'no-portrait'});
    else if(!(r.display??[]).includes(id))notes.push({id:r.id,speaker:r.speaker,characterId:id,reason:'not-displayed'});
  }
  return notes;
}
const expressionScore=(description='',text='')=>[['闭合','闭眼'],['睁大','睁大'],['张开','张口'],['上扬','微笑'],['红晕','脸红'],['下压','皱眉'],['一只眼','眨眼']].reduce((n,[a,b])=>n+(description.includes(a)&&text.includes(b)?3:0),0);
export function environmentScore(asset,text='',place=''){
  const source=[asset.label,asset.name,asset.description,...(asset.matchTerms??[])].filter(Boolean).join(' ');
  const terms=['仓库','货架','办公室','办事处','街巷','街道','废墟','舰桥','控制室','走廊','食堂','安全屋','医疗','大厅','机柜','货舱','雪地','雪原','木屋','森林','树林','山坡','荒坡','村庄','宴会','会客室','塔台','燃烧','审讯','窗户'];
  let score=terms.reduce((n,t)=>n+(source.includes(t)?(place.includes(t)?8:0)+(text.includes(t)?2:0):0),0);
  const dark=/夜|暗色|昏暗砖石/.test(source),night=/夜晚|夜间|深夜|午夜/.test(place+' '+text),day=/白昼|白天|正午|上午/.test(place+' '+text);
  if(night&&dark)score+=3;if(day&&dark)score-=4;if(night&&/白昼/.test(source))score-=4;return score;
}
export function canUseIllustration(id,parsed,pack){
  if(!pack.illustrationPolicies)return true;
  if(!pack.illustrationPolicies[id]?.automatic)return false;
  const text=parsed.fragments.map(f=>f.raw).join('\n');
  return id==='21_I14'&&/琴柳|简妮|简·薇洛/.test(text)&&text.includes('阿米娅')&&/交谈|对话|谈话/.test(text)&&/挂衣|衣架|衣帽间/.test(text);
}
export function expandRows(parsed,response,initial={},pack={}) {
  if(!Array.isArray(response?.rows))return response;
  const tracks=structuredClone(initial);
  return {...response,rows:response.rows.map((row,i)=>{
    const f=parsed.fragments[i]??{},s=tracks[f.track]??={present:[],display:[],variants:{},communication:[],remote:[],place:null,background:null};
    const r={...row};
    for(const key of ['present','display','variants','communication','remote'])r[key]=r[key]??structuredClone(s[key]??(key==='variants'?{}:[]));
    for(const key of ['present','remote','referenced'])if(Array.isArray(r[key]))r[key]=r[key].map(name=>pack.characters?.[name]?.name??name);
    if(r.variants&&typeof r.variants==='object'&&!Array.isArray(r.variants))r.variants={...(s.variants??{}),...r.variants};
    r.speaker=r.speaker??f.speakerHint??'';r.kind=r.kind??f.kind??'narration';r.sceneChange=r.sceneChange??false;r.visualChange=r.visualChange??r.sceneChange;
    r.background=r.background??null;r.place=r.sceneChange?(r.place??null):s.place??null;r.referenced=r.referenced??[];r.focus=r.focus??null;r.front=r.front??null;r.illustration=r.illustration??null;
    if(r.visualChange||r.sceneChange)s.background=r.background;
    Object.assign(s,{present:r.present,display:r.display,variants:r.variants,communication:r.communication,remote:r.remote,place:r.place});
    return r;
  })};
}
export function validateStage(r,pack) {
  const validId=id=>own(pack.characters,id)&&Object.values(pack.characters[id].variantInfo??{}).some(v=>v.eligible!==false);
  for(const key of ['present','referenced','remote'])if(!Array.isArray(r[key])||r[key].some(x=>typeof x!=='string'||x.length>80))throw Error(key+'列表不合法');
  if(!Array.isArray(r.communication)||r.communication.some(id=>!validId(id)))throw Error('通讯素材不合法');
  if(r.present.some(name=>r.remote.includes(name)))throw Error('通讯/画外人物不能同时算作同地在场');
  for(const id of r.display)if(!validId(id)||r.communication.includes(id)||r.remote.includes(pack.characters[id]?.name)||!r.present.includes(pack.characters[id]?.name))throw Error('画面人物必须是可自动选用且明确同地在场，不能仅提及或通讯');
  for(const id of r.communication)if(!r.remote.includes(pack.characters[id]?.name))throw Error('通讯窗人物必须属于remote');
  for(const [id,v] of Object.entries(r.variants))if(pack.characters[id]?.variantInfo?.[v]?.eligible===false)throw Error('未确认差分不能自动选择');
  if(r.place!==null&&(typeof r.place!=='string'||r.place.length>200))throw Error('地点不合法');
  if(r.background==='bg_black'&&r.place&&/^(?:黑色?房间|黑底|bg_black|纯黑背景)$/.test(r.place))throw Error('黑底不是物理地点');
  if(r.kind==='communication'&&r.focus!==null)throw Error('通讯说话不能高亮同地立绘');
}
