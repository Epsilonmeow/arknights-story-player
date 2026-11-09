import {REVISION,parseStory,validatePack,validateAnnotations,stageAt,dialogueDisplayText,resolvePlayerIdentity,isStoryReply,preferredReply} from './core.mjs';
import {contextFor,recordMatches,normalizedMessages,correctedTracks} from './continuity.mjs';
import {NODE_KEY,THEMES,validReply,collectNodes,ensureNodeIds,resolveNode} from './assets/catalog.mjs';
import {PLAYER_ID,PLAYER_BINDING,AVATAR_DEFAULTS,avatarPreferences,avatarPreferenceKey,personaSnapshot,replyPlayerBinding,saveReplyBinding,annotationPlayer,playerStagePack,recordPlayerMatches,playerAvatarActive,playerStage,avatarPose} from './assets/player-avatar.mjs';
import {mergeChapter,referencedAssets,assetRecordMatches} from './assets/chapter-library.mjs';
import {annotationQuality,restoreFallbackRows,failureDetail,annotationWarning,createAnnotationRunner} from './assets/annotation-runner.mjs';
import {connectionStore,requestAnnotation,requestModelList} from './annotation-client.mjs';
import {paginatePresentation,pageAtOffset,readableFragmentIndex} from './pagination.mjs';
import {backgroundAllowed,backgroundScore,placeSetting} from './background-policy.mjs';
import {portraitDiagnostics} from './staging.mjs';
import {withNPCActors,npcActorsFrom} from './npc.mjs';
export const RELEASE='0.3.7';
const BASE=new URL('.',import.meta.url).href;
const ASSET_BASE=new URL('../../',import.meta.url).href;
const KEY='ark_story_player_v1';
const RECORD=KEY+'_v2', CONTEXT='ark_story_context_v2';
const BOOK='第九章-风暴瞭望';
export function backgroundFor(stage,library,pack,preview=false) {
  const asset=pack.assets?.find(a=>a.type==='background'&&a.id===stage.background);
  if(pack.backgrounds[stage.background]&&(preview||backgroundAllowed(asset,stage.place)))return {id:stage.background,file:pack.backgrounds[stage.background],generic:false};
  const entries=(library.entries??[]).filter(e=>/^assets\/[\w.\-/]+$/.test(e.file??'')&&!e.file.split('/').includes('..')&&e.originalAssetId!=='bg_black'&&backgroundAllowed(e,stage.place));
  const explicit=entries.find(e=>e.id===stage.background);if(explicit)return {...explicit,generic:true};
  const ranked=entries.map(e=>({entry:e,score:backgroundScore(e,stage.place)})).sort((a,b)=>b.score-a.score);
  const defaultId=placeSetting(stage.place)==='indoor'?(library.indoorDefaultId??'generic-indoor-corridor'):library.defaultId;
  const choice=ranked[0]?.score>0?ranked[0].entry:entries.find(e=>e.id===defaultId)??entries[0];
  return choice?{...choice,generic:true}:{id:null,file:null,generic:false};
}
// Presentation-only references stay outside pack.json so a layout change never invalidates paid annotations.
export function mergePortraitLayout(composition,poses,baseCharacters={}){
  for(const [id,p]of Object.entries(poses)){
    const old=composition.characters[id];
    if(!old)composition.characters[id]=p;
    else{const fresh=Object.fromEntries(Object.entries(p.variants??{}).filter(([v])=>!baseCharacters[id]?.variants?.[v]));composition.characters[id]={...old,variants:{...fresh,...old.variants}};}
  }
  return composition;
}
export function portraitStyle(composition,id,variant,x) {
  const entry=composition.characters?.[id],p=entry?.variants?.[variant]??entry;
  if(p?.nonhuman)return {width:'min(90vh,90vw)',height:'min(90vh,90vw)',top:'5vh',x:x+'%',transform:'translateX(-50%)',calibrated:false};
  const face=p?.face??entry?.face,canvas=p?.canvas??entry?.canvas;
  if(canvas?.every(n=>Number.isFinite(n)&&n>0)&&face?.eye?.every(Number.isFinite)&&Number.isFinite(face.chinY)&&face.chinY>face.eye[1]){
    // Covered faces need a visually reviewed adjustment: a mask can extend beyond the chin.
    const scale=Number.isFinite(face.scale)&&face.scale>0?face.scale:1;
    const size=n=>`min(${(composition.faceHeightVh*n*scale/(face.chinY-face.eye[1])).toFixed(4)}vh,${(composition.faceHeightVw*n*scale/(face.chinY-face.eye[1])).toFixed(4)}vw)`;
    return {width:size(canvas[0]),height:size(canvas[1]),top:`calc(${composition.eyeLineVh+(face.eyeOffsetVh??0)}vh - ${size(face.eye[1])})`,x:x+'%',transform:`translateX(${-100*face.eye[0]/canvas[0]}%)`,calibrated:true};
  }
  if(!p?.canvas?.every(n=>Number.isFinite(n)&&n>0)||!p.headTop?.every(Number.isFinite)||!(p.headHeight>0))return {width:'min(145vh,180vw)',height:'min(145vh,180vw)',top:'8%',x:x+'%',transform:'translateX(-50%)',calibrated:false};
  const size=n=>`min(${(composition.headHeightVh*n/p.headHeight).toFixed(4)}vh,${(composition.headHeightVw*n/p.headHeight).toFixed(4)}vw)`;
  return {width:size(p.canvas[0]),height:size(p.canvas[1]),top:`calc(${composition.headTopVh}vh - ${size(p.headTop[1])})`,x:x+'%',transform:`translateX(${-100*p.headTop[0]/p.canvas[0]}%)`,calibrated:true};
}
const icon=(name)=>({settings:'<svg viewBox="0 0 24 24"><path d="M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2z"/><circle cx="12" cy="12" r="3"/></svg>',hide:'<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM3 21 21 3"/><circle cx="12" cy="12" r="3"/></svg>'}[name]);
export async function mount(host=null) {
  const win=host?.parent??window, doc=win.document, store=win.localStorage;
  if(win.__arkPlayer) {win.__arkPlayer.open();return win.__arkPlayer;}
  const basePack=validatePack(await(await fetch(BASE+'pack.json')).json());
  const packHash=await digest(JSON.stringify(basePack));
  const composition=await fetch(BASE+'assets/portrait-layout.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
  const backgroundLibrary=await fetch(BASE+'assets/background-library.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
  const chapter=await fetch(BASE+'assets/chapter09/library.json').then(r=>{if(!r.ok)throw Error('第九章素材清单未加载');return r.json();});
  const supplement=await fetch(BASE+'assets/mostima/library.json').then(r=>{if(!r.ok)throw Error('补充人物素材清单未加载');return r.json();});
  const merged=mergeChapter(basePack,chapter,backgroundLibrary,supplement),pack=validatePack(merged.pack);
  backgroundLibrary.entries.push(...merged.backgroundEntries.filter(a=>!backgroundLibrary.entries.some(b=>b.id===a.id)));
  mergePortraitLayout(composition,merged.poses,basePack.characters);
  const style=doc.createElement('style');style.textContent=await(await fetch(BASE+'style.css')).text();doc.head.append(style);
  const entry=doc.createElement('button');entry.id='ark-entry';entry.textContent='剧情播放器';doc.body.append(entry);
  const root=doc.createElement('section');root.id='ark-player';root.setAttribute('aria-label','AI正文演出播放器');root.dataset.revision=REVISION;root.dataset.release=RELEASE;root.hidden=true;
  root.innerHTML=`<div class="ark-shell"><div class="ark-stage" role="button" tabindex="0" aria-label="点击继续剧情"><div class="ark-neutral"></div><img class="ark-bg" alt="场景背景" hidden><div class="ark-actors"></div><img class="ark-illustration" alt="剧情插图" hidden><div class="ark-vignette"></div></div><div class="ark-communications" aria-label="通讯与画外人物"></div>
    <nav class="ark-top" aria-label="播放控制"><div><button data-action="settings" aria-label="设置">${icon('settings')}</button><button data-action="catalog">剧情目录</button><button data-action="log">LOG 回顾</button><button data-action="hide" aria-label="隐藏界面">${icon('hide')}</button></div><div><button data-action="auto" aria-pressed="false">自动 OFF</button><button data-action="skip">跳过本条</button><button data-action="close">返回酒馆</button></div></nav>
    <div class="ark-dialogue"><span class="ark-name"></span><div class="ark-text"><div class="ark-line"></div><div class="ark-original" role="region" aria-label="本段原语（可滚动）" tabindex="0" hidden></div></div></div>
    <div class="ark-bottom"><div><button data-action="previous">上一句</button><button data-action="next">下一句</button><button data-action="language" aria-expanded="false">展开原语</button><button data-action="stage">舞台/位置</button><button data-action="world">世界书</button><button data-action="library">素材库</button><button data-action="return-chat" hidden>返回当前聊天</button></div><span class="ark-status" role="status" aria-live="polite"></span></div>
    <div class="ark-end" hidden><span>本条已读完</span><button data-action="close">返回酒馆继续</button><button data-action="log">回顾原文</button></div></div><button class="ark-restore" data-action="restore" hidden>显示界面</button><aside class="ark-panel" role="dialog" aria-modal="true" aria-label="播放器面板" hidden><header><h2></h2><button data-action="panel-close" aria-label="关闭面板">关闭</button></header><div class="ark-panel-body"></div></aside>`;
  doc.body.append(root);
  const $=s=>root.querySelector(s), panel=$('.ark-panel'), panelBody=$('.ark-panel-body');
  $('.ark-bg').onerror=()=>{$('.ark-bg').hidden=true;$('.ark-neutral').hidden=false;status('背景素材加载失败，已使用中性背景');};
  $('.ark-illustration').onerror=()=>{$('.ark-illustration').hidden=true;status('插图素材加载失败，已回退正文演出');};
  const core=()=>host?.core();
  const connection=connectionStore(store,win.sessionStorage);
  let parsed=parseStory(''), rows=[], initial={}, position=0, mode='empty', messageId=null, sourceHash='', chatKey='', busy=false, auto=false, expanded=false, typing=null, autoTimer=null, abort=null, destroyed=false, session=0, panelOpener=null;
  let stageTracks={}, continuity=null, currentCorrections=[], observedSources=[], observedCorrections='', observedPlayer='', format='auto';
  let displayedText='',displayedOriginal='',pageIdentity='',pageOffset=0,pageIndex=0,pageAtEnd=false,pages=[];
  let pageCache=null;
  const pageIdentityNow=()=>[mode,messageId,sourceHash,position].join(':');
  const measure=doc.createElement('div');measure.className='ark-page-measure';measure.setAttribute('aria-hidden','true');measure.innerHTML='<div class="ark-line"></div>';root.append(measure);
  const measureText=measure.querySelector('.ark-line');
  let selectedNode=null,syncing=false,catalogSaving=null;
  let activeBinding=null;
  let loadedAnnotation=null,annotationNotice='';
  const annotationRunner=createAnnotationRunner();
  const failedAvatars=new Set();
  const failedPortraits=new Map();
  const preloaded=new Map();
  const disposers=[];
  const messageCacheKey=(id,hash)=>[KEY,'cache',chatIdentity(),id,hash,packHash,REVISION].join(':');
  const chatIdentity=()=>{const c=core();return c ? String(c.characters?.[c.characterId]?.avatar??c.groupId??'')+'|'+String(c.getCurrentChatId?.()??c.chatId??'') : 'offline';};
  const status=text=>{$('.ark-status').textContent=text;};
  const annotationStatus=text=>{annotationNotice=text;status(text);const notice=$('.ark-annotation-feedback');if(notice)notice.textContent=text;};
  const corrections=()=>(core()?.chatMetadata?.[CONTEXT]?.corrections??[]).filter(f=>assetRecordMatches(f,pack));
  const readRecord=(id,hash)=>{let cached;try{cached=JSON.parse(store.getItem(messageCacheKey(id,hash)));}catch{}const binding=replyPlayerBinding(core()?.chat??[],id,win.location.origin);return [cached,core()?.chat[id]?.extra?.[RECORD]].find(r=>r&&recordPlayerMatches(r,binding)&&assetRecordMatches(r,pack));};
  const player=()=>resolvePlayerIdentity(core()?.name1??core()?.chat.filter(m=>m.is_user).at(-1)?.name??'',pack);
  const persona=()=>personaSnapshot(host?.helper,win.location.origin);
  const avatarPrefs=p=>{try{return avatarPreferences(JSON.parse(store.getItem(avatarPreferenceKey(p.id))));}catch{return avatarPreferences();}};
  const boundIdentity=()=>resolvePlayerIdentity(activeBinding?.playerName??player().playerName,pack);
  const annotationIdentity=()=>annotationPlayer(boundIdentity(),activeBinding);
  const npcEnabled=()=>store.getItem(KEY+':generic-npc')!=='false';
  const stagePack=()=>withNPCActors({...playerStagePack(pack,annotationIdentity()),currentPlayerName:boundIdentity().playerName,npcEnabled:npcEnabled()},npcActorsFrom(initial,loadedAnnotation?.npcActors));
  function avatarView(){const p=persona(),prefs=avatarPrefs(p);return {persona:p,prefs,active:playerAvatarActive(p,activeBinding,prefs)&&!failedAvatars.has(p.url)};}
  const context=async id=>contextFor(normalizedMessages(core().chat),id,packHash,REVISION,corrections(),digest,readRecord,player());
  // Installed ST exposes streamingProcessor in getContext; #mes_stop is shown throughout non-streaming generation too.
  const generating=()=>!!(doc.querySelector('#mes_stop')&&win.getComputedStyle(doc.querySelector('#mes_stop')).display!=='none')||!!(core()?.streamingProcessor&&!core().streamingProcessor.isFinished&&!core().streamingProcessor.isStopped);
  async function ensureCatalog(){
    if(!host||generating())return;
    if(catalogSaving)return catalogSaving;
    if(ensureNodeIds(core().chat)){catalogSaving=Promise.resolve(core().saveChat());try{await catalogSaving;}finally{catalogSaving=null;}}
  }
  function observeSources(){observedSources=core()?.chat.map(m=>[m.mes,m.swipe_id??0,m.extra?.ark_story_format??'auto'])??[];observedCorrections=JSON.stringify(corrections());observedPlayer=JSON.stringify([player(),persona()]);}
  function saveProgress() {
    const key=[KEY,'progress',mode,mode==='chat'?chatIdentity():'sample',selectedNode??messageId??'',sourceHash].join(':');
    store.setItem(key,JSON.stringify({position,expanded,pageOffset}));
    if(mode==='chat'&&messageId!==null) store.setItem(KEY+':selected:'+chatIdentity(),String(messageId));
    if(mode==='chat'&&selectedNode)store.setItem(KEY+':selected-node:'+chatIdentity(),selectedNode);
    store.setItem(KEY+':mode:'+chatIdentity(),mode);
  }
  function restoreProgress() {
    const key=[KEY,'progress',mode,mode==='chat'?chatIdentity():'sample',selectedNode??messageId??'',sourceHash].join(':');
    const legacy=[KEY,'progress',mode,mode==='chat'?chatIdentity():'sample',messageId??'',sourceHash].join(':');
    pageOffset=0;pageAtEnd=false;
    try {const saved=JSON.parse(store.getItem(key)??store.getItem(legacy));position=Math.min(Math.max(0,saved?.position??0),Math.max(0,parsed.fragments.length-1));expanded=Boolean(saved?.expanded);pageOffset=Number.isSafeInteger(saved?.pageOffset)&&saved.pageOffset>=0?saved.pageOffset:0;}catch {position=0;}
    pageIdentity=pageIdentityNow();
  }
  function stopTimers() {if(typing) clearInterval(typing);clearTimeout(autoTimer);typing=null;autoTimer=null;}
  function scheduleAuto() {
    clearTimeout(autoTimer);
    if(auto && !root.hidden && panel.hidden && !busy) autoTimer=setTimeout(next,Math.max(1800,(displayedText.length+displayedOriginal.length)*55));
  }
  function updateAuto() {$('[data-action=auto]').textContent='自动 '+(auto?'ON':'OFF');$('[data-action=auto]').setAttribute('aria-pressed',String(auto));}
  function completeText() {if(typing) clearInterval(typing);typing=null;$('.ark-line').textContent=displayedText;$('.ark-line').setAttribute('aria-busy','false');scheduleAuto();}
  function paginateView(text,original){
    const identity=pageIdentityNow();if(identity!==pageIdentity){pageOffset=0;pageIdentity=identity;}
    const box=$('.ark-text'),width=box.getBoundingClientRect().width,height=Math.floor(parseFloat(win.getComputedStyle(box).maxHeight))-2;
    const mainStyle=win.getComputedStyle($('.ark-line')),lineHeight=parseFloat(mainStyle.lineHeight);
    const key=JSON.stringify([text,width,height,mainStyle.font,lineHeight]);
    if(pageCache?.key!==key){
      measure.style.width=width+'px';
      // Only main text determines pages. Original-language text scrolls independently.
      const fits=page=>{measureText.textContent=page.text;return measureText.getBoundingClientRect().height<=lineHeight*3+0.5&&measure.getBoundingClientRect().height<=height;};
      pages=paginatePresentation(text,fits);pageCache={key,pages};
    }else pages=pageCache.pages;
    pageIndex=pageAtEnd?pages.length-1:pageAtOffset(pages,pageOffset);pageAtEnd=false;
    const page=pages[pageIndex]??{text:'',start:0};pageOffset=page.start;displayedText=page.text;displayedOriginal=original.trim();
    $('.ark-line').hidden=!page.text;
    const originalBox=$('.ark-original');
    if(originalBox.textContent!==displayedOriginal){originalBox.textContent=displayedOriginal;originalBox.scrollTop=0;}
    originalBox.hidden=!displayedOriginal;
    measureText.textContent=page.text;
    originalBox.style.maxHeight=Math.max(0,height-measureText.getBoundingClientRect().height-12)+'px';
    root.dataset.page=String(pageIndex+1);root.dataset.pages=String(pages.length);root.dataset.pageOffset=String(pageOffset);
  }
  function render(full=false) {
    stopTimers();if(root.hidden)return;
    const readable=readableFragmentIndex(parsed.fragments,position),previousReadable=readable<0?readableFragmentIndex(parsed.fragments,position,-1):-1;
    if(readable>=0)position=readable;else if(previousReadable>=0)position=previousReadable;
    const f=readable>=0||previousReadable>=0?parsed.fragments[position]:null;
    $('[data-action=return-chat]').hidden=mode!=='asset-preview';root.dataset.mode=mode;
    $('.ark-end').hidden=true;
    root.querySelectorAll('[data-action=previous],[data-action=next],[data-action=language],[data-action=stage],[data-action=skip],[data-action=auto]').forEach(b=>b.disabled=!f);
    if(!f) {displayedText='';displayedOriginal='';pages=[];pageCache=null;$('.ark-line').hidden=false;status('等待AI回复 · 不会自动生成或标注');$('.ark-line').textContent=host?'当前没有可播放的AI正文。返回酒馆生成回复后，再打开播放器。':'请在酒馆助手中打开播放器，读取当前聊天的AI回复。';$('.ark-name').textContent='';$('.ark-original').hidden=true;$('.ark-bg').hidden=true;$('.ark-illustration').hidden=true;$('.ark-neutral').hidden=false;$('.ark-actors').replaceChildren();$('.ark-communications').replaceChildren();return;}
    const r=rows[position]??{};const state=stageAt(parsed.fragments,rows,position,initial,loadedAnnotation?.npcActors);stageTracks=correctedTracks(state.tracks,currentCorrections,position);
    const avatar=avatarView(),identity=boundIdentity();let scenePack=stagePack();
    const s=playerStage(stageTracks[f.track]??state.stage,r,identity,activeBinding,avatar.active);
    scenePack=withNPCActors(scenePack,s.npcActors);
    const visual=backgroundFor(s,backgroundLibrary,pack,mode==='asset-preview'),bg=$('.ark-bg'),bgPath=visual.file;bg.hidden=!bgPath;if(bgPath) bg.src=ASSET_BASE+bgPath;
    $('.ark-neutral').hidden=!!bgPath;
    const illustration=$('.ark-illustration');const art=pack.illustrations?.[s.illustration];illustration.hidden=!art;if(art) illustration.src=ASSET_BASE+art;
    const actors=$('.ark-actors');actors.replaceChildren();const list=(s.display??[]).filter(id=>npcEnabled()||!scenePack.characters[id]?.npcBinding);
    list.forEach((id,i)=>{
      const c=scenePack.characters[id];if(!c)return;
      const img=doc.createElement('img');img.className='ark-actor'+(s.focus===id?' active':'');img.alt=c.name;
      const useAvatar=avatar.active&&id===(identity.characterId??PLAYER_ID);
      const variant=s.variants?.[id]??c.default;img.src=useAvatar?avatar.persona.url:ASSET_BASE+(c.variants[variant]??c.variants[c.default]);
      // One head/body scale for any actor count; legacy pair size/y overrides are deliberately unused.
      const pose=useAvatar?avatarPose(avatar.prefs,(i+1)/(list.length+1)*100):portraitStyle(composition,c.portraitId??id,variant,(i+1)/(list.length+1)*100);
      img.style.setProperty('--x',pose.x);img.style.setProperty('--y',pose.top);
      img.style.setProperty('--size',pose.width);img.style.setProperty('--height',pose.height);img.style.transform=pose.transform;img.dataset.calibrated=String(pose.calibrated);
      img.dataset.playerAvatar=String(useAvatar);if(useAvatar)img.dataset.personaId=avatar.persona.id;
      img.style.zIndex=String(s.focus===id?list.length+2:s.front===id?list.length+1:i);watchPortrait(img,c.name,useAvatar,avatar.persona.url);actors.append(img);
    });
    const comm=$('.ark-communications');comm.replaceChildren();
    for(const id of (s.communication??[]).filter(id=>npcEnabled()||!scenePack.characters[id]?.npcBinding)) {
      const c=scenePack.characters[id];if(!c)continue;
      const frame=doc.createElement('figure'),img=doc.createElement('img'),caption=doc.createElement('figcaption');
      const useAvatar=avatar.active&&id===(identity.characterId??PLAYER_ID);
      img.alt=c.name+'（通讯）';img.src=useAvatar?avatar.persona.url:ASSET_BASE+(c.variants[s.variants?.[id]]??c.variants[c.default]);watchPortrait(img,c.name,useAvatar,avatar.persona.url);caption.textContent=c.name+' · 通讯（不在同地）';frame.append(img,caption);comm.append(frame);
    }
    $('.ark-name').textContent=(r.speaker??'')+(r.speaker&&r.kind==='communication'?' · 通讯':r.speaker&&r.kind==='voiceover'?' · 画外':'');
    $('.ark-name').title=$('.ark-name').textContent;
    $('.ark-dialogue').classList.toggle('unnamed',!r.speaker);
    $('.ark-dialogue').classList.toggle('center',r.kind==='center');
    paginateView(dialogueDisplayText(f.text,r,scenePack,s.nodeId),expanded?dialogueDisplayText(f.original??'',r,scenePack,s.nodeId):'');
    $('[data-action=language]').textContent=expanded?'收起原语':'展开原语';$('[data-action=language]').setAttribute('aria-expanded',String(expanded));
    status((mode==='asset-preview'?'素材独立预览（非聊天）':'聊天 #'+messageId)+' · '+(f.track==='main'?'主线':'平行事件')+' · '+(position+1)+' / '+parsed.fragments.length+(pages.length>1?` · 本段 ${pageIndex+1}/${pages.length} 页`:'')+(r.fallback?' · 原文回退':'')+(visual.generic?' · '+visual.label:!bgPath?' · 无背景素材':''));
    const missing=mode==='chat'&&portraitDiagnostics([{...r,...s}],scenePack).find(n=>n.reason==='not-displayed');
    if(missing)$('.ark-status').textContent+=' · 可能漏配立绘：'+missing.speaker+'（舞台/位置可查看）';
    root.dataset.background=visual.id??'';root.dataset.backgroundKind=visual.generic?'generic':'dedicated';root.dataset.place=s.place??'';root.dataset.node=s.nodeId??'';root.dataset.ancestor=continuity?.ancestor??'';
    root.dataset.lineage=continuity?.expected.lineageHash??'';root.dataset.playerId=player().characterId??'';
    root.dataset.personaApi=String(avatar.persona.capable);root.dataset.personaId=avatar.persona.id??'';root.dataset.avatarEnabled=String(avatar.prefs.enabled);root.dataset.avatarBound=activeBinding?.personaId??'';root.dataset.avatarVisible=String(!!actors.querySelector('[data-player-avatar=true]'));
    root.dataset.position=position;root.dataset.fragment=f.id;root.dataset.track=f.track;root.dataset.sourceHash=sourceHash;root.dataset.chapterAssets=pack.chapterRegistry.length;root.dataset.extraAssets=pack.supplementRegistry.length;root.dataset.portraitLayout=composition.revision??'legacy';root.dataset.textFlow='sentence-scroll-20261108';root.dataset.illustration=s.illustration??'';
    const text=displayedText;let count=0;
    if(full || win.matchMedia('(prefers-reduced-motion: reduce)').matches) completeText();
    else {const chars=Array.from(text);$('.ark-line').textContent='';$('.ark-line').setAttribute('aria-busy','true');typing=setInterval(()=>{count=Math.min(count+3,chars.length);$('.ark-line').textContent=chars.slice(0,count).join('');if(count>=chars.length)completeText();},22);}
    saveProgress();
    preloadNext();
  }
  function preloadNext() {
    const nextPosition=readableFragmentIndex(parsed.fragments,position+1);if(nextPosition<0)return;
    const avatar=avatarView(),scenePack=stagePack(),identity=boundIdentity(),next=playerStage(stageAt(parsed.fragments,rows,nextPosition,initial,loadedAnnotation?.npcActors).stage,rows[nextPosition]??{},identity,activeBinding,avatar.active);
    const paths=[backgroundFor(next,backgroundLibrary,pack).file,...[...(next.display??[]),...(next.communication??[])].map(id=>avatar.active&&id===(identity.characterId??PLAYER_ID)?avatar.persona.url:scenePack.characters[id]?.variants[next.variants?.[id]??scenePack.characters[id]?.default])].filter(Boolean).slice(0,4);
    for(const path of paths)if(!preloaded.has(path)){const img=new win.Image();img.decoding='async';img.src=path===avatar.persona.url?path:ASSET_BASE+path;preloaded.set(path,img);if(preloaded.size>8)preloaded.delete(preloaded.keys().next().value);}
  }
  function next() {if(busy||!panel.hidden)return;if(typing)return completeText();if(pageIndex+1<pages.length){pageOffset=pages[pageIndex+1].start;render();}else {const nextPosition=readableFragmentIndex(parsed.fragments,position+1);if(nextPosition>=0){position=nextPosition;render();}else {auto=false;updateAuto();$('.ark-end').hidden=false;}}}
  function previous() {if(busy)return;if(pageIndex>0)pageOffset=pages[pageIndex-1].start;else {const previousPosition=readableFragmentIndex(parsed.fragments,position-1,-1);if(previousPosition>=0){position=previousPosition;pageAtEnd=true;}}render(true);}
  let panelCleanup=()=>{};
  function closePanel() {panelCleanup();panelCleanup=()=>{};panel.hidden=true;panel.classList.remove('ark-catalog');panelBody.replaceChildren();panelOpener?.focus();scheduleAuto();}
  function showPanel(title) {panelCleanup();panelCleanup=()=>{};stopTimers();completeText();clearTimeout(autoTimer);if(panel.hidden)panelOpener=doc.activeElement;panel.hidden=false;panel.classList.remove('ark-catalog');panel.querySelector('h2').textContent=title;panelBody.replaceChildren();panel.querySelector('button').focus();}
  function paragraph(text,cls='') {const p=doc.createElement('p');p.textContent=text;p.className=cls;panelBody.append(p);return p;}
  function button(text,handler,parent=panelBody) {const b=doc.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>Promise.resolve().then(handler).catch(e=>status(e.message)));parent.append(b);return b;}
  function actions() {const d=doc.createElement('div');d.className='ark-actions';panelBody.append(d);return d;}
  function rawBlock(text) {const pre=doc.createElement('pre');pre.className='ark-raw';pre.textContent=text;panelBody.append(pre);}
  function assetLibrary(){
    showPanel('素材库 · 独立预览');
    paragraph(`第九章${pack.chapterRegistry.length}项；补充人物${pack.supplementRegistry.length}项（莫斯提马）。自动候选共${merged.counts.automatic}项，受限${merged.counts.restricted}项；资源组不等于人数。`);
    paragraph('这里预览图片，不改聊天、世界书、阅读进度或User设置，也不请求模型。未知/共享人物仅能查看原图，不能自动借给玩家。插图是完整情节画面。','ark-muted');
    const select=(label,items,selected)=>{const l=doc.createElement('label');l.textContent=label;const s=doc.createElement('select');s.setAttribute('aria-label',label);const none=doc.createElement('option');none.value='';none.textContent='不显示';s.append(none);for(const a of items){const o=doc.createElement('option'),npc=pack.npcPortraits[a.id];o.value=a.id;o.textContent=(npc?.label??a.label??a.name??a.id)+' · '+a.id+(npc?'（通用外观）':a.manualOnly?'（受限/手动）':'');s.append(o);}s.value=selected??'';l.append(s);panelBody.append(l);return s;};
    const registry=[...pack.chapterRegistry,...pack.supplementRegistry];
    const character=select('预览人物差分',registry.filter(a=>a.type==='character'),'avg_479_sleach_1#1$1'),background=select('预览背景',registry.filter(a=>a.type==='background'),'21_G9_rhodes_xqoffice'),illustration=select('预览剧情插图',registry.filter(a=>a.type==='illustration'),'');
    const figure=doc.createElement('figure');figure.className='ark-library-figure';const image=doc.createElement('img');image.alt='所选资源原图预览';const caption=doc.createElement('figcaption');figure.append(image,caption);panelBody.append(figure);
    const show=select=>{const a=registry.find(a=>a.id===select.value);image.hidden=!a;if(a){const npc=pack.npcPortraits[a.id];image.src=ASSET_BASE+a.file;caption.textContent=a.description+' '+(npc?'已确认通用用途：'+npc.label+'。'+npc.restriction+' 原剧情使用称谓：'+(npc.usageRoles.join('、')||'未记录')+'。这些称谓不合并为同一个人。 ':'')+(a.provenance?.restrictions??[]).join(' ');}else caption.textContent='请选择图片。';};
    for(const s of [character,background,illustration])s.addEventListener('change',()=>show(s));show(character);
    button('在独立舞台预览所选素材',()=>{
      const a=registry.find(a=>a.id===character.value),bg=registry.find(a=>a.id===background.value),art=registry.find(a=>a.id===illustration.value);
      if(a&&!a.characterId)throw Error('这张图片身份未确认或是共享图，只能在上方查看，不套到聊天人物。');
      const c=a?pack.characters[a.characterId]:null;
      session++;mode='asset-preview';messageId=null;activeBinding=null;sourceHash='asset-preview';initial={};currentCorrections=[];continuity=null;auto=false;updateAuto();
      parsed=parseStory('素材预览（非聊天）：'+(a?a.id+'。'+a.description:'未选人物')+(bg?'；背景：'+bg.label:'')+(art?'；插图：'+art.id+'。'+art.description:''),1000);
      rows=parsed.fragments.map(f=>({id:f.id,kind:'narration',speaker:'',sceneChange:true,background:bg?.id??null,place:null,present:c?[c.name]:[],display:c?[a.characterId]:[],focus:c?a.characterId:null,front:c?a.characterId:null,variants:c?{[a.characterId]:a.variant}:{},remote:[],communication:[],referenced:[],illustration:art?.id??null}));
      position=0;closePanel();render(true);
    });
    button('返回当前聊天',()=>loadPreferred());
  }
  async function catalog(){
    await ensureCatalog();showPanel('剧情目录');panel.classList.add('ark-catalog');
    let saved={};try{saved=JSON.parse(store.getItem(KEY+':catalog-theme:'+chatIdentity()))??{};}catch{}
    const themeId=THEMES[saved.chapter]&&!THEMES[saved.chapter].disabled?saved.chapter:'9',theme=THEMES[themeId];
    const backgroundId=theme.backgrounds[saved.background]?saved.background:theme.defaultBackground;
    const toolbar=actions();toolbar.classList.add('ark-catalog-toolbar');
    const chapter=doc.createElement('select');chapter.setAttribute('aria-label','目录章节主题');
    for(const [id,t]of Object.entries(THEMES)){const o=doc.createElement('option');o.value=id;o.textContent=t.label;o.disabled=!!t.disabled;chapter.append(o);}chapter.value=themeId;toolbar.append(chapter);
    const backgrounds=doc.createElement('select');backgrounds.setAttribute('aria-label','目录背景');
    for(const [id,bg]of Object.entries(theme.backgrounds)){const o=doc.createElement('option');o.value=id;o.textContent=bg.label;backgrounds.append(o);}backgrounds.value=backgroundId;toolbar.append(backgrounds);
    const saveTheme=()=>{store.setItem(KEY+':catalog-theme:'+chatIdentity(),JSON.stringify({chapter:chapter.value,background:backgrounds.value}));catalog();};
    chapter.addEventListener('change',saveTheme);backgrounds.addEventListener('change',saveTheme);
    button('刷新目录',catalog,toolbar);
    const nodes=host?collectNodes(core().chat,theme.prefix):[];
    paragraph(`${nodes.length} 条AI剧情回复 · 每条回复一个节点 · 点击继续阅读`,'ark-catalog-intro');
    const map=doc.createElement('div');map.className='ark-catalog-map';map.style.backgroundImage=`linear-gradient(0deg,rgba(9,15,20,.75),rgba(9,15,20,.25)),url("${ASSET_BASE+theme.backgrounds[backgroundId].file}")`;panelBody.append(map);
    if(!nodes.length){const empty=doc.createElement('p');empty.className='ark-catalog-empty';empty.textContent=generating()?'回复仍在生成，完成后刷新目录。':'还没有可播放的AI剧情回复。返回酒馆生成正文后，再打开目录。';map.append(empty);}
    else{
      const scroller=doc.createElement('div');scroller.className='ark-catalog-scroll';scroller.tabIndex=0;scroller.setAttribute('aria-label','聊天剧情节点，可横向滚动');map.append(scroller);
      const route=doc.createElement('div');route.className='ark-catalog-route';route.style.width=Math.max(660,nodes.length*190+120)+'px';scroller.append(route);
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${Math.max(660,nodes.length*190+120)} 360`);svg.setAttribute('aria-hidden','true');route.append(svg);
      const line=doc.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',nodes.map((_,i)=>`${100+i*190},${i%2?210:130}`).join(' '));svg.append(line);
      nodes.forEach((node,i)=>{const b=button('',async()=>{if(generating())throw Error('回复仍在生成，请完成后再回放');const id=resolveNode(core().chat,node.id);if(id<0){await catalog();status('这条回复已删除或已不含正文，目录已刷新。');return;}await loadMessage(id);},route);b.className='ark-catalog-node';b.dataset.nodeId=node.id;b.style.left=(100+i*190)+'px';b.style.top=(i%2?210:130)+'px';b.setAttribute('aria-label',node.label+' · '+node.preview);b.title=node.preview;
        if(node.id===selectedNode){b.setAttribute('aria-current','true');}
        b.innerHTML='<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M40 4 71 22 71 58 40 76 9 58 9 22Z"/><path class="ark-node-mark" d="M26 30h28M26 40h28M26 50h18"/></svg>';
        const label=doc.createElement('span');label.className='ark-node-label';label.textContent=node.label;b.append(label);
        const detail=doc.createElement('small');detail.textContent=node.id===selectedNode?'正在阅读':'AI 剧情';b.append(detail);
      });
      const current=nodes.findIndex(n=>n.id===selectedNode);if(current>1)scroller.scrollLeft=Math.max(0,100+current*190-scroller.clientWidth/2);
    }
    paragraph('编号按当前聊天顺序排列；编辑或切换备选仍是同一节点。主题只换目录画面，第十章素材待接入。','ark-muted');
  }
  function watchPortrait(img,name,useAvatar,avatarUrl){
    img.onload=()=>{if(img.isConnected)failedPortraits.delete(img.src);};
    img.onerror=()=>{if(!img.isConnected)return;failedPortraits.set(img.src,name);img.remove();if(useAvatar)failedAvatars.add(avatarUrl);status(name+'的立绘图片加载失败，保留姓名和正文；可在设置中检查人物显示。');};
  }
  function portraitReview(){
    showPanel('人物显示检查');
    paragraph('这里只检查现有演出，不调用模型、不修改正文或标注。提示表示可能遗漏，不代表程序已经理解整段剧情。');
    if(!rows.some(r=>!r.fallback)){paragraph('当前没有可检查的有效演出标注。请先读取已有演出，或在设置中请求标注。');return;}
    const effective=rows.map((r,i)=>({...r,...correctedTracks(stageAt(parsed.fragments,rows,i,initial,loadedAnnotation?.npcActors).tracks,currentCorrections,i)[parsed.fragments[i]?.track]}));
    const notes=portraitDiagnostics(effective,stagePack());
    if(!notes.length)paragraph('未发现有可用立绘的现场说话人漏配，或现场说话人缺少素材的情况。仅检查已标为在场的直接对白，不保证所有出入场都正确。');
    for(const note of notes){const index=parsed.fragments.findIndex(f=>f.id===note.id);const text=note.reason==='not-displayed'?'有可用立绘，但没有安排显示（可能漏配）':'没有可自动使用的对应立绘，保留名字与对白';button(`第 ${index+1} 段 · ${note.speaker}：${text}`,()=>{position=index;closePanel();render(true);});}
    if(failedPortraits.size)paragraph('本次已观察到图片加载失败：'+[...new Set(failedPortraits.values())].join('、')+'。这与标注没选人物是两种情况；可检查网络后重新打开该段。');
    paragraph('旧演出不会因升级自动补全。需要重做时，在设置中点击“重新标注演出”；每次会新请求一次标注模型。','ark-muted');
  }
  async function settings() {
    showPanel('设置与消息');paragraph('AI正文演出播放器 '+RELEASE+' · 第九章');
    paragraph(host?'已接入酒馆助手 '+host.helper.getTavernHelperVersion()+' / SillyTavern '+host.helper.getTavernVersion():'请在酒馆助手中打开播放器。');
    connectionSettings();
    const npcLabel=doc.createElement('label'),npcToggle=doc.createElement('input');npcToggle.type='checkbox';npcToggle.checked=npcEnabled();npcToggle.disabled=busy;npcToggle.setAttribute('aria-label','允许通用 NPC 立绘');npcLabel.append(npcToggle,doc.createTextNode('允许通用 NPC 立绘（关闭仅隐藏通用图，不删旧演出）'));panelBody.append(npcLabel);npcToggle.addEventListener('change',()=>{store.setItem(KEY+':generic-npc',String(npcToggle.checked));render(true);});
    const a=actions();paragraph('在普通酒馆生成正文，再来这里逐句播放。标注只整理演出，不改写正文，不要求推进原作主线。');
    if(host){const p=player();paragraph('当前玩家：'+(p.playerName||'未知')+(p.characterId?'（已对应'+p.name+'素材，是否在场仍按正文）':'（没有专属素材，可在下方选择使用自己的单图）'));avatarSettings();}
    if(host) {
      button('读取当前聊天最新回复',()=>loadLatest(),a);
      paragraph('选择历史消息只读取内容，不触发生成。编辑或切换回复后，旧标注会失效。');
      const select=doc.createElement('select');select.setAttribute('aria-label','选择聊天消息');
      const messages=host.helper.getChatMessages('0-{{lastMessageId}}',{role:'assistant'});
      for(const m of messages.filter(m=>isStoryReply(core().chat[m.message_id],m.message_id))) {const o=doc.createElement('option');o.value=m.message_id;const preview=parseStory(m.message,180,core().chat[m.message_id]?.extra?.ark_story_format??'auto').fragments[0]?.text??'没有可播放正文';o.textContent='#'+m.message_id+' '+preview.slice(0,45).replace(/\s+/g,' ');select.append(o);}
      if(messageId!==null)select.value=String(messageId);panelBody.append(select);button('读取选定消息',()=>loadMessage(Number(select.value)));
      if(core().chat[0]&&!isStoryReply(core().chat[0],0))button('查看角色卡开局原文',()=>{showPanel('角色卡开局资料 · 原文');rawBlock(core().chat[0].mes);});
    }
    const b=actions();
    for(const [label,force]of [['请求演出标注',false],['重新标注演出',true]]){const request=button(label,()=>annotate(force),b);request.dataset.annotationRequest='true';request.disabled=busy||!host||messageId===null||!parsed.fragments.length;}
    const cancel=button('取消标注',()=>annotationRunner.cancel(),b);cancel.dataset.annotationCancel='true';cancel.hidden=!annotationRunner.busy;
    const quality=annotationQuality(loadedAnnotation??{});
    const notice=paragraph(annotationNotice||(loadedAnnotation?`现有演出：${quality.usable}/${quality.total}段可用，${quality.fallbackCount}段回退。${failureDetail(loadedAnnotation.failures)}${annotationWarning(loadedAnnotation)}`:'尚未标注。普通请求优先复用缓存。'),'ark-annotation-feedback');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
    button('检查人物显示',()=>portraitReview());
    paragraph('“重新标注演出”会绕过旧缓存，新调用一次你配置的标注模型，可能产生费用；只重做演出标注，不重新生成正文。新结果失败时保留旧演出。','ark-muted');
    button('查看本条完整原文',()=>{showPanel('完整原文（含舞台外内容）');rawBlock(parsed.source);},b);
    paragraph('标注通过你自己的酒馆发送到上述模型地址，只发送正文片段、玩家姓名、前文场景与候选素材描述。不套正文预设，不发送完整世界书或图片。失败时仍能按原文播放。');
    paragraph('打字途中点击补全；自动按字数等待；跳过只到本条结尾。这些是本产品选择，不是测得的原版规则。');

  }
  function connectionSettings(){
    const section=doc.createElement('section');section.className='ark-connection-settings';section.setAttribute('aria-label','演出标注连接');panelBody.append(section);
    const title=doc.createElement('h3');title.textContent='演出标注连接';section.append(title);
    const saved=connection.read();
    const field=(caption,type,value)=>{const label=doc.createElement('label');label.textContent=caption;const input=doc.createElement(type==='select'?'select':'input');if(type!=='select')input.type=type;input.setAttribute('aria-label',caption);input.autocomplete='off';input.spellcheck=false;input.value=value??'';label.append(input);section.append(label);return input;};
    const protocol=field('接口格式','select');for(const [value,label]of [['openai','OpenAI 兼容接口'],['gemini','Gemini 原生接口']]){const o=doc.createElement('option');o.value=value;o.textContent=label;protocol.append(o);}protocol.value=saved.protocol;
    const url=field('API 基础 URL','url',saved.url);url.placeholder='https://你的服务地址/v1';
    const key=field('API Key（无密钥服务可留空）','password',saved.key);
    const model=field('标注模型名称','text',saved.model);model.placeholder='从列表选择，也可以直接填写模型 ID';
    const listButton=button('拉取模型列表',loadModels,section);listButton.disabled=!host;
    const choices=field('可用模型','select');choices.parentElement.hidden=true;
    const listStatus=doc.createElement('p');listStatus.className='ark-muted';listStatus.setAttribute('role','status');listStatus.setAttribute('aria-live','polite');listStatus.textContent='填写地址和 Key 后拉取；只查询列表，不生成文本。';section.append(listStatus);
    let pending=null;
    const cancelList=()=>{if(pending){pending.abort();pending=null;listStatus.textContent='已取消拉取。需要时可重新请求。';}listButton.disabled=!host;listButton.textContent='拉取模型列表';section.removeAttribute('aria-busy');};
    panelCleanup=cancelList;
    const invalidateList=()=>{cancelList();choices.replaceChildren();choices.parentElement.hidden=true;listStatus.textContent='连接已更改，请重新拉取列表；已填写的模型名称保留。';};
    for(const input of [protocol,url,key])input.addEventListener('input',invalidateList);
    choices.addEventListener('change',()=>{if(choices.value){model.value=choices.value;listStatus.textContent='已选择模型；点击“保存标注连接”后使用。';}});
    model.addEventListener('input',()=>{choices.value=model.value;});
    async function loadModels(){
      if(pending||!host)return;
      const controller=new AbortController();pending=controller;
      listButton.disabled=true;listButton.textContent='正在拉取…';section.setAttribute('aria-busy','true');listStatus.textContent='正在查询可用模型…';
      choices.replaceChildren();choices.parentElement.hidden=true;
      const timer=setTimeout(()=>controller.abort(),30000);
      try{
        const models=await requestModelList({config:{protocol:protocol.value,url:url.value,key:key.value},signal:controller.signal,fetcher:win.fetch.bind(win),origin:win.location.origin,headers:core().getRequestHeaders()});
        if(pending!==controller||!section.isConnected)return;
        const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent='请选择模型';choices.append(placeholder);
        for(const id of models){const option=doc.createElement('option');option.value=id;option.textContent=id;choices.append(option);}
        choices.value=models.includes(model.value)?model.value:'';choices.parentElement.hidden=!models.length;
        listStatus.textContent=models.length?`已获取 ${models.length} 个模型，请在列表中选择；也可以手动填写。`:'服务返回了空列表，可以手动填写模型名称。';
      }catch(error){if(pending===controller&&section.isConnected)listStatus.textContent=controller.signal.aborted?'查询超过 30 秒，请重试或手填模型名称。':error.message;}
      finally{clearTimeout(timer);if(pending===controller){pending=null;listButton.disabled=!host;listButton.textContent='拉取模型列表';section.removeAttribute('aria-busy');}}
    }
    const tokens=field('最大输出 token 数','number',saved.maxTokens);tokens.min=0;tokens.step=1;tokens.placeholder='不限（留空）';
    const tokenHint=doc.createElement('p');tokenHint.className='ark-muted';tokenHint.textContent='默认留空，不主动限制输出；0 也表示不限。实际可输出多少仍由模型服务决定，不需要填写很大的数字。';section.append(tokenHint);
    const hint=doc.createElement('p');hint.className='ark-muted';hint.textContent='OpenAI 兼容接口填写基础地址（通常含 /v1）；Gemini 原生填写服务根地址。URL 与模型在本机保存，Key 仅存当前酒馆标签页会话；不写入聊天、脚本导出或项目仓库。这里不会使用你生成正文的连接。';section.append(hint);
    const feedback=doc.createElement('p');feedback.className='ark-connection-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.textContent=saved.url?'已保存标注地址；点击保存不会调用模型。':'尚未配置。可先播放原文或已有缓存。';section.append(feedback);
    for(const input of [protocol,url,key,model,tokens])input.addEventListener('input',()=>{feedback.classList.remove('ark-warning');feedback.textContent='连接有未保存的更改，请点击“保存标注连接”。';});
    choices.addEventListener('change',()=>{if(choices.value){feedback.classList.remove('ark-warning');feedback.textContent='模型已更改，请点击“保存标注连接”。';}});
    button('保存标注连接',()=>{
      try{const c=connection.save({protocol:protocol.value,url:url.value,model:model.value,key:key.value,maxTokens:tokens.value});url.value=c.url;model.value=c.model;tokens.value=c.maxTokens??'';annotationRunner.cancel();feedback.classList.remove('ark-warning');feedback.textContent='已保存。需要时点击下方“请求演出标注”；本次保存未调用模型。';}
      catch(error){feedback.classList.add('ark-warning');feedback.textContent='未保存：'+error.message+'。请修改后再次保存；已保存的连接保持不变。';}
    },section);
    button('清除标注连接与 Key',()=>{invalidateList();annotationRunner.cancel();connection.clear();url.value='';model.value='';key.value='';tokens.value='';feedback.classList.remove('ark-warning');feedback.textContent='已清除标注连接。已有演出和正文保留。';},section);
  }
  function avatarSettings(){
    const p=persona();
    if(!p.capable||!p.id){paragraph('当前助手未提供可用的人设头像接口，继续只显示已有角色素材与文字。','ark-warning');return;}
    const wrap=doc.createElement('section');wrap.className='ark-avatar-settings';wrap.setAttribute('aria-label','User头像立绘设置');panelBody.append(wrap);
    const title=doc.createElement('h3');title.textContent='User 头像立绘 · '+(p.name||'未命名人设');wrap.append(title);
    const preview=doc.createElement('img');preview.className='ark-avatar-preview';preview.alt=(p.name||'当前User')+'头像原图预览';if(p.url)preview.src=p.url;else preview.hidden=true;wrap.append(preview);
    let prefs=avatarPrefs(p);
    const label=doc.createElement('label');label.className='ark-avatar-toggle';const enabled=doc.createElement('input');enabled.type='checkbox';enabled.checked=prefs.enabled;enabled.disabled=!p.url||p.defaultAvatar;enabled.setAttribute('aria-label','使用当前 User 头像作为立绘');label.append(enabled,doc.createTextNode('使用当前 User 头像作为立绘'));wrap.append(label);
    const note=doc.createElement('p');note.className='ark-muted';note.textContent=p.defaultAvatar?'当前是默认头像，不适合作为立绘，请先在酒馆选择自己的图片。':'读取酒馆头像原图，保留透明通道；单图无差分，不识别人像或补全身体。是否适合由你看预览判断。';wrap.append(note);
    if(activeBinding&&activeBinding.personaId!==p.id){const n=doc.createElement('p');n.className='ark-warning';n.textContent='这条历史回复属于另一人设，当前头像不会替换进去。';wrap.append(n);}
    else if(!activeBinding){const n=doc.createElement('p');n.className='ark-warning';n.textContent='本条回复未能确认原玩家人设ID，暂不套用头像。';wrap.append(n);}
    const save=()=>{if(persona().id!==p.id){status('当前人设已切换，请重新打开设置');return;}prefs=avatarPreferences({enabled:enabled.checked,size:size.value,top:top.value});store.setItem(avatarPreferenceKey(p.id),JSON.stringify(prefs));render(true);};
    const slider=(name,min,max,step,value,unit)=>{const l=doc.createElement('label');l.className='ark-avatar-adjust';const text=doc.createElement('span');text.textContent=name;const input=doc.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.setAttribute('aria-label',name);const output=doc.createElement('output');const update=()=>{output.textContent=input.value+unit;};update();input.addEventListener('input',()=>{update();save();});l.append(text,input,output);wrap.append(l);return input;};
    const size=slider('立绘大小',70,220,1,prefs.size,'vh'),top=slider('上下位置',-40,40,.5,prefs.top,'vh');
    enabled.addEventListener('change',save);
    preview.onerror=()=>{preview.hidden=true;enabled.disabled=true;failedAvatars.add(p.url);note.textContent='头像原图加载失败，只保留姓名和正文，不借用其他人物图片。';render(true);};
    preview.onload=()=>{preview.dataset.originalSize=preview.naturalWidth+'×'+preview.naturalHeight;};
    button('恢复默认构图',()=>{size.value=AVATAR_DEFAULTS.size;top.value=AVATAR_DEFAULTS.top;size.dispatchEvent(new Event('input'));top.dispatchEvent(new Event('input'));},wrap);
    const hint=doc.createElement('p');hint.className='ark-muted';hint.textContent='按人设分别保存，默认关闭。大小和上下位置只调画面，不调用模型；画布不同可能需要手动微调。在场、说话和离场仍按正文标注。';wrap.append(hint);
  }
  function log() {
    showPanel('LOG · 原文回顾');
    paragraph('保持原文顺序；平行事件独立显示，不按时间重新排序。点击条目返回该句。');
    parsed.fragments.forEach((f,i)=>{const b=button((f.source_line?'原作L'+f.source_line+' · ':'')+(f.track==='main'?'主线':'平行事件')+' · '+(rows[i]?.speaker?rows[i].speaker+'：':'')+f.raw,()=>{position=i;pageOffset=0;closePanel();render(true);});b.className='ark-log-entry';b.dataset.fragment=f.id;});
    paragraph('辅助提示、规划和附言不进入剧情LOG；完整原文仍可单独查看。','ark-muted');
    button('查看完整原文',()=>{showPanel('完整原文');rawBlock(parsed.source);});
  }
  const previewCacheKey=()=>[KEY,'preview',mode,sourceHash,packHash,REVISION].join(':');
  function loadEmpty() {
    session++;mode='empty';messageId=null;selectedNode=null;activeBinding=null;sourceHash='';initial={};stageTracks={};continuity=null;currentCorrections=[];parsed=parseStory('');rows=[];position=0;closePanel();render(true);
  }
  async function loadPreferred() {
    if(!host)return loadEmpty();
    await ensureCatalog();if(generating())return;
    const stable=store.getItem(KEY+':selected-node:'+chatIdentity());if(stable){const index=resolveNode(core().chat,stable);if(index>=0)return loadMessage(index);await loadLatest();status('上次阅读的回复已删除或已不含正文，已切到最新有效回复。');return;}
    const selected=store.getItem(KEY+':selected:'+chatIdentity()),id=preferredReply(core().chat,selected);
    if(id!==null)try {await loadMessage(id);return;}catch{}
    return loadLatest();
  }
  async function loadLatest() {
    if(!host)throw Error('需要在酒馆中使用');
    await ensureCatalog();if(generating())return;
    const latest=collectNodes(core().chat).at(-1);if(!latest)return loadEmpty();return loadMessage(latest.index);
  }
  async function loadMessage(id) {
    if(busy) throw Error('请先取消或等待当前操作');
    if(generating())throw Error('回复仍在生成，完成后再读取');
    await ensureCatalog();if(!validReply(core().chat[id],id))return loadLatest();
    const targetNode=core().chat[id].extra[NODE_KEY],targetText=core().chat[id].mes;
    const binding=replyPlayerBinding(core().chat,id,win.location.origin);
    if(saveReplyBinding(core().chat[id],binding))await core().saveChat();
    const seq=++session;const chat=chatIdentity();const msg=host.helper.getChatMessages(id)[0];if(!msg||msg.role!=='assistant')throw Error('这条不是助手回复');
    const hash=await digest(msg.message);if(seq!==session||chat!==chatIdentity())return;
    const resolved=await context(id);if(seq!==session||chat!==chatIdentity())return;
    if(core().chat[id]?.extra?.[NODE_KEY]!==targetNode||core().chat[id]?.mes!==targetText)throw Error('回复位置或正文刚刚改变，请刷新目录后重选');
    mode='chat';messageId=id;selectedNode=core().chat[id].extra[NODE_KEY];root.dataset.nodeId=selectedNode;chatKey=chat;sourceHash=hash;format=core().chat[id]?.extra?.ark_story_format==='speaker-lines'?'speaker-lines':'auto';parsed=parseStory(msg.message,180,format);position=0;continuity=resolved;currentCorrections=resolved.corrections;initial=resolved.initial;
    activeBinding=binding;
    const cached=readRecord(id,hash);
    loadedAnnotation=null;annotationNotice='';failedPortraits.clear();
    if(recordMatches(cached,resolved.expected)) {const validated=validateAnnotations(parsed,{rows:restoreFallbackRows(cached),npcActors:cached.npcActors},{...stagePack(),npcEnabled:true},cached.initial??initial);rows=validated.rows;initial=cached.initial??initial;loadedAnnotation={...cached,rows,npcActors:validated.npcActors,portraitDiagnostics:validated.portraitDiagnostics,failures:[...new Set([...(cached.failures??[]),...validated.failures])],warnings:[...new Set([...(cached.warnings??[]),...(validated.warnings??[])])]};}
    else rows=validateAnnotations(parsed,null,stagePack()).rows;
    observeSources();restoreProgress();closePanel();render();
  }
  async function annotate(force=false) {
    if(busy&&!annotationRunner.busy){annotationStatus('当前操作尚未完成，请等待或取消。');return;}
    if(!host||mode!=='chat'||messageId===null||!parsed.fragments.length){annotationStatus('请先读取当前聊天的AI回复');return;}
    const assertCurrent=async s=>{
      const check=()=>{const m=core()?.chat[s.id];if(destroyed||s.seq!==session||mode!=='chat'||s.chat!==chatIdentity()||messageId!==s.id||sourceHash!==s.hash||m?.extra?.[NODE_KEY]!==s.node||(m.swipe_id??0)!==s.swipe||m.mes!==s.parsed.source||persona().id!==s.persona||JSON.stringify(annotationIdentity())!==s.playerKey||JSON.stringify(activeBinding)!==s.bindingKey)throw Error('聊天、正文、备选或玩家身份已变化，忽略旧标注');};
      check();if(await digest(core().chat[s.id].mes)!==s.hash)throw Error('原文已编辑，忽略旧标注');
      const resolved=await context(s.id);check();if(JSON.stringify(resolved.expected)!==JSON.stringify(s.resolved.expected)||JSON.stringify(resolved.initial)!==JSON.stringify(s.resolved.initial)||JSON.stringify(resolved.corrections)!==JSON.stringify(s.resolved.corrections))throw Error('前文或手动舞台状态已变化，忽略旧标注');
    };
    const apply=(record,s)=>{continuity=s.resolved;initial=record.initial;currentCorrections=s.resolved.corrections;rows=record.rows;loadedAnnotation=record;observeSources();render(true);};
    return annotationRunner.run({force,report:annotationStatus,onBusy:(value,controller)=>{busy=value;abort=controller;setBusy();},
      capture:async()=>{
        const s={seq:session,chat:chatIdentity(),id:messageId,node:selectedNode,hash:sourceHash,swipe:core().chat[messageId].swipe_id??0,persona:persona().id,player:annotationIdentity(),playerKey:JSON.stringify(annotationIdentity()),binding:activeBinding?{...activeBinding}:null,bindingKey:JSON.stringify(activeBinding),parsed,format,scenePack:stagePack(),key:messageCacheKey(messageId,sourceHash)};
        s.resolved=await context(s.id);await assertCurrent(s);
        const cached=readRecord(s.id,s.hash);
        if(recordMatches(cached,s.resolved.expected)){const validated=validateAnnotations(s.parsed,{rows:restoreFallbackRows(cached),npcActors:cached.npcActors},{...s.scenePack,npcEnabled:true},cached.initial??s.resolved.initial);s.cached={...cached,rows:validated.rows,npcActors:validated.npcActors,portraitDiagnostics:validated.portraitDiagnostics,failures:[...new Set([...(cached.failures??[]),...validated.failures])],warnings:[...new Set([...(cached.warnings??[]),...(validated.warnings??[])])]};}
        s.oldUsable=annotationQuality(s.cached??{}).usable;return s;
      },
      useCached:async(record,s,signal)=>{await assertCurrent(s);signal.throwIfAborted();apply(record,s);},
      request:(s,signal)=>{
        if(!force&&s.cached)throw Error('现有标注有未通过的段落；若需新调用，请点击“重新标注演出”');
        return requestAnnotation({config:connection.read(),parsed:s.parsed,pack:s.scenePack,previous:s.resolved.initial,player:s.player,signal,fetcher:win.fetch.bind(win),origin:win.location.origin,headers:core().getRequestHeaders()});
      },
      assertCurrent,
      validate:(response,s)=>{
        const validated=validateAnnotations(s.parsed,{rows:restoreFallbackRows(response),npcActors:response.npcActors},s.scenePack,s.resolved.initial);
        const record={...s.resolved.expected,rows:validated.rows,initial:s.resolved.initial,finalTracks:correctedTracks(stageAt(s.parsed.fragments,validated.rows,s.parsed.fragments.length-1,s.resolved.initial,validated.npcActors).tracks,s.resolved.corrections,s.parsed.fragments.length-1),failures:[...new Set([...(response.failures??[]),...validated.failures])],warnings:[...new Set([...(response.warnings??[]),...(validated.warnings??[])])],model:response.model,attempt:response.attempt};
        record.npcActors=validated.npcActors;record.npcSchema=1;
        record.portraitDiagnostics=validated.portraitDiagnostics;
        record.assetRefs=referencedAssets(record.rows,record.initial,pack,record.npcActors);if(s.binding)record.playerBinding=s.binding;return record;
      },
      commit:async(record,s,signal)=>{
        await assertCurrent(s);signal.throwIfAborted();const c=core(),target=c.chat[s.id],prior=target.extra?.[RECORD],priorLocal=store.getItem(s.key);
        try{store.setItem(s.key,JSON.stringify(record));target.extra??={};target.extra[RECORD]=record;await c.saveChat();}
        catch(e){if(prior===undefined)delete target.extra[RECORD];else target.extra[RECORD]=prior;if(priorLocal===null)store.removeItem(s.key);else store.setItem(s.key,priorLocal);throw e;}
        if(s.seq===session&&s.chat===chatIdentity()&&sourceHash===s.hash)apply(record,s);
      }
    });
  }
  function setBusy() {root.setAttribute('aria-busy',String(busy));root.dataset.busy=String(busy);root.querySelectorAll('[data-annotation-request]').forEach(b=>b.disabled=busy||!host||mode!=='chat'||!parsed.fragments.length);root.querySelectorAll('[data-annotation-cancel]').forEach(b=>b.hidden=!annotationRunner.busy);root.querySelectorAll('[data-action=input]').forEach(b=>b.disabled=busy);let b=$('[data-action=cancel]');if(busy&&!b){b=doc.createElement('button');b.dataset.action='cancel';b.textContent='取消当前操作';$('.ark-bottom>div').append(b);}if(!busy)b?.remove();}
  async function worldbook() {
    showPanel('章节世界书 · 手动开关');
    paragraph('这里修改的是共享原书《'+BOOK+'》。其他使用这本书的聊天也会受影响；开关用于之后的生成，不改已经保存的原文或演出。');
    paragraph('不会自动开全、按场景切换或设置互斥。先预览勾选差异，再由你保存。');
    if(!host) {paragraph('请在酒馆内打开此面板。预览页不能读取或修改世界书。');return;}
    const c=core();
    // Core preserves every unknown raw field. Helper 4.11.0 reconstructs its normalized schema on writes.
    const book=structuredClone(await c.loadWorldInfo(BOOK));if(!book?.entries)throw Error('未找到《第九章-风暴瞭望》；世界书需自行导入，播放器仍可读取已有正文');
    const global=host.helper.getGlobalWorldbookNames();const char=host.helper.getCharWorldbookNames('current');const chat=host.helper.getChatWorldbookName('current');
    const bound=global.includes(BOOK)||char.primary===BOOK||char.additional.includes(BOOK)||chat===BOOK;
    paragraph('当前绑定：全局 '+(global.includes(BOOK)?'是':'否')+' / 角色 '+(char.primary===BOOK||char.additional.includes(BOOK)?'是':'否')+' / 聊天 '+(chat===BOOK?'是':'否')+'。'+(bound?'开关仍需满足条目本身的触发规则。':'此书未绑定当前生成上下文；本面板不会自动更改全局或角色绑定。'),'ark-muted');
    if(!bound)button('预览绑定到当前聊天',()=>{
      const identity=chatIdentity();showPanel('绑定本章节世界书');
      paragraph('将《'+BOOK+'》绑定到当前聊天，供下次生成读取。共享原书的条目开关仍会影响所有使用它的聊天。');
      paragraph(chat?'这会替换当前聊天原先绑定的《'+chat+'》；全局与角色绑定不变。':'当前聊天没有单独绑定的世界书；全局与角色绑定不变。');
      button('仅绑定到这个聊天',async()=>{if(identity!==chatIdentity())throw Error('聊天已切换，请重新操作');await host.helper.rebindChatWorldbook('current',BOOK);if(host.helper.getChatWorldbookName('current')!==BOOK)throw Error('绑定回读失败');await worldbook();});
    });
    const draft=new Map();
    for(const [key,e] of Object.entries(book.entries)) {
      const row=doc.createElement('div');row.className='ark-row';const label=doc.createElement('label'),input=doc.createElement('input');input.type='checkbox';input.checked=!e.disable;input.dataset.uid=key;draft.set(key,input);
      const name=doc.createElement('span');name.textContent=(e.comment||'无标题')+' · '+(e.disable?'当前关闭':'当前开启');label.append(input,name);
      const details=doc.createElement('details');const summary=doc.createElement('summary');summary.textContent='内容预览';const pre=doc.createElement('pre');pre.textContent=e.content??'';details.append(summary,pre);row.append(label,details);panelBody.append(row);
    }
    button('预览开关修改',()=>{
      const changes=[...draft].filter(([k,v])=>v.checked!==!book.entries[k].disable).map(([k,v])=>({key:k,enabled:v.checked,name:book.entries[k].comment}));
      if(!changes.length){paragraph('没有开关修改。');return;}
      showPanel('确认共享原书修改');paragraph('仅变更以下开关；不会更改正文、关键字、顺序或其他条目。');changes.forEach(x=>paragraph(x.name+' → '+(x.enabled?'开启':'关闭')));
      button('保存这些开关',async()=>{
        await saveWorldbookToggles(c,win.fetch.bind(win),BOOK,book,changes);
        c.reloadWorldInfoEditor?.(BOOK);await worldbook();status('开关已保存并从服务器回读核对');
      });
    });
  }
  async function saveStageCorrections(fixes){
    if(syncing||busy)throw Error('当前操作尚未完成，请稍后保存舞台修正');
    syncing=true;
    try{
      if(chatIdentity()!==chatKey||await digest(core().chat[messageId]?.mes??'')!==sourceHash)throw Error('聊天或原文已变化，请重新打开修正');
      const c=core(),savedRecord=loadedAnnotation;c.chatMetadata[CONTEXT]={...(c.chatMetadata[CONTEXT]??{}),corrections:fixes};await c.saveMetadata();
      // Keep the source watcher out until the overlay and its cache fingerprint agree.
      // The paid rows stay intact; an appearance edit is not a new annotation request.
      if(savedRecord){
        const resolved=await context(messageId),record={...savedRecord,...resolved.expected};
        record.finalTracks=correctedTracks(stageAt(parsed.fragments,record.rows,parsed.fragments.length-1,record.initial,record.npcActors).tracks,resolved.corrections,parsed.fragments.length-1);
        record.assetRefs={...referencedAssets(record.rows,record.initial,pack,record.npcActors),...Object.assign({},...resolved.corrections.map(f=>f.assetRefs??{}))};
        store.setItem(messageCacheKey(messageId,sourceHash),JSON.stringify(record));c.chat[messageId].extra[RECORD]=record;await c.saveChat();
      }
      await loadMessage(messageId);
    }finally{syncing=false;}
  }
  function stagePanel() {
    showPanel('舞台与剧情位置');const track=parsed.fragments[position]?.track??'main',stage=stageTracks[track]??{};
    const pack=withNPCActors(stagePack(),stage.npcActors);
    paragraph('当前轨道：'+(track==='main'?'主线':track)+'。按这段AI正文修正地点与人物，不按原作进度推进。');
    paragraph(mode==='chat'?'修正保存到当前聊天，从本条当前句起生效并用于后续选图；不改正文、不改世界书。当前消息前最近有效状态：'+(continuity?.ancestor===null?'无，保守未知':'#'+continuity?.ancestor)+'。':'这是预览，修正仅在本预览生效，不给已有聊天设默认节点。');
    paragraph('在场：'+((stage.present??[]).join('、')||'未知/未标注')+'；仅提及：'+((stage.referenced??[]).join('、')||'无')+'；通讯/画外：'+((stage.remote??[]).join('、')||'无'));
    for(const note of portraitDiagnostics([{...rows[position],...stage}],pack))paragraph(note.speaker+'：'+(note.reason==='not-displayed'?'有可用立绘，但当前没有安排显示，可能漏配。':'没有可自动使用的对应立绘，保留名字与对白。'));
    const field=(name,value,select=false)=>{const label=doc.createElement('label');label.textContent=name;const input=doc.createElement(select?'select':'input');input.setAttribute('aria-label',name);if(!select)input.value=value??'';label.append(input);panelBody.append(label);return input;};
    const place=field('实际地点（不知道就留空）',stage.place);
    const background=field('背景画面',null,true);for(const [value,text]of [['','自动选择通用背景'],...Object.keys(pack.backgrounds).map(id=>[id,pack.assets.find(a=>a.id===id)?.name??(id==='bg_black'?'纯黑画面（不是地点）':id)]),...(backgroundLibrary.entries??[]).filter(e=>e.priority).map(e=>[e.id,e.label])]){const option=doc.createElement('option');option.value=value;option.textContent=text;background.append(option);}background.value=stage.background??'';
    const illustration=field('剧情插图（情节特定，手动选择不会改正文）',null,true);for(const [value,text]of [['','不显示插图'],...Object.keys(pack.illustrations).map(id=>[id,pack.assets.find(a=>a.id===id)?.label??id])]){const o=doc.createElement('option');o.value=value;o.textContent=text;illustration.append(o);}illustration.value=stage.illustration??'';
    const present=field('同地在场人物（顿号分隔）',(stage.present??[]).join('、'));
    const remote=field('通讯/画外人物（顿号分隔）',(stage.remote??[]).join('、'));
    paragraph('画面立绘：只有明确在场的人才选。无图人物只在上面的名单填写，保留姓名对白。','ark-muted');
    const portraits=[],npcSelections=[];
    for(const [id,c]of Object.entries(pack.characters)){
      const label=doc.createElement('label'),check=doc.createElement('input');check.type='checkbox';check.checked=(stage.display??[]).includes(id);check.setAttribute('aria-label',c.name+'立绘');label.append(check,doc.createTextNode(c.name+(c.npcBinding?'（通用外观）':c.autoEligible===false?'（称谓图，仅手选）':'')));
      const variants=doc.createElement('select');variants.setAttribute('aria-label',c.name+'差分');
      for(const [v,info]of Object.entries(c.variantInfo??{})){const o=doc.createElement('option');o.value=v;o.textContent=v+' · '+(info.description??'默认整图');variants.append(o);}variants.value=stage.variants?.[id]??c.default;
      variants.hidden=!!c.npcBinding;label.append(variants);panelBody.append(label);portraits.push([id,check,variants]);
      if(c.npcBinding){
        const a=pack.npcActors[id],choice=field(c.name+'的通用外观',null,true);
        for(const p of Object.values(pack.npcPortraits).filter(p=>p.role===a.role&&p.faction===a.faction)){const o=doc.createElement('option');o.value=p.id;o.textContent=p.label;choice.append(o);}choice.value=a.portrait;npcSelections.push([id,choice]);
      }
    }
    if(npcSelections.length)paragraph('通用外观只列出相同职业、相同阵营的图片；取消人物的立绘勾选可隐藏当前画面中的该人物。','ark-muted');
    button('保存舞台修正',async()=>{
      const split=value=>value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean);const people=split(present.value),outside=split(remote.value),selected=portraits.filter(([,input])=>input.checked).map(([id])=>id);
      const display=[...(stage.display??[]).filter(id=>selected.includes(id)),...selected.filter(id=>!(stage.display??[]).includes(id))];
      if(people.some(x=>outside.includes(x)))throw Error('同一个人物不能同时设为同地在场和通讯/画外');
      if(display.some(id=>!people.includes(pack.characters[id].name)))throw Error('请先把选中的立绘人物加入同地在场名单');
      const variants=Object.fromEntries(portraits.filter(([,check])=>check.checked).map(([id,,select])=>[id,select.value]));
      const fix={id:crypto.randomUUID(),anchor:messageId,sourceHash,swipe:mode==='chat'?core().chat[messageId].swipe_id??0:0,...(continuity?.expected.parserRevision?{parserRevision:continuity.expected.parserRevision}:{}),position,track,stage:{nodeId:stage.nodeId??null,place:place.value.trim()||null,background:background.value||null,illustration:illustration.value||null,present:people,remote:outside,display,communication:(stage.communication??[]).filter(id=>outside.includes(pack.characters[id].name)),variants,focus:null,front:null},by:'player'};
      if(npcSelections.length){
        const sameStage=['place','background','illustration','present','remote','display','communication'].every(k=>JSON.stringify(fix.stage[k])===JSON.stringify(stage[k]??(['present','remote','display','communication'].includes(k)?[]:null)))&&display.every(id=>variants[id]===(stage.variants?.[id]??pack.characters[id].default));
        if(sameStage)fix.stage={...(currentCorrections.find(f=>f.track===track)?.stage??{})};
        fix.stage.npcActors=Object.fromEntries(npcSelections.map(([id,choice])=>[id,{...pack.npcActors[id],portrait:choice.value}]));
      }
      fix.assetRefs=referencedAssets([fix.stage],{},pack,fix.stage.npcActors);
      if(mode==='chat')await saveStageCorrections([...corrections().filter(f=>!(f.anchor===messageId&&f.track===track)),fix]);
      else {currentCorrections=[fix];closePanel();render(true);}
      status('舞台修正已保存；从当前句起生效，后续缓存会核对这次修正。');
    });
    if(mode==='chat')button('撤销本条本轨道修正',()=>saveStageCorrections(corrections().filter(f=>!(f.anchor===messageId&&f.track===track))));
  }
  // Normal generation belongs to SillyTavern. Observe identity only; never replace its transport.
  const originalFetch=win.fetch;
  async function syncMessage() {
    if(!host||syncing||generating())return;syncing=true;
    try {
    if(mode==='empty'){if(preferredReply(core().chat,null)!==null)await loadPreferred();return;}if(mode!=='chat')return;
    const msg=core().chat[messageId];
    const changed=core().chat.length!==observedSources.length||core().chat.some((m,i)=>m.mes!==observedSources[i]?.[0]||(m.swipe_id??0)!==observedSources[i]?.[1]||(m.extra?.ark_story_format??'auto')!==observedSources[i]?.[2])||JSON.stringify(corrections())!==observedCorrections||JSON.stringify([player(),persona()])!==observedPlayer;
    if(chatIdentity()!==chatKey||!msg||msg.mes!==parsed.source||changed){
      const sameChat=chatIdentity()===chatKey,stable=selectedNode,wasCatalog=!panel.hidden&&panel.classList.contains('ark-catalog');
      const currentId=sameChat?resolveNode(core().chat,stable):-1;
      session++;abort?.abort();busy=false;setBusy();auto=false;updateAuto();initial={};stageTracks={};mode='empty';
      await (currentId>=0?loadMessage(currentId):loadLatest()).catch(()=>loadEmpty());
      if(wasCatalog)await catalog();
      status(sameChat&&currentId<0?'原来阅读的回复已删除或已不含正文，已切到最新有效回复。':'聊天已刷新；缓存仍按正文和前文核对，目录编号不影响标注。');
    }
    }finally{syncing=false;}
  }
  if(host) {
    disposers.push(host.eventOn(host.tavern_events.CHAT_CHANGED,async()=>{
      session++;abort?.abort();busy=false;setBusy();auto=false;updateAuto();initial={};stageTracks={};mode='empty';
      await loadPreferred().catch(()=>loadEmpty());
    }).stop);
    for(const name of ['MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','CHARACTER_MESSAGE_RENDERED','GENERATION_ENDED','PERSONA_CHANGED']) {
      const event=host.tavern_events[name];if(event)disposers.push(host.eventOn(event,()=>syncMessage().catch(e=>status(e.message))).stop);
    }
    // Some third-party edits refresh the DOM without MESSAGE_UPDATED. Compare the authoritative text while open.
    const versionWatch=setInterval(()=>{if(!root.hidden)syncMessage().catch(e=>status(e.message));},700);
    disposers.push(()=>clearInterval(versionWatch));
  }
  root.addEventListener('click',e=>{
    const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
    const handlers={settings,catalog,log,library:assetLibrary,'return-chat':()=>loadPreferred(),stage:stagePanel,world:worldbook,previous,next,language:()=>{expanded=!expanded;render(true);},auto:()=>{auto=!auto;updateAuto();completeText();},skip:()=>{auto=false;updateAuto();position=Math.max(0,parsed.fragments.length-1);pageAtEnd=true;render(true);$('.ark-end').hidden=false;},close:()=>controller.close(),hide:()=>{$('.ark-shell').classList.add('ark-hidden-ui');$('.ark-restore').hidden=false;},restore:()=>{$('.ark-shell').classList.remove('ark-hidden-ui');$('.ark-restore').hidden=true;},'panel-close':closePanel,cancel:()=>annotationRunner.cancel()};
    Promise.resolve(handlers[action]?.()).catch(e=>status(e.message));
  });
  $('.ark-stage').addEventListener('click',next);
  $('.ark-stage').addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();next();}});
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape') {if(!panel.hidden)closePanel();else controller.close();}
    if(!panel.hidden&&e.key==='Tab') {const elements=[...panel.querySelectorAll('button,input,textarea,select,summary')].filter(x=>!x.disabled);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first?.focus();}}
  });
  let resizeTimer;const onResize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!destroyed&&!root.hidden)render(true);},100);};
  win.addEventListener('resize',onResize);disposers.push(()=>{clearTimeout(resizeTimer);win.removeEventListener('resize',onResize);});
  doc.fonts?.ready.then(()=>{pageCache=null;if(!destroyed&&!root.hidden)render(true);});
  const controller={open:async()=>{doc.body.append(root);root.hidden=false;if(host&&mode==='empty')await loadPreferred().catch(()=>loadEmpty());render(true);entry.hidden=true;},close:()=>{panelCleanup();root.hidden=true;entry.hidden=false;auto=false;updateAuto();stopTimers();saveProgress();entry.focus();},destroy:()=>{if(destroyed)return;destroyed=true;panelCleanup();abort?.abort();stopTimers();disposers.forEach(fn=>fn());root.remove();entry.remove();style.remove();delete win.__arkPlayer;}};
  win.__arkPlayer=controller;entry.addEventListener('click',controller.open);
  if(host)window.addEventListener('pagehide',controller.destroy,{once:true});
  await loadPreferred().catch(()=>loadEmpty());
  await controller.open();
  root.dataset.hostFetchPassthrough=String(win.fetch===originalFetch&&win.fetch?.name!=='guardedFetch');
  return controller;
}
async function digest(text) {const bytes=new TextEncoder().encode(text);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function saveWorldbookToggles(c,request,name,snapshot,changes) {
  const response=await request('/api/worldinfo/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({name})});
  if(!response.ok)throw Error('世界书读取失败');
  const current=await response.json();
  if(JSON.stringify(current)!==JSON.stringify(snapshot))throw Error('世界书已被其他操作改动，请重新打开面板');
  for(const x of changes) {if(!current.entries[x.key]||typeof x.enabled!=='boolean')throw Error('条目身份或开关不合法');current.entries[x.key].disable=!x.enabled;}
  await c.saveWorldInfo(name,current,true);
  const disk=await request('/api/worldinfo/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({name})});
  if(!disk.ok)throw Error('世界书回读失败');
  const read=await disk.json();if(JSON.stringify(read)!==JSON.stringify(current))throw Error('世界书回读与保存结果不符');
  return read;
}
