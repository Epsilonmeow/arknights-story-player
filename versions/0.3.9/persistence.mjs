// Chat messages own annotations. Browser storage is only an optional UI aid.
export function preferenceStore(storage) {
  const temporary=new Map();
  return {
    get temporary(){return temporary.size>0;},
    getItem(key){if(temporary.has(key))return temporary.get(key);try{return storage.getItem(key);}catch{return null;}},
    setItem(key,value){value=String(value);try{storage.setItem(key,value);temporary.delete(key);}catch{temporary.set(key,value);}},
    removeItem(key){try{storage.removeItem(key);temporary.delete(key);}catch{temporary.set(key,null);}}
  };
}

export function readAnnotationRecord(message,recordKey,storage,cacheKey,accept) {
  const saved=message?.extra?.[recordKey];
  if(saved&&accept(saved))return saved;
  // Old versions kept a second copy here; it remains a read-only fallback.
  try{const cached=JSON.parse(storage.getItem(cacheKey));if(cached&&accept(cached))return cached;}catch{}
}

export class UnconfirmedSaveError extends Error {
  constructor(){super('酒馆尚未确认保存。请使用“重试保存”，不需要重新调用模型');this.name='UnconfirmedSaveError';}
}

export async function saveAnnotationRecord(message,recordKey,record,saveChat,verify) {
  const hadExtra=message.extra!==undefined,hadRecord=Object.hasOwn(message.extra??{},recordKey),previous=message.extra?.[recordKey];
  message.extra??={};message.extra[recordKey]=record;
  try{await saveChat();if(verify&&!await verify())throw new UnconfirmedSaveError();}
  catch(error){
    if(hadRecord)message.extra[recordKey]=previous;else delete message.extra[recordKey];
    if(!hadExtra&&!Object.keys(message.extra).length)delete message.extra;
    throw error;
  }
  // Do not write duplicate records to localStorage, or delete legacy-only data.
}

// SillyTavern 1.18.0: st-context.saveChat can resolve after a failed save.
// Read the exact file using the same /api/chats/get and /group/get contracts as the host.
export function chatSaveVerifier(c,fetcher,{id,recordKey,record,metadataKey,metadataValue}={}) {
  const chatId=c.getCurrentChatId?.(),group=!!c.groupId,character=c.characters?.[c.characterId];
  if(!chatId||(!group&&!character?.avatar))throw new UnconfirmedSaveError();
  const body=JSON.stringify(group?{id:chatId}:{ch_name:character.name,file_name:chatId,avatar_url:character.avatar});
  const message=id===undefined?null:c.chat[id];
  const expected=message?{mes:message.mes,swipe:message.swipe_id??0,record:JSON.stringify(record)}:null;
  const expectedMetadata=JSON.stringify(metadataValue),headers=c.getRequestHeaders();
  return async()=>{
    try{
      const response=await fetcher(group?'/api/chats/group/get':'/api/chats/get',{method:'POST',headers,cache:'no-store',body,signal:AbortSignal.timeout(15000)});
      if(!response.ok)return false;
      const data=await response.json();if(!Array.isArray(data))return false;
      const hasHeader=!!data[0]&&Object.hasOwn(data[0],'chat_metadata');
      if(metadataKey&&JSON.stringify(data[0]?.chat_metadata?.[metadataKey])!==expectedMetadata)return false;
      if(!expected)return true;
      const saved=data[id+(hasHeader?1:0)];
      return saved?.mes===expected.mes&&(saved.swipe_id??0)===expected.swipe&&JSON.stringify(saved.extra?.[recordKey])===expected.record;
    }catch{return false;}
  };
}

// Only unconfirmed results live here. Confirmed annotations remain owned by chat messages.
// IndexedDB is separate from the small localStorage quota; blocked storage falls back to this page.
export function annotationDraftStore(indexedDB) {
  const memory=new Map(),temporary=new Set();let database;
  const open=()=>database??=new Promise(resolve=>{
    if(!indexedDB){resolve(null);return;}
    let settled=false;const finish=value=>{if(settled){value?.close();return;}settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>finish(null),2000);
    try{const request=indexedDB.open('ark_story_player_pending_v1',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records');};
      request.onsuccess=()=>finish(request.result);request.onerror=request.onblocked=()=>finish(null);
    }catch{finish(null);}
  });
  async function transact(mode,action){
    const db=await open();if(!db)throw Error('Draft storage unavailable');
    return new Promise((resolve,reject)=>{
      let tx,value;const timer=setTimeout(()=>{try{tx?.abort();}catch{}reject(Error('Draft storage timeout'));},2000);
      try{tx=db.transaction('records',mode);const request=action(tx.objectStore('records'));request.onsuccess=()=>{value=request.result;};
        tx.oncomplete=()=>{clearTimeout(timer);resolve(value);};tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(Error('Draft storage failed'));};
      }catch(error){clearTimeout(timer);reject(error);}
    });
  }
  return {
    get temporary(){return temporary.size>0;},
    async get(key){if(memory.has(key))return memory.get(key);try{const value=await transact('readonly',s=>s.get(key));if(value)memory.set(key,value);return value;}catch{return undefined;}},
    async put(key,value){memory.set(key,value);try{await transact('readwrite',s=>s.put(value,key));temporary.delete(key);return true;}catch{temporary.add(key);return false;}},
    async remove(key){memory.delete(key);temporary.delete(key);try{await transact('readwrite',s=>s.delete(key));}catch{}},
  };
}
