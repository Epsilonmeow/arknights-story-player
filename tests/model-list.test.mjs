import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestModelList} from '../versions/0.3.1/annotation-client.mjs';

const args={origin:'http://localhost:8791',headers:{'X-CSRF-Token':'fixture-csrf'},config:{protocol:'openai',url:'http://127.0.0.1:19099/v1',key:''}};
test('list query needs no model or token limit, and uses only explicit connection credentials',async()=>{
  for(const protocol of ['openai','gemini']){
    let calls=0;
    const config={...args.config,protocol,url:'http://127.0.0.1:19099',model:'',maxTokens:0};
    const models=await requestModelList({...args,config,fetcher:async(url,options)=>{
      calls++;assert.equal(url,args.origin+'/api/backends/chat-completions/status');
      assert.equal(options.headers['X-CSRF-Token'],'fixture-csrf');assert.equal(options.credentials,'same-origin');
      assert.deepEqual(JSON.parse(options.body),{chat_completion_source:protocol==='gemini'?'makersuite':'openai',reverse_proxy:config.url,proxy_password:''});
      return Response.json({data:[{id:'z-model'},{id:'a-model'},{id:'a-model'},null,{id:''},{id:'bad model'},{id:42}]});
    }});
    assert.deepEqual(models,['a-model','z-model']);assert.equal(calls,1);
  }
});
test('OpenAI provider/model IDs survive; Gemini normalized IDs are accepted',async()=>{
  const fetcher=async()=>Response.json({data:[{id:'provider/model'},{id:'gemini-fixture'}]});
  assert.deepEqual(await requestModelList({...args,fetcher}),['gemini-fixture','provider/model']);
  assert.deepEqual(await requestModelList({...args,config:{protocol:'gemini',url:'https://example.test',key:'fixture-key'},fetcher}),['gemini-fixture']);
});
test('empty list is distinct from malformed/provider failures; never echo response secrets or retry',async()=>{
  assert.deepEqual(await requestModelList({...args,fetcher:async()=>Response.json({data:[]})}),[]);
  for(const response of [Response.json({error:{message:'fixture-secret'}},{status:401}),Response.json({error:true,data:[]}),Response.json({data:{data:[]}}),new Response('fixture-secret')]){
    let calls=0;await assert.rejects(requestModelList({...args,fetcher:async()=>{calls++;return response}}),e=>!e.message.includes('fixture-secret'));assert.equal(calls,1);
  }
});
test('invalid endpoints never send credentials; list cancellation rejects late results',async()=>{
  for(const url of ['', 'http://remote.example/v1','https://u:p@example.test','https://example.test?key=secret']){
    await assert.rejects(requestModelList({...args,config:{...args.config,url},fetcher:()=>assert.fail('must not send')}));
  }
  const controller=new AbortController();
  await assert.rejects(requestModelList({...args,signal:controller.signal,fetcher:async()=>{controller.abort();return Response.json({data:[{id:'stale'}]})}}),e=>e.name==='AbortError');
});
