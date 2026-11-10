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

export async function saveAnnotationRecord(message,recordKey,record,saveChat) {
  const hadExtra=message.extra!==undefined,hadRecord=Object.hasOwn(message.extra??{},recordKey),previous=message.extra?.[recordKey];
  message.extra??={};message.extra[recordKey]=record;
  try{await saveChat();}
  catch(error){
    if(hadRecord)message.extra[recordKey]=previous;else delete message.extra[recordKey];
    if(!hadExtra&&!Object.keys(message.extra).length)delete message.extra;
    throw error;
  }
  // Do not write duplicate records to localStorage, or delete legacy-only data.
}
