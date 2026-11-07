import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateConnection,connectionStore,CONNECTION_KEY,SESSION_KEY,requestBody,requestAnnotation} from '../versions/0.3.3/annotation-client.mjs';
import {parseStory} from '../versions/0.3.3/core.mjs';
import {createAnnotationRunner} from '../versions/0.3.3/assets/annotation-runner.mjs';
const pack=JSON.parse(fs.readFileSync(new URL('../versions/0.3.3/pack.json',import.meta.url)));
const parsed=parseStory('号角：先检查走廊。',180,'speaker-lines');
const config={protocol:'openai',url:'http://127.0.0.1:19099/v1',model:'fixture-model',key:'',maxTokens:16384};
const args={config,parsed,pack,previous:{},player:{playerName:'测试玩家'},origin:'http://127.0.0.1:19098',headers:{'X-CSRF-Token':'fixture-token'}};
const row={id:'f0',speaker:'号角',kind:'dialogue',sceneChange:true,visualChange:true,background:null,place:'走廊',present:['号角'],display:['avg_npc_229_1'],communication:[],remote:[],referenced:[],focus:'avg_npc_229_1',front:'avg_npc_229_1',variants:{avg_npc_229_1:'1'}};
test('explicit connection, no empty URL/model or insecure remote fallback',()=>{
  for(const patch of [{url:''},{model:''},{url:'http://remote.example/v1'},{url:'https://x.example/v1?key=secret'},{url:'https://u:p@x.example/v1'},{url:'https://x.example/v1/chat/completions'},{maxTokens:-1}])assert.throws(()=>validateConnection({...config,...patch}));
  const body=requestBody(config,'ONLY THIS PROMPT');assert.equal(body.reverse_proxy,config.url);assert.equal(body.proxy_password,'');assert.equal(body.chat_completion_source,'openai');assert.deepEqual(body.messages,[{role:'user',content:'ONLY THIS PROMPT'}]);assert(!('secret_id'in body));
  assert.equal(validateConnection({...config,model:'provider/model'}).model,'provider/model');
  assert.equal(requestBody({...config,protocol:'gemini',url:'http://127.0.0.1:19099'},'p').chat_completion_source,'makersuite');
});
test('key only in session; configuration clear retains unrelated data',()=>{
  const make=()=>{const map=new Map([['other','keep']]);return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};
  const local=make(),session=make(),store=connectionStore(local,session);store.save({...config,key:'fixture-secret'});
  assert(!local.getItem(CONNECTION_KEY).includes('fixture-secret'));assert.equal(session.getItem(SESSION_KEY),'fixture-secret');
  assert.equal(connectionStore(local,session).read().key,'fixture-secret');store.clear();assert.equal(session.getItem(SESSION_KEY),null);assert.equal(local.getItem('other'),'keep');
});
test('single relay request, array model response accepted, no credentials saved in record',async()=>{
  let calls=0;const record=await requestAnnotation({...args,config:{...config,key:'fixture-secret'},fetcher:async(url,options)=>{calls++;assert.equal(url,args.origin+'/api/backends/chat-completions/generate');const body=JSON.parse(options.body);assert.equal(body.proxy_password,'fixture-secret');assert.equal(body.messages.length,1);assert(body.messages[0].content.includes('先检查走廊'));assert(!body.messages[0].content.includes('fixture-secret'));return Response.json({choices:[{message:{content:JSON.stringify([row])}}]});}});
  assert.equal(calls,1);assert.equal(record.failures.length,0);assert.equal(record.rows[0].focus,'avg_npc_229_1');assert(!JSON.stringify(record).includes('fixture-secret'));assert(!JSON.stringify(record).includes(config.url));
});
test('provider error body never echoed; errors never automatically retried',async()=>{
  for(const response of [Response.json({error:{message:'fixture-secret'}},{status:401}),Response.json({error:{message:'fixture-secret'}}),Response.json({choices:[{message:{content:'not JSON fixture-secret'}}]})]){let calls=0;await assert.rejects(()=>requestAnnotation({...args,fetcher:async()=>{calls++;return response}}),e=>!e.message.includes('fixture-secret'));assert.equal(calls,1);}
});
test('invalid asset produces text fallback without rewriting source',async()=>{
  const source=parsed.source;const result=await requestAnnotation({...args,fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({rows:[{...row,display:['invented-id']}]})}}]})});assert.equal(result.rows[0].fallback,true);assert.equal(parsed.source,source);
});
test('cancelled relay aborts without consuming late result',async()=>{
  const controller=new AbortController();const promise=requestAnnotation({...args,signal:controller.signal,fetcher:async()=>{controller.abort();return Response.json({choices:[{message:{content:JSON.stringify([row])}}]})}});await assert.rejects(promise,e=>e.name==='AbortError');
});
test('runner prevents double request, preserves cache and ignores late cancelled response',async()=>{
  const runner=createAnnotationRunner();let calls=0,commits=0,release;const wait=new Promise(r=>release=r);
  const job={force:true,onBusy(){},report(){},capture:async()=>({oldUsable:0}),request:async()=>{calls++;await wait;return {rows:[row]}},assertCurrent:async()=>{},validate:r=>r,commit:async()=>commits++};
  const first=runner.run(job);await new Promise(r=>setTimeout(r,0));assert.equal((await runner.run(job)).kind,'busy');runner.cancel();await first;release();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);assert.equal(commits,0);assert.equal(runner.busy,false);
});
