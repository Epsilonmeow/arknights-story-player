import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionStore,CONNECTION_KEY,SESSION_KEY,requestBody,validateConnection} from '../versions/0.3.4/annotation-client.mjs';
const config={protocol:'openai',url:'http://127.0.0.1:8080/v1',key:'',model:'gemini-3.8-flash'};
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('default and blank output limit survive save/reopen and omit the relay token field',()=>{
  for(const maxTokens of [undefined,null,'','   ',0,'0'])for(const protocol of ['openai','gemini']){
    const local=memory(),session=memory(),store=connectionStore(local,session);
    store.save({...config,protocol,url:protocol==='gemini'?'http://127.0.0.1:8080':config.url,maxTokens});
    const restored=connectionStore(local,session).read();
    assert.equal(restored.maxTokens,null);assert.equal(restored.model,config.model);assert.equal(restored.key,'');
    assert(!Object.hasOwn(requestBody(restored,'fixture only'),'max_tokens'));
  }
});
test('manually entered large limits no longer silently block URL/key persistence',()=>{
  const local=memory(),session=memory(),store=connectionStore(local,session);
  for(const maxTokens of [16384,65536,131072,16384000]){
    store.save({...config,key:'fixture-only-key',maxTokens:String(maxTokens)});
    const restored=connectionStore(local,session).read();
    assert.equal(restored.url,config.url);assert.equal(restored.key,'fixture-only-key');
    assert.equal(requestBody(restored,'fixture').max_tokens,maxTokens);
    assert(!local.getItem(CONNECTION_KEY).includes('fixture-only-key'));
    assert.equal(session.getItem(SESSION_KEY),'fixture-only-key');
  }
});
test('invalid connection edits preserve the last saved URL/key rather than partially overwriting it',()=>{
  const local=memory(),session=memory(),store=connectionStore(local,session);
  store.save({...config,key:'fixture-only-key',maxTokens:16384});
  for(const patch of [{url:''},{maxTokens:-1},{maxTokens:1.5},{maxTokens:Infinity},{maxTokens:NaN},{maxTokens:Number.MAX_SAFE_INTEGER+1}]){
    assert.throws(()=>store.save({...config,key:'replacement-fixture',maxTokens:null,...patch}));
    assert.equal(store.read().url,config.url);assert.equal(store.read().key,'fixture-only-key');assert.equal(store.read().maxTokens,16384);
  }
  assert.equal(validateConnection(config).maxTokens,null);
});
