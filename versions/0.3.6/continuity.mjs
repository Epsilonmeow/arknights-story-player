// Source order, not the screen being browsed, owns continuation. No global timeline or workflow engine.
export async function contextFor(messages,target,packHash,revision,corrections,hash,readRecord,player=null) {
  const active=[];
  for(const fix of corrections??[]) {
    const m=messages.find(x=>x.id===fix.anchor);
    if(m&&m.id<=target&&m.swipe===fix.swipe&&await hash(m.text)===fix.sourceHash)active.push(fix);
  }
  const fingerprint=async index=>hash(JSON.stringify({packHash,revision,player,upstream:messages.filter(m=>m.id<index).map(m=>[m.id,m.role,m.swipe,m.format??'auto',m.text]),corrections:active.filter(f=>f.anchor<=index)}));
  const current=messages.find(m=>m.id===target);
  if(!current)throw Error('目标消息不存在');
  const expected={hash:await hash(current.text),lineageHash:await fingerprint(target),packHash,revision,swipe:current.swipe,format:current.format??'auto'};
  let initial={},ancestor=null;
  for(const m of [...messages].reverse().filter(m=>m.id<target&&m.role==='assistant')) {
    const record=await readRecord(m.id,await hash(m.text));
    if(recordMatches(record,{hash:await hash(m.text),lineageHash:await fingerprint(m.id),packHash,revision,swipe:m.swipe,format:m.format??'auto'})&&record.finalTracks) {initial=structuredClone(record.finalTracks);ancestor=m.id;break;}
  }
  for(const fix of active.filter(f=>f.anchor<target&&(ancestor===null||f.anchor>ancestor)))initial=applyCorrection(initial,fix);
  return {expected,initial,ancestor,corrections:active.filter(f=>f.anchor===target),active};
}
export function recordMatches(record,expected) {return !!record&&Object.entries(expected).every(([key,value])=>record[key]===value);}
export function applyCorrection(tracks,fix) {
  const next=structuredClone(tracks);next[fix.track??'main']={...(next[fix.track??'main']??{}),...structuredClone(fix.stage)};
  // Appearance belongs to the person even when that person later changes tracks.
  if(fix.stage.npcActors)for(const stage of Object.values(next))stage.npcActors={...stage.npcActors,...structuredClone(fix.stage.npcActors)};
  return next;
}
export function correctedTracks(tracks,fixes,position) {let next=tracks;for(const fix of fixes??[])if(fix.position<=position)next=applyCorrection(next,fix);return next;}
export function normalizedMessages(chat) {return chat.map((m,id)=>({id,role:m.is_user?'user':m.is_system?'system':'assistant',text:String(m.mes??''),swipe:m.swipe_id??0,format:m.extra?.ark_story_format??'auto'}));}
