import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {parseStory,validateAnnotations,stageAt,annotationPrompt,dialogueDisplayText} from '../versions/0.3.7/core.mjs';
import {NPC_CATALOG,withNPCActors,npcActorsFrom,validateNPCActors,npcCandidates} from '../versions/0.3.7/npc.mjs';
import {mergeChapter,referencedAssets,assetRecordMatches} from '../versions/0.3.7/assets/chapter-library.mjs';
import {mergeChapter as oldMerge} from '../versions/0.3.5/assets/chapter-library.mjs';
import {correctedTracks,contextFor} from '../versions/0.3.7/continuity.mjs';
import {requestAnnotation} from '../versions/0.3.7/annotation-client.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../versions/0.3.7/'+f,import.meta.url)));
const base=read('pack.json'),library=read('assets/chapter09/library.json'),backgrounds=read('assets/background-library.json');
const oldLibrary=JSON.parse(fs.readFileSync(new URL('../versions/0.3.5/assets/chapter09/library.json',import.meta.url)));
const {pack}=mergeChapter(base,library,backgrounds),old=oldMerge(base,oldLibrary,backgrounds).pack;
const actor=(name,portrait='avg_npc_088',evidence='罗德岛后勤干员小林和小周在仓库清点物资。')=>{
  const p=pack.npcPortraits[portrait];return {name,portrait,role:p.role,faction:p.faction,evidence};
};
const source='罗德岛后勤干员小林和小周在仓库清点物资。\n小林：数量没错。\n小周：我再核对一遍。\n小林离开仓库。\n小周：小林刚才检查过了。';
const parsed=parseStory(source,180,'speaker-lines');
const actors={'npc:lin':actor('小林'),'npc:zhou':actor('小周')};
const response={npcActors:actors,rows:[
  {id:'f0',present:['小林','小周'],display:['npc:lin','npc:zhou'],variants:{'npc:lin':'single','npc:zhou':'single'}},
  {id:'f1',focus:'npc:lin'},
  {id:'f2',focus:'npc:zhou'},
  {id:'f3',present:['小周'],display:['npc:zhou']},
  {id:'f4',focus:'npc:zhou',referenced:['小林']},
]};
test('12 reviewed appearances preserve source records and earlier asset signatures',()=>{
  assert.equal(NPC_CATALOG.length,12);assert.equal(Object.keys(pack.npcPortraits).length,12);
  assert.equal(pack.npcPortraits.avg_npc_088.label,'罗德岛后勤干员');
  for(const id of ['avg_npc_088','char_016_medic','char_013_riop','avg_npc_089','avg_npc_090','avg_npc_012'])assert.equal(pack.npcPortraits[id].faction,'罗德岛');
  const ids=new Set(NPC_CATALOG.map(p=>p.id));
  assert.deepEqual(pack.chapterGroups.filter(c=>ids.has(c.id)),old.chapterGroups.filter(c=>ids.has(c.id)));
  for(const [name,id]of Object.entries(old.aliases))assert.equal(pack.aliases[name],id,name);
  for(const [id,signature]of Object.entries(old.assetSignatures))if(id!=='avg_npc_231')assert.equal(pack.assetSignatures[id],signature,id);
  assert.equal(pack.npcPortraits.char_013_riop.sourceName,'干员奥利弗');
  assert(pack.npcPortraits.char_013_riop.usageRoles.includes('干员碎纸机'));
});
test('same picture supports separate speakers, focus, exits and unchanged source',()=>{
  const before=JSON.stringify({parsed,response}),checked=validateAnnotations(parsed,response,pack);
  assert.deepEqual(checked.failures,[]);assert.deepEqual(checked.portraitDiagnostics,[]);
  const view=withNPCActors(pack,checked.npcActors);
  assert.equal(view.characters['npc:lin'].variants.single,view.characters['npc:zhou'].variants.single);
  assert.equal(checked.rows[1].focus,'npc:lin');assert.equal(checked.rows[2].focus,'npc:zhou');
  assert.deepEqual(stageAt(parsed.fragments,checked.rows,4,{},checked.npcActors).stage.display,['npc:zhou']);
  assert.equal(dialogueDisplayText('小周：我再核对一遍。',checked.rows[2],view),'我再核对一遍。');
  assert.equal(JSON.stringify({parsed,response}),before);
});
test('new NPCs need source evidence and compatible faction and cannot replace dedicated people or player',()=>{
  for(const bad of [
    {...actor('小林'),faction:'维多利亚'},
    {...actor('小林'),role:'medic'},
    {...actor('小林'),evidence:'正文没有这一句。'},
    actor('陌生医生','char_016_medic','小林离开仓库。'),
    actor('凯利上尉'),actor('路易斯·凯利'),actor('玩家甲'),
    {...actor('小林'),portrait:'constructor'},
  ]){
    const result=validateNPCActors({'npc:bad':bad},parsed,{...pack,currentPlayerName:'玩家甲'});
    assert.equal(Object.keys(result.actors).length,0,JSON.stringify(bad));assert.equal(result.failures.length,1);
  }
  const invalid=validateAnnotations(parsed,{...response,npcActors:{'npc:lin':{...actors['npc:lin'],faction:'深池'}}},withNPCActors(pack,actors));
  assert(!invalid.rows[0].display.includes('npc:lin'),'stale virtual characters must not bypass rejected bindings');
  assert(invalid.warnings.length);
});
test('specific NPC art remains available by approved story name without merging unrelated names',()=>{
  for(const [name,portrait]of [['奥利弗','char_013_riop'],['碎纸机','avg_npc_089'],['威尔','avg_npc_090'],['弗雷德','avg_npc_012']]){
    const text=name+'：收到。',p=parseStory(text,180,'speaker-lines');
    assert(npcCandidates(p,pack).some(c=>c.id===portrait));
    const checked=validateAnnotations(p,{npcActors:{'npc:known':actor(name,portrait,text)},rows:[{id:'f0',present:[name],display:['npc:known'],focus:'npc:known'}]},pack);
    assert.deepEqual(checked.failures,[]);assert.deepEqual(checked.portraitDiagnostics,[]);
    assert.equal(pack.aliases[name],old.aliases[name]);
  }
});
test('candidate filtering respects faction and generic-off setting',()=>{
  const ids=text=>npcCandidates(parseStory(text),pack).map(p=>p.id);
  assert(!ids('一名医疗干员走过街道。').includes('char_016_medic'));
  assert(ids('罗德岛医疗干员进入诊疗室。').includes('char_016_medic'));
  assert(ids('罗德岛后勤人员到了。').includes('avg_npc_088'));
  assert(!ids('深池士兵出现在街上。').includes('avg_npc_241'));
  assert.deepEqual(npcCandidates(parsed,{...pack,npcEnabled:false}),[]);
  assert.equal(Object.keys(validateNPCActors(actors,parsed,{...pack,npcEnabled:false}).actors).length,0);
});
test('appearance survives exits and later replies, while silent identity changes are rejected',()=>{
  const checked=validateAnnotations(parsed,response,pack),initial=stageAt(parsed.fragments,checked.rows,4,{},checked.npcActors).tracks;
  const next=parseStory('小林：我回来了。',180,'speaker-lines');
  const reused=validateAnnotations(next,{rows:[{id:'f0',present:['小林'],display:['npc:lin'],focus:'npc:lin'}]},pack,initial);
  assert.deepEqual(reused.failures,[]);assert.deepEqual(reused.npcActors,actors);
  const changed=validateNPCActors({'npc:lin':actor('另一个人')},next,pack,initial);
  assert.equal(changed.failures.length,1);assert.deepEqual(changed.actors['npc:lin'],actors['npc:lin']);
  const disabled=validateAnnotations(next,{rows:[{id:'f0',present:['小林'],display:['npc:lin']}]},{...pack,npcEnabled:false},initial);
  assert.deepEqual(disabled.failures,[]);assert.deepEqual(disabled.npcActors,actors);
});
test('NPCs in remote and parallel scenes do not become same-place actors',()=>{
  const p={...parsed,fragments:[{id:'f0',track:'main',kind:'dialogue'},{id:'f1',track:'parallel-1',kind:'communication'},{id:'f2',track:'main',kind:'dialogue'}]};
  const checked=validateAnnotations(p,{npcActors:actors,rows:[
    {id:'f0',speaker:'小林',present:['小林'],display:['npc:lin'],focus:'npc:lin'},
    {id:'f1',speaker:'小周',remote:['小周'],communication:['npc:zhou']},
    {id:'f2',speaker:'小林',focus:'npc:lin'},
  ]},pack);
  assert.deepEqual(checked.failures,[]);
  const state=stageAt(p.fragments,checked.rows,2,{},checked.npcActors);
  assert.deepEqual(state.stage.display,['npc:lin']);assert.deepEqual(state.tracks['parallel-1'].display,[]);assert.deepEqual(state.tracks['parallel-1'].communication,['npc:zhou']);
});
test('old caches remain valid and new cached NPC art has separate revision signatures',()=>{
  const oldParsed=parseStory('凯利上尉：你好。',180,'speaker-lines'),oldResponse={rows:[{id:'f0',present:['凯利上尉'],display:['avg_npc_238'],focus:'avg_npc_238'}]};
  assert.deepEqual(validateAnnotations(oldParsed,oldResponse,pack).failures,[]);
  assert(assetRecordMatches({assetRefs:referencedAssets(oldResponse.rows,{},old)},pack));
  const checked=validateAnnotations(parsed,response,pack),record=JSON.parse(JSON.stringify({...checked,assetRefs:referencedAssets(checked.rows,{},pack,checked.npcActors)}));
  assert.deepEqual(validateAnnotations(parsed,record,pack).rows,checked.rows);
  assert(assetRecordMatches(record,pack));assert(!assetRecordMatches(record,old));
  assert(referencedAssets([],{},pack,actors)['npc-portrait:avg_npc_088'],'remembered but currently absent NPC still references its appearance');
});
test('manual appearance choice carries across tracks and into the next reply',async()=>{
  const original=actor('罗德岛近卫甲','char_013_riop','罗德岛近卫甲守在门口。');
  const changed={...original,portrait:'avg_npc_012'},registry={'npc:guard':original};
  const tracks={main:{npcActors:registry},'parallel-1':{npcActors:registry}};
  const fix={anchor:0,swipe:0,sourceHash:'s',position:1,track:'main',stage:{npcActors:{'npc:guard':changed},display:['npc:guard'],present:['罗德岛近卫甲'],variants:{'npc:guard':'single'}}};
  const corrected=correctedTracks(tracks,[fix],1);assert.deepEqual(npcActorsFrom(corrected)['npc:guard'],changed);
  assert.deepEqual(npcActorsFrom(correctedTracks(tracks,[fix],0))['npc:guard'],original);
  const context=await contextFor([{id:0,role:'assistant',text:'s',swipe:0},{id:1,role:'assistant',text:'n',swipe:0}],1,'p','r',[fix],async s=>s,async()=>null);
  assert.deepEqual(npcActorsFrom(context.initial)['npc:guard'],changed);
  const refs=referencedAssets([fix.stage],{},pack,fix.stage.npcActors);assert(refs['npc-portrait:avg_npc_012']);
});
test('one annotation request carries NPC definitions through the transport and validator',async()=>{
  globalThis.crypto??=webcrypto;let calls=0;
  const prompt=annotationPrompt(parsed,pack);assert(prompt.includes('罗德岛后勤干员'));assert(prompt.includes('npcActors'));
  const result=await requestAnnotation({config:{protocol:'openai',url:'http://localhost:1234/v1',key:'',model:'fixture'},parsed,pack,previous:{},origin:'http://localhost:8791',headers:{},fetcher:async()=>{
    calls++;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(response)}}]})};
  }});
  assert.equal(calls,1);assert.deepEqual(result.failures,[]);assert.deepEqual(result.npcActors,actors);
});
