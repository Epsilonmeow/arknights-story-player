// User-reviewed reusable appearances (2026-11-07/08). Original chapter evidence stays intact.
export const NPC_CATALOG = [
  {id:'avg_npc_242',label:'普通青年男性',role:'civilian-male',faction:null,terms:['青年','居民','平民','男人','男性'],restriction:'扁帽、衬衣、背心、长裤与尾巴；只用于外观相容的成年平民，不用于儿童或军装人物。'},
  {id:'avg_npc_243',label:'女性居民',role:'civilian-female',faction:null,terms:['女性','女人','居民','母亲'],restriction:'帽子、披肩、长裙与尾巴；需外观相容，不自动等同某位母亲或据图判定悲伤。'},
  {id:'avg_npc_176',label:'礼服商人',role:'merchant',faction:null,terms:['商人','宴会','宾客'],restriction:'礼帽、西装、宽厚体态、手持酒杯；不适合所有商贩，不给人物添加贪婪性格。'},
  {id:'avg_npc_241',label:'维多利亚士兵',role:'soldier',faction:'维多利亚',terms:['士兵','卫兵','驻军','巡逻兵'],restriction:'仅限维多利亚；军大衣、兽耳与短发，不替代专属人物。'},
  {id:'avg_npc_244',label:'深池士兵',role:'soldier',faction:'深池',terms:['士兵','战士'],restriction:'仅限深池；黑金装备与面罩，不能作为任意蒙面人。'},
  {id:'char_1002_nsabr_2',label:'整合运动士兵',role:'soldier',faction:'整合运动',terms:['士兵','战士'],restriction:'仅限整合运动；白兜帽、面具、胸甲与短刃。'},
  {id:'avg_npc_088',label:'罗德岛后勤干员',role:'logistics',faction:'罗德岛',terms:['后勤'],restriction:'仅限罗德岛后勤；制式外套、便帽、短裙，不用于任意居民。'},
  {id:'char_016_medic',label:'罗德岛医疗干员',role:'medic',faction:'罗德岛',terms:['医疗','医生','医师','护士'],restriction:'仅限罗德岛医疗人员；服装有罗德岛字样，非通用医生。'},
  {id:'char_013_riop',label:'罗德岛近卫干员 A',role:'guard',faction:'罗德岛',storyNames:['奥利弗','干员奥利弗'],terms:['近卫','近战','奥利弗'],restriction:'仅限罗德岛近卫；已确认可用于奥利弗，也可用于其他相容的罗德岛近卫。'},
  {id:'avg_npc_089',label:'罗德岛狙击干员',role:'sniper',faction:'罗德岛',storyNames:['碎纸机','干员碎纸机'],terms:['狙击','弓箭','弓手','碎纸机'],restriction:'仅限罗德岛持弓狙击人员；已确认可用于碎纸机，不能据图改写装备。'},
  {id:'avg_npc_090',label:'罗德岛重装干员',role:'defender',faction:'罗德岛',storyNames:['威尔','干员威尔'],terms:['重装','盾','威尔'],restriction:'仅限罗德岛重装；已确认可用于威尔，保留独立人物身份。'},
  {id:'avg_npc_012',label:'罗德岛近卫干员 B',role:'guard',faction:'罗德岛',storyNames:['弗雷德','干员弗雷德'],terms:['近卫','近战','弗雷德'],restriction:'仅限罗德岛近卫；已确认可用于弗雷德，保留独立人物身份。'},
];
const own=(x,k)=>Object.hasOwn(x??{},k);
const validId=id=>/^npc:[a-z][a-z0-9_-]{0,47}$/.test(id);
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=80;
export function npcActorsFrom(initial={},actors={}){
  return Object.assign({},...Object.values(initial).map(s=>s.npcActors??{}),actors??{});
}
function compatible(actor,portrait){return typeof portrait?.id==='string'&&actor.role===portrait.role&&actor.faction===portrait.faction;}
function protectedName(name,pack){
  if(name===pack.currentPlayerName)return true;
  const id=own(pack.aliases,name)?pack.aliases[name]:null;
  return !!(id&&pack.characters[id]?.playerEligible!==false&&!pack.characters[id]?.npcBinding)||Object.values(pack.characters??{}).some(c=>!c.npcBinding&&c.playerEligible!==false&&c.autoEligible!==false&&c.name===name);
}
export function withNPCActors(pack,actors={}){
  const characters=Object.fromEntries(Object.entries(pack.characters??{}).filter(([,c])=>!c.npcBinding)),safe={};
  for(const [id,a]of Object.entries(actors??{})){
    const p=pack.npcPortraits?.[a?.portrait];
    if(!validId(id)||!text(a?.name)||!compatible(a,p)||protectedName(a.name,pack))continue;
    safe[id]=a;characters[id]={name:a.name,default:'single',variants:{single:p.file},variantInfo:{single:{eligible:true,assetId:'npc-portrait:'+p.id,description:p.description}},npcBinding:true,portraitId:p.id,playerEligible:false,autoEligible:true};
  }
  return {...pack,characters,npcActors:safe};
}
export function validateNPCActors(value,parsed,pack,initial={}){
  const previous=npcActorsFrom(initial),actors={...withNPCActors(pack,previous).npcActors},failures=[];
  if(value==null)return {actors,failures};
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>64)return {actors,failures:['NPC 外观对应表格式不合法或超过 64 人']};
  for(const [id,raw]of Object.entries(value)){
    try{
      if(!validId(id)||!raw||!text(raw.name))throw Error('人物编号或名称不合法');
      const p=pack.npcPortraits?.[raw.portrait];
      if(!compatible(raw,p)||protectedName(raw.name,pack))throw Error('通用外观不符合身份、职业或阵营限制');
      const actor={name:raw.name,portrait:raw.portrait,role:raw.role,faction:raw.faction,evidence:raw.evidence};
      if(own(previous,id)){
        const old=previous[id];
        if(['name','portrait','role','faction'].some(k=>old[k]!==actor[k]))throw Error('已知 NPC 的身份和外观不能在新标注中静默更换');
        actors[id]=old;continue;
      }
      if(pack.npcEnabled===false)throw Error('未开启通用 NPC 立绘');
      if(Object.values(actors).some(a=>a.name===actor.name))throw Error('同名 NPC 已有编号；不同人物请使用正文可区分的称谓');
      if(typeof actor.evidence!=='string'||actor.evidence.length<2||actor.evidence.length>300||!parsed.source?.includes(actor.evidence))throw Error('新 NPC 需要一段来自当前正文的身份/外观依据');
      const knownStoryPerson=p.storyNames?.includes(actor.name)&&actor.evidence.includes(actor.name);
      if(p.faction&&!actor.evidence.includes(p.faction)&&!knownStoryPerson)throw Error('阵营图需要正文中的明确阵营依据，不能只依据场景所在地');
      actors[id]=actor;
    }catch(e){failures.push(id+'：'+e.message);}
  }
  return {actors,failures};
}
export function npcCandidates(parsed,pack,previous={}){
  if(pack.npcEnabled===false)return [];
  const source=parsed.fragments.map(f=>f.raw).join('\n'),prior=npcActorsFrom(previous);
  return Object.values(pack.npcPortraits??{}).filter(p=>Object.values(prior).some(a=>a.portrait===p.id)||p.storyNames?.some(n=>source.includes(n))||p.terms.some(t=>source.includes(t))&&(!p.faction||source.includes(p.faction)))
    .map(({id,label,role,faction,storyNames,description,restriction})=>({id,label,role,faction,storyNames,description,restriction}));
}
