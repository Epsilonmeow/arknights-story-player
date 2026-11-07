import {annotationPrompt,validateAnnotations} from './core.mjs';

export const CONNECTION_KEY='ark_story_annotation_connection_v1';
export const SESSION_KEY=CONNECTION_KEY+':key';
export const DEFAULT_CONNECTION={protocol:'openai',url:'',model:'',maxTokens:null};

function validateEndpoint(value){
  const c={...DEFAULT_CONNECTION,...value};
  if(!['openai','gemini'].includes(c.protocol))throw Error('请选择支持的接口格式');
  let url;try{url=new URL(String(c.url).trim());}catch{throw Error('请填写完整的模型服务 URL');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('URL 只接受 HTTP/HTTPS 地址，不能在地址中放密钥、查询参数或账号密码');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('远程模型地址请使用 HTTPS；HTTP 仅用于本机服务');
  let pathname=url.pathname.replace(/\/+$/,'');
  if(c.protocol==='openai'&&/\/(chat\/completions|completions)$/.test(pathname))throw Error('请填 API 基础地址（通常以 /v1 结尾），不要填 /chat/completions');
  if(c.protocol==='gemini'&&/\/(v1beta|v1|models)(\/|$)/.test(pathname))throw Error('Gemini 请填服务根地址，不要附带 /v1beta 或 /models');
  const key=String(c.key??'').trim();
  if(/[\r\n]/.test(key))throw Error('Key 不能包含换行');
  return {protocol:c.protocol,url:url.origin+pathname,key};
}

function validModel(model,protocol){return typeof model==='string'&&model.length>0&&model.length<=160&&!/[\s?#\\]/.test(model)&&!(protocol==='gemini'&&model.includes('/'));}

export function validateConnection(value){
  const c={...DEFAULT_CONNECTION,...value},endpoint=validateEndpoint(c),model=String(c.model??'').trim();
  if(!validModel(model,c.protocol))throw Error('请填写有效的模型名称');
  const maxTokens=c.maxTokens==null||String(c.maxTokens).trim()===''?0:Number(c.maxTokens);
  if(!Number.isSafeInteger(maxTokens)||maxTokens<0)throw Error('输出上限请留空（不主动限制），或填写有效的正整数；0 也表示不限制');
  return {...endpoint,model,maxTokens:maxTokens||null};
}

// ST normalizes both provider formats to {data:[{id}]}. Querying needs no model
// and never reads ST's saved writing credentials or submits a generation prompt.
export async function requestModelList({config,signal,fetcher,origin,headers}){
  signal?.throwIfAborted();
  const c=validateEndpoint(config);
  const body={chat_completion_source:c.protocol==='gemini'?'makersuite':'openai',reverse_proxy:c.url,proxy_password:c.key};
  let response;
  try{response=await fetcher(new URL('/api/backends/chat-completions/status',origin).href,{method:'POST',credentials:'same-origin',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal});}
  catch{if(signal?.aborted)throw signal.reason;throw Error('无法连接酒馆的模型列表接口，请检查网络；也可以手填模型名称。');}
  signal?.throwIfAborted();
  if(!response.ok)throw Error('拉取模型列表失败（HTTP '+response.status+'），请检查 URL 和 Key；也可以手填模型名称。');
  let result;try{result=await response.json();}catch{throw Error('接口未返回可用的模型列表；可以手填模型名称。');}
  signal?.throwIfAborted();
  if(result?.error||!Array.isArray(result?.data))throw Error('服务未提供可用的模型列表，请检查接口格式、URL 和 Key；也可以手填模型名称。');
  return [...new Set(result.data.map(item=>item?.id).filter(id=>validModel(id,c.protocol)))].sort((a,b)=>a.localeCompare(b));
}

export function connectionStore(local,session){
  let key='';try{key=session.getItem(SESSION_KEY)??'';}catch{}
  return {
    read(){let saved={};try{saved=JSON.parse(local.getItem(CONNECTION_KEY))??{};}catch{}return {...DEFAULT_CONNECTION,...saved,key};},
    save(value){const c=validateConnection(value),{key:secret,...publicSettings}=c;local.setItem(CONNECTION_KEY,JSON.stringify(publicSettings));key=secret;try{session.setItem(SESSION_KEY,secret);}catch{}return c;},
    clear(){key='';local.removeItem(CONNECTION_KEY);try{session.removeItem(SESSION_KEY);}catch{}}
  };
}

// Use the user's ST relay with an explicit reverse_proxy and proxy_password.
// An empty key remains empty: ST must not fall back to its saved writing credentials.
export function requestBody(config,prompt){
  const c=validateConnection(config);
  return {chat_completion_source:c.protocol==='gemini'?'makersuite':'openai',reverse_proxy:c.url,proxy_password:c.key,model:c.model,
    messages:[{role:'user',content:prompt}],stream:false,...(c.maxTokens===null?{}:{max_tokens:c.maxTokens}),temperature:0.2,n:1,
    ...(c.protocol==='gemini'?{responseMimeType:'application/json',use_makersuite_sysprompt:false}:{} )};
}

export function parseModelJSON(value){
  if(typeof value!=='string'||!value.trim())throw Error('模型没有返回可用文本');
  const text=value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{const result=JSON.parse(text);if(Array.isArray(result)||Array.isArray(result?.rows))return result;}catch{}
  throw Error('模型返回的标注不是完整 JSON；可检查输出上限后手动重试');
}

export async function requestAnnotation({config,parsed,pack,previous,player,signal,fetcher,origin,headers}){
  signal?.throwIfAborted();
  const body=requestBody(config,annotationPrompt(parsed,pack,previous,player));
  let response;
  try{response=await fetcher(new URL('/api/backends/chat-completions/generate',origin).href,{method:'POST',credentials:'same-origin',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal});}
  catch(e){if(signal?.aborted)throw signal.reason;throw Error('无法连接酒馆的标注转发接口，请检查连接');}
  if(!response.ok)throw Error('标注接口返回 HTTP '+response.status+'；请检查 URL、Key、模型和服务额度');
  let result;try{result=await response.json();}catch{throw Error('标注接口没有返回 JSON');}
  signal?.throwIfAborted();
  // Never display provider error bodies: gateways sometimes echo request credentials.
  if(result.error)throw Error('模型服务拒绝或未完成本次请求，请检查连接设置或在服务端排查');
  if(result.choices?.[0]?.finish_reason==='length')throw Error('模型服务截断了标注；可清空手动输出上限，或检查服务端限制后重试');
  const raw=parseModelJSON(result.choices?.[0]?.message?.content);
  const checked=validateAnnotations(parsed,raw,pack,previous);
  return {...checked,model:body.model,attempt:crypto.randomUUID()};
}
