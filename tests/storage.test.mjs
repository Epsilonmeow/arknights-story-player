import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferenceStore,readAnnotationRecord,saveAnnotationRecord,chatSaveVerifier,annotationDraftStore} from '../versions/0.3.9/persistence.mjs';
import {createAnnotationRunner} from '../versions/0.3.9/assets/annotation-runner.mjs';

const recordKey='ark_story_player_v1_v2',cacheKey='ark_story_player_v1:cache:fixture';
const next={hash:'source',rows:[{id:'f1',speaker:'speaker'}],failures:[]};
const quota=()=>new DOMException('Storage quota exceeded','QuotaExceededError');

test('a full browser cache cannot discard a paid annotation, prevent playback, or require a second call',async()=>{
  let calls=0,saves=0,rendered=0,durable;
  const backing=new Map([['unrelated','keep'],[cacheKey,JSON.stringify({...next,model:'old'})]]);
  const local={getItem:k=>backing.get(k)??null,setItem(){throw quota();},removeItem(){assert.fail('Must not delete legacy or unrelated data');}};
  const prefs=preferenceStore(local),message={mes:'Original story',extra:{unrelated:'keep'}},reports=[];
  const job={force:false,report:t=>reports.push(t),onBusy(){},capture:async()=>({}),assertCurrent:async()=>{},
    request:async()=>{calls++;return next;},validate:r=>r,
    commit:async record=>{
      await saveAnnotationRecord(message,recordKey,record,async()=>{saves++;durable=JSON.parse(JSON.stringify(message));});
      rendered++;prefs.setItem('progress','f1');prefs.setItem('selected','2');
    },useCached:async()=>{rendered++;prefs.setItem('progress','f1');}};
  const runner=createAnnotationRunner();
  assert.equal((await runner.run(job)).kind,'success');
  assert.equal(saves,1);assert.equal(calls,1);assert.equal(rendered,1);
  assert.equal(message.mes,'Original story');assert.equal(message.extra.unrelated,'keep');
  assert.equal(prefs.temporary,true);assert.equal(prefs.getItem('progress'),'f1');
  const reopened=readAnnotationRecord(durable,recordKey,local,cacheKey,r=>r.hash==='source');
  assert.deepEqual(reopened,next);assert.equal(reopened.model,undefined);
  assert.equal((await runner.run({...job,capture:async()=>({cached:reopened})})).kind,'cached');
  assert.equal(calls,1);assert.equal(saves,1);assert.equal(rendered,2);
  assert.equal(backing.get('unrelated'),'keep');assert.equal(JSON.parse(backing.get(cacheKey)).model,'old');
  assert(!reports.some(t=>t.startsWith('标注失败')));
});

test('chat save rejection restores the previous record and preserves other message data',async()=>{
  for(const extra of [undefined,{note:'keep'},{note:'keep',[recordKey]:{model:'old'}}]){
    const message={mes:'Original',...(extra?{extra}:{} )},before=structuredClone(message);
    await assert.rejects(saveAnnotationRecord(message,recordKey,next,async()=>{throw Error('server unavailable');}),/server unavailable/);
    assert.deepEqual(message,before);
  }
});

test('a swallowed host save failure cannot report annotation success',async()=>{
  const message={mes:'Original',extra:{[recordKey]:{model:'old'}}},before=structuredClone(message),reports=[];
  let modelCalls=0;
  const runner=createAnnotationRunner();
  const result=await runner.run({force:true,report:t=>reports.push(t),onBusy(){},capture:async()=>({}),assertCurrent:async()=>{},
    request:async()=>{modelCalls++;return next;},validate:r=>r,
    commit:r=>saveAnnotationRecord(message,recordKey,r,async()=>{},async()=>false)});
  assert.equal(result.kind,'error');
  assert.equal(modelCalls,1);
  assert.deepEqual(message,before);
  assert(!reports.some(t=>t.startsWith('标注完成')));
});

test('saving is confirmed against the original server chat, message, swipe and record',async()=>{
  const message={mes:'Original',swipe_id:2,extra:{[recordKey]:next}},metadata={corrections:[{place:'room'}]};
  let file=[{chat_metadata:{scene:metadata}},structuredClone(message)],requestBody;
  const c={chat:[message],characterId:0,characters:[{name:'Test',avatar:'Test.png'}],getCurrentChatId:()=> 'fixture-chat',getRequestHeaders:()=>({'Content-Type':'application/json'})};
  const fetcher=async(url,options)=>{assert.equal(url,'/api/chats/get');requestBody=JSON.parse(options.body);return Response.json(file);};
  const verify=chatSaveVerifier(c,fetcher,{id:0,recordKey,record:next,metadataKey:'scene',metadataValue:metadata});
  c.characters[0].avatar='Other.png';c.getCurrentChatId=()=> 'other-chat';
  assert.equal(await verify(),true);assert.equal(requestBody.avatar_url,'Test.png');assert.equal(requestBody.file_name,'fixture-chat');
  for(const change of [f=>f[1].extra[recordKey]={model:'old'},f=>f[1].mes='Edited',f=>f[1].swipe_id=3,f=>f[0].chat_metadata.scene={}]){
    file=[{chat_metadata:{scene:metadata}},structuredClone(message)];change(file);assert.equal(await verify(),false);
  }
  for(const fetcher of [async()=>new Response('',{status:500}),async()=>{throw Error('offline');},async()=>Response.json({})]){
    assert.equal(await chatSaveVerifier(c,fetcher,{id:0,recordKey,record:next})(),false);
  }
});

test('group save verification handles the host header without mixing group id and chat id',async()=>{
  const c={groupId:'group',getCurrentChatId:()=> 'group-chat',chat:[{mes:'Original'}],getRequestHeaders:()=>({})};
  const verify=chatSaveVerifier(c,async(url,options)=>{
    assert.equal(url,'/api/chats/group/get');assert.deepEqual(JSON.parse(options.body),{id:'group-chat'});
    return Response.json([{chat_metadata:{}},{mes:'Original',extra:{[recordKey]:next}}]);
  },{id:0,recordKey,record:next});
  assert.equal(await verify(),true);
});

test('retrying a retained result skips the model even when the caller asks to regenerate',async()=>{
  const drafts=annotationDraftStore(undefined),message={mes:'Original'},reports=[];let modelCalls=0,saves=0,confirmed=false;
  const runner=createAnnotationRunner(),key='chat|hash|swipe';
  const job={force:true,report:t=>reports.push(t),onBusy(){},capture:async()=>({pending:await drafts.get(key)}),assertCurrent:async()=>{},
    request:async()=>{modelCalls++;return next;},validate:r=>r,
    commit:async record=>{await drafts.put(key,record);await saveAnnotationRecord(message,recordKey,record,async()=>{saves++;},async()=>confirmed);await drafts.remove(key);}};
  assert.equal((await runner.run(job)).kind,'error');assert.equal(drafts.temporary,true);assert.equal(message.extra,undefined);
  confirmed=true;assert.equal((await runner.run(job)).kind,'success');
  assert.equal(modelCalls,1);assert.equal(saves,2);assert.equal(await drafts.get(key),undefined);assert.equal(drafts.temporary,false);
  assert(reports.some(t=>t.includes('没有调用模型')));
});

test('chat records take priority; compatible legacy-only annotations remain readable',()=>{
  const legacy={...next,model:'legacy'},local={getItem:()=>JSON.stringify(legacy)};
  assert.equal(readAnnotationRecord({extra:{[recordKey]:next}},recordKey,local,cacheKey,r=>r.hash==='source'),next);
  assert.deepEqual(readAnnotationRecord({},recordKey,local,cacheKey,r=>r.hash==='source'),legacy);
  assert.equal(readAnnotationRecord({},recordKey,local,cacheKey,r=>r.hash==='changed'),undefined);
  assert.equal(readAnnotationRecord({},recordKey,{getItem:()=>'{broken'},cacheKey,()=>true),undefined);
});

test('unavailable storage does not hide saved chat annotations or crash local reading settings',()=>{
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  const prefs=preferenceStore(blocked);
  assert.equal(prefs.getItem('unset'),null);prefs.setItem('npc','false');assert.equal(prefs.getItem('npc'),'false');
  prefs.removeItem('npc');assert.equal(prefs.getItem('npc'),null);
  assert.equal(readAnnotationRecord({extra:{[recordKey]:next}},recordKey,blocked,cacheKey,()=>true),next);
  assert.equal(readAnnotationRecord({},recordKey,blocked,cacheKey,()=>true),undefined);
});

test('temporary preferences override stale values, then return to persistence when space is available',()=>{
  let full=true;const data=new Map([['progress','old']]);
  const local={getItem:k=>data.get(k)??null,setItem(k,v){if(full)throw quota();data.set(k,v);},removeItem:k=>data.delete(k)};
  const prefs=preferenceStore(local);prefs.setItem('progress','new');
  assert.equal(prefs.getItem('progress'),'new');assert.equal(prefs.temporary,true);
  full=false;prefs.setItem('progress','later');assert.equal(prefs.temporary,false);
  assert.equal(preferenceStore(local).getItem('progress'),'later');
});
