import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {backgroundFor} from '../versions/0.3.7/app.mjs';
import {mergeChapter,referencedAssets,assetRecordMatches} from '../versions/0.3.7/assets/chapter-library.mjs';
import {parseStory,stageAt,validateAnnotations,annotationPrompt,REVISION} from '../versions/0.3.7/core.mjs';
import {selectCandidates} from '../versions/0.3.7/staging.mjs';
import {backgroundAllowed} from '../versions/0.3.7/background-policy.mjs';
const read=(v,f)=>JSON.parse(fs.readFileSync(new URL('../versions/'+v+'/'+f,import.meta.url)));
function setup(v='0.3.7') {
  const library=read(v,'assets/background-library.json');
  const merged=mergeChapter(read(v,'pack.json'),read(v,'assets/chapter09/library.json'),library);
  library.entries.push(...merged.backgroundEntries.filter(a=>!library.entries.some(b=>b.id===a.id)));
  return {library,pack:merged.pack};
}
const {library,pack}=setup();
const choose=(background,place)=>backgroundFor({background,place},library,pack);
test('cached explicit Rhodes corridor cannot render in a garrison corridor',()=>{
  const stage={background:'bg_corridor',place:'小丘郡驻军营地指挥部走廊'};
  const original=structuredClone(stage),visual=backgroundFor(stage,library,pack);
  assert.notEqual(visual.id,'bg_corridor');
  assert.equal(visual.file,pack.backgrounds['21_G1_interrogat_room']);
  assert.deepEqual(stage,original);
});
test('Rhodes scenes remain available, unknown or foreign places cannot borrow their branding',()=>{
  assert.equal(choose('bg_corridor','罗德岛本舰设备走廊').id,'bg_corridor');
  assert.equal(choose('21_G9_rhodes_xqoffice','罗德岛驻小丘郡办事处').id,'21_G9_rhodes_xqoffice');
  for(const place of [null,'未知地点','小丘郡驻军办公室','军营设备走廊']) {
    for(const id of ['bg_corridor','21_G9_rhodes_xqoffice'])assert.notEqual(choose(id,place).id,id);
    assert(choose(null,place).file);
  }
});

test('the visibly Rhodes-marked safehouse needs an explicit Rhodes location',()=>{
  assert.equal(choose('bg_safehouseindoor','罗德岛安全屋室内').id,'bg_safehouseindoor');
  for(const place of [null,'普通安全屋室内','深池安全屋','塔拉村安全屋']) {
    assert.notEqual(choose('bg_safehouseindoor',place).id,'bg_safehouseindoor');
    assert.notEqual(choose(null,place).id,'bg_safehouseindoor');
  }
  const parsed=parseStory('众人来到深池安全屋。',180,'speaker-lines');
  assert(!selectCandidates(parsed,pack,{}).backgrounds.some(a=>a.id==='bg_safehouseindoor'));
});
test('fallback uses a compatible room or outdoor image; fire, snow and ruins need evidence',()=>{
  assert.equal(choose(null,'小丘郡驻军营地指挥部办公室').id,'bg_offce');
  assert.equal(choose(null,'森林').id,'bg_forest');
  assert.notEqual(choose('bg_corridor','室外广场').id,'bg_corridor');
  for(const id of ['21_G8_cammunibase','bg_snow_2','21_G4_victoria_street_d_ruins'])assert.notEqual(choose(id,'普通街道').id,id);
  assert.equal(choose('bg_black','小丘郡军营').id,'bg_black');
});

test('unmatched ordinary interiors use a neutral room view, not an interrogation corridor',()=>{
  for(const place of ['咖啡店室内','咖啡店','染坊街格林诊所室内','诊所','普通房间','cafe','clinic']) {
    const stage={background:null,place},original=structuredClone(stage);
    const visual=backgroundFor(stage,library,pack);
    assert.equal(visual.id,'bg_windows',place);
    assert.equal(visual.generic,true);
    assert.deepEqual(stage,original);
  }
  assert.notEqual(choose(null,'咖啡店门外的街道').id,'bg_windows');
  assert.equal(choose(null,'驻军营地走廊').file,pack.backgrounds['21_G1_interrogat_room']);
  assert.equal(choose(null,'旧纺织厂仓库室内').id,'bg_warehouse');
  assert.equal(choose(null,'普通办公室').id,'bg_offce');
});
test('same track keeps its location through dialogue mentions and changes on a real transition',()=>{
  const parsed=parseStory('号角：罗德岛的消息到了。\n众人来到罗德岛设备走廊。',180,'speaker-lines');
  const initial={main:{background:'21_G1_interrogat_room',place:'军营走廊',present:[],display:[],variants:{}}};
  const rows=validateAnnotations(parsed,{rows:[{id:'f0'},{id:'f1',sceneChange:true,background:'bg_corridor',place:'罗德岛设备走廊'}]},pack,initial).rows;
  const first=stageAt(parsed.fragments,rows,0,initial).stage;
  assert.equal(first.place,'军营走廊');assert.equal(backgroundFor(first,library,pack).file,pack.backgrounds['21_G1_interrogat_room']);
  const second=stageAt(parsed.fragments,rows,1,initial).stage;
  assert.equal(backgroundFor(second,library,pack).id,'bg_corridor');
  rows[1]={...rows[1],background:'bg_corridor',place:'森林'};
  assert.equal(backgroundFor(stageAt(parsed.fragments,rows,1,initial).stage,library,pack).id,'bg_forest');
});
test('candidate restrictions survive merging and mere dialogue cannot authorize a restricted asset',()=>{
  const previous={main:{background:'bg_corridor',place:'军营走廊'}};
  const parsed=parseStory('号角：罗德岛设备走廊的消息到了。',180,'speaker-lines');
  const candidates=selectCandidates(parsed,pack,previous);
  assert(!candidates.backgrounds.some(a=>a.id==='bg_corridor'));
  const moved=parseStory('众人来到罗德岛设备走廊。',180,'speaker-lines');
  const allowed=selectCandidates(moved,pack,{}).backgrounds.find(a=>a.id==='bg_corridor');
  assert(allowed?.scenePolicy?.requiredPlaceTerms.includes('罗德岛'));
  assert(annotationPrompt(moved,pack).includes('scenePolicy'));
  for(const a of pack.assets.filter(a=>a.type==='background'))assert(a.scenePolicy,a.id);
  for(const e of library.entries)assert(e.scenePolicy,e.id);
  assert(!backgroundAllowed(library.entries.find(a=>a.id==='bg_corridor'),'军营走廊'));
});
test('display corrections preserve existing annotation compatibility and referenced image identities',()=>{
  assert.equal(REVISION,'0.2.1');
  assert.deepEqual(read('0.3.7','pack.json'),read('0.3.3','pack.json'));
  const old=setup('0.3.3').pack;
  const record={assetRefs:referencedAssets([{background:'bg_corridor'},{background:'21_G9_rhodes_xqoffice'}],{},old)};
  assert(assetRecordMatches(record,pack));
  for(const a of pack.assets.filter(a=>a.type==='background'))assert.equal(pack.assetSignatures[a.id],old.assetSignatures[a.id],a.id);
});
test('explicit standalone asset preview can inspect restricted images without changing story rules',()=>{
  const stage={background:'bg_corridor',place:null};
  assert.equal(backgroundFor(stage,library,pack,true).id,'bg_corridor');
  assert.notEqual(backgroundFor(stage,library,pack).id,'bg_corridor');
});
