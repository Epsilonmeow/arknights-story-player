import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferenceStore,readAnnotationRecord,saveAnnotationRecord} from '../versions/0.3.8/persistence.mjs';
import {createAnnotationRunner} from '../versions/0.3.8/assets/annotation-runner.mjs';

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
