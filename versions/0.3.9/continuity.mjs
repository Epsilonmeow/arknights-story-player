// Source order, not the screen being browsed, owns continuation. No global timeline or workflow engine.
import {storyParserRevision,parseStory} from './core.mjs';
// Offstage preset notes can change after generation. Match the exact playable units,
// including original language and tracks, rather than guessing from the visible prose alone.
export function annotationSource(text,format='auto') {
  return JSON.stringify(parseStory(text,180,format).fragments.map(f=>[f.track,f.kind,f.speakerHint??'',f.text.trim(),f.original.trim()]));
}
export async function contextFor(messages,target,packHash,revision,corrections,hash,readRecord,player=null) {
  const parserFields=m=>{const parserRevision=storyParserRevision(m.text,m.format);return parserRevision?{parserRevision}:{};};
  const storyHashes=new Map();
  const storyHash=m=>{if(!storyHashes.has(m.id))storyHashes.set(m.id,hash(annotationSource(m.text,m.format)));return storyHashes.get(m.id);};
  const active=[];
  for(const fix of corrections??[]) {
    const m=messages.find(x=>x.id===fix.anchor);
    if(m&&m.id<=target&&m.swipe===fix.swipe&&(fix.parserRevision??null)===storyParserRevision(m.text,m.format)&&(await hash(m.text)===fix.sourceHash||fix.storyHash&&await storyHash(m)===fix.storyHash))active.push(fix);
  }
  const fingerprint=async index=>hash(JSON.stringify({packHash,revision,player,upstream:messages.filter(m=>m.id<index).map(m=>{const values=[m.id,m.role,m.swipe,m.format??'auto',m.text];if(parserFields(m).parserRevision)values.push(parserFields(m).parserRevision);return values;}),corrections:active.filter(f=>f.anchor<=index)}));
  const storyFingerprint=async index=>hash(JSON.stringify({packHash,revision,player,upstream:await Promise.all(messages.filter(m=>m.id<index).map(async m=>[m.id,m.role,m.swipe,m.format??'auto',m.role==='assistant'?await storyHash(m):m.text,parserFields(m).parserRevision??null])),corrections:active.filter(f=>f.anchor<=index)}));
  const current=messages.find(m=>m.id===target);
  if(!current)throw Error('目标消息不存在');
  const expectedFor=async m=>({hash:await hash(m.text),lineageHash:await fingerprint(m.id),storyHash:await storyHash(m),storyLineageHash:await storyFingerprint(m.id),packHash,revision,swipe:m.swipe,format:m.format??'auto',...parserFields(m)});
  const expected=await expectedFor(current);
  let initial={},ancestor=null;
  for(const m of [...messages].reverse().filter(m=>m.id<target&&m.role==='assistant')) {
    const record=await readRecord(m.id,await hash(m.text));
    if(recordMatches(record,await expectedFor(m))&&record.finalTracks) {initial=structuredClone(record.finalTracks);ancestor=m.id;break;}
  }
  for(const fix of active.filter(f=>f.anchor<target&&(ancestor===null||f.anchor>ancestor)))initial=applyCorrection(initial,fix);
  return {expected,initial,ancestor,corrections:active.filter(f=>f.anchor===target),active};
}
export function recordMatches(record,expected) {
  if(!record)return false;
  const exact=record.hash===expected.hash&&record.lineageHash===expected.lineageHash;
  const story=!!record.storyHash&&!!record.storyLineageHash&&record.storyHash===expected.storyHash&&record.storyLineageHash===expected.storyLineageHash;
  return (exact||story)&&Object.entries(expected).every(([key,value])=>['hash','lineageHash','storyHash','storyLineageHash'].includes(key)||record[key]===value);
}
export function applyCorrection(tracks,fix) {
  const next=structuredClone(tracks);next[fix.track??'main']={...(next[fix.track??'main']??{}),...structuredClone(fix.stage)};
  // Appearance belongs to the person even when that person later changes tracks.
  if(fix.stage.npcActors)for(const stage of Object.values(next))stage.npcActors={...stage.npcActors,...structuredClone(fix.stage.npcActors)};
  return next;
}
export function correctedTracks(tracks,fixes,position) {let next=tracks;for(const fix of fixes??[])if(fix.position<=position)next=applyCorrection(next,fix);return next;}
export function normalizedMessages(chat) {return chat.map((m,id)=>({id,role:m.is_user?'user':m.is_system?'system':'assistant',text:String(m.mes??''),swipe:m.swipe_id??0,format:m.extra?.ark_story_format??'auto'}));}
