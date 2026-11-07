// Local, opt-in presentation. No image bytes or host URL are part of model input.
export const PLAYER_ID='ark_player_avatar';
export const PLAYER_BINDING='ark_story_player_identity_v1';
export const AVATAR_DEFAULTS={enabled:false,size:110,top:12.5};
export function avatarPreferences(value={}){
  return {enabled:value?.enabled===true,size:Math.min(220,Math.max(70,Number(value?.size)||110)),top:Math.min(40,Math.max(-40,Number.isFinite(Number(value?.top))?Number(value.top):12.5))};
}
export const avatarPreferenceKey=id=>'ark_story_player_v1:persona-avatar:'+encodeURIComponent(id);
const safeId=id=>typeof id==='string'&&/^[^/\\\0?#]{1,200}$/.test(id)&&id!=='.'&&id!=='..';
export function personaSnapshot(helper,origin){
  const capable=['getCurrentPersonaId','getCurrentPersonaName','getPersonaAvatarPath'].every(k=>typeof helper?.[k]==='function');
  if(!capable)return {capable:false,id:null,name:'',url:null,defaultAvatar:false};
  try{
    const id=helper.getCurrentPersonaId(),name=String(helper.getCurrentPersonaName()??'').slice(0,80);
    const raw=safeId(id)?helper.getPersonaAvatarPath(id):null;
    const url=raw?new URL(raw,origin+'/'):null;
    const local=url?.origin===origin&&decodeURIComponent(url.pathname)==='/User Avatars/'+id;
    return {capable:true,id:safeId(id)?id:null,name,url:local?url.href:null,defaultAvatar:/^(?:default|none)\.(?:png|jpe?g|webp)$/i.test(id??'')};
  }catch{return {capable:true,id:null,name:'',url:null,defaultAvatar:false};}
}
export function replyPlayerBinding(chat,index,origin){
  const saved=chat[index]?.extra?.[PLAYER_BINDING]??chat[index]?.swipe_info?.find(s=>s?.extra?.[PLAYER_BINDING])?.extra[PLAYER_BINDING];
  if(safeId(saved?.personaId)&&typeof saved.playerName==='string')return {personaId:saved.personaId,playerName:saved.playerName.slice(0,80)};
  // Historical messages carry the original persona avatar ID; never bind by a possibly duplicated name.
  const user=chat.slice(0,index).findLast(m=>m.is_user&&!m.is_system);
  if(!user?.force_avatar||!user.name)return null;
  try{
    const u=new URL(user.force_avatar,origin);if(u.origin!==origin)return null;
    const id=u.pathname==='/thumbnail'&&u.searchParams.get('type')==='persona'?u.searchParams.get('file'):decodeURIComponent(u.pathname).startsWith('/User Avatars/')?decodeURIComponent(u.pathname).slice(14):null;
    return safeId(id)?{personaId:id,playerName:String(user.name).slice(0,80)}:null;
  }catch{return null;}
}
export function saveReplyBinding(message,binding){
  if(!binding)return false;let changed=false;
  for(const owner of [message,...(message.swipe_info??[]).filter(Boolean)]){
    owner.extra??={};if(JSON.stringify(owner.extra[PLAYER_BINDING])!==JSON.stringify(binding)){owner.extra[PLAYER_BINDING]={...binding};changed=true;}
  }
  return changed;
}
export function annotationPlayer(base,binding){
  // This stage reference is stable even while the display switch is off.
  return binding?{...base,personaId:binding.personaId,playerName:binding.playerName,name:base.characterId?base.name:binding.playerName,characterId:base.characterId??PLAYER_ID,localPlayer:true}:base;
}
export function sanitizeAnnotationPlayer(input,base){
  return input?.localPlayer===true&&safeId(input.personaId)&&input.playerName===base.playerName?annotationPlayer(base,{personaId:input.personaId,playerName:base.playerName}):base;
}
export function playerStagePack(pack,player){
  if(player?.characterId!==PLAYER_ID||!player.localPlayer||!safeId(player.personaId)||!player.name)return pack;
  const char={name:player.name,default:'single',variants:{single:'assets/player-avatar-local'},variantInfo:{single:{eligible:true}},playerOnly:true};
  const asset={id:PLAYER_ID+'#single',characterId:PLAYER_ID,type:'character',name:player.name,eligible:true,description:'当前玩家的本地单张立绘引用；只有明确在场或通讯时可选，不识别图片，不提供表情差分。',composition:{kind:'single-local-player-reference'}};
  return {...pack,characters:{...pack.characters,[PLAYER_ID]:char},assets:[...pack.assets,asset]};
}
export function recordPlayerMatches(record,binding){return !record?.playerBinding||!!binding&&record.playerBinding.personaId===binding.personaId&&record.playerBinding.playerName===binding.playerName;}
export function playerAvatarActive(persona,binding,prefs){return !!(prefs.enabled&&persona.url&&!persona.defaultAvatar&&binding?.personaId===persona.id&&binding?.playerName===persona.name);}
export function playerStage(stage,row,base,binding,active){
  const s={...stage,display:[...(stage.display??[])],communication:[...(stage.communication??[])],variants:{...(stage.variants??{})}};
  const id=base.characterId??PLAYER_ID;
  if(!active||!binding){s.display=s.display.filter(x=>x!==PLAYER_ID);s.communication=s.communication.filter(x=>x!==PLAYER_ID);if(s.focus===PLAYER_ID)s.focus=null;if(s.front===PLAYER_ID)s.front=null;return s;}
  const name=base.characterId?base.name:binding.playerName;
  const present=s.present?.includes(name),remote=s.remote?.includes(name);
  if(id===PLAYER_ID&&(!present||remote)){s.display=s.display.filter(x=>x!==id);if(s.focus===id)s.focus=null;if(s.front===id)s.front=null;}
  if(id===PLAYER_ID&&(!remote||present))s.communication=s.communication.filter(x=>x!==id);
  // Reuse old annotations with explicit presence, including a custom player formerly without a portrait.
  if(id===PLAYER_ID&&present&&!remote){if(!s.display.includes(id))s.display.push(id);s.variants[id]='single';if(row.speaker===name&&row.kind==='dialogue'){s.focus=id;if(!s.front)s.front=id;}else if(s.focus===id)s.focus=null;}
  if(id===PLAYER_ID&&remote&&!present&&row.kind==='communication'&&row.speaker===name){if(!s.communication.includes(id))s.communication.push(id);s.display=s.display.filter(x=>x!==id);s.variants[id]='single';if(s.focus===id)s.focus=null;}
  return s;
}
export function avatarPose(prefs,x){return {width:'auto',height:prefs.size+'vh',top:prefs.top+'vh',x:x+'%',transform:'translateX(-50%)',calibrated:false};}
