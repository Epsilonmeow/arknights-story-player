import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseStory,validateAnnotations} from '../versions/0.3.9/core.mjs';
import {mergeChapter} from '../versions/0.3.9/assets/chapter-library.mjs';
import {createAnnotationRunner} from '../versions/0.3.9/assets/annotation-runner.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../versions/0.3.9/'+f,import.meta.url)));
const {pack}=mergeChapter(read('pack.json'),read('assets/chapter09/library.json'),read('assets/background-library.json'));
test('row-local NPC declarations pass the same identity checks and survive radio-to-room transition',()=>{
  const parsed=parseStory('罗德岛医疗干员白榆通过无线电说话。\n白榆：收到。\n白榆走进房间。\n白榆：我回来了。',180,'speaker-lines');
  const actor={name:'白榆',portrait:'char_016_medic',role:'medic',faction:'罗德岛',evidence:'罗德岛医疗干员白榆通过无线电说话。'};
  const response={rows:[
    {id:'f0',npcActors:{'npc:medic':actor},remote:['白榆'],communication:['npc:medic'],variants:{'npc:medic':'single'}},
    {id:'f1',kind:'communication'},
    {id:'f2',present:['白榆'],remote:[],communication:[],display:['npc:medic']},
    {id:'f3',focus:'npc:medic'},
  ]};
  const before=JSON.stringify(response),checked=validateAnnotations(parsed,response,pack);
  assert.deepEqual(checked.failures,[]);assert.deepEqual(checked.warnings,[]);
  assert.deepEqual(checked.rows[1].display,[]);assert.deepEqual(checked.rows[1].communication,['npc:medic']);
  assert.deepEqual(checked.rows[3].display,['npc:medic']);assert.deepEqual(checked.rows[3].communication,[]);
  assert.deepEqual(checked.npcActors['npc:medic'],actor);assert.equal(JSON.stringify(response),before);
  for(const replacement of [{...actor,evidence:'我推测这个人是罗德岛干员。'},{...actor,faction:'深池'}]){
    const invalid=structuredClone(response);invalid.rows[0].npcActors['npc:medic']=replacement;
    const rejected=validateAnnotations(parsed,invalid,pack);
    assert(!rejected.npcActors['npc:medic']);assert(rejected.warnings.length);
    assert(rejected.rows.every(r=>!r.display.includes('npc:medic')&&!r.communication.includes('npc:medic')));
  }
  const conflict=structuredClone(response);conflict.npcActors={'npc:medic':{...actor,name:'另一个人'}};
  const rejected=validateAnnotations(parsed,conflict,pack);
  assert(!rejected.npcActors['npc:medic']);assert(rejected.warnings.length);
});
test('rejected NPC art does not discard valid actors or poison inherited variants',async()=>{
  const source='Outcast与罗德岛后勤干员小林交谈。\n陌生医生：你好。\nOutcast：请坐。',parsed=parseStory(source,180,'speaker-lines');
  const result=validateAnnotations(parsed,{npcActors:{
    'npc:lin':{name:'小林',portrait:'avg_npc_088',role:'logistics',faction:'罗德岛',evidence:'Outcast与罗德岛后勤干员小林交谈。'},
    'npc:bad':{name:'陌生医生',portrait:'char_016_medic',role:'medic',faction:'罗德岛',evidence:'我推断他属于罗德岛。'},
  },rows:[
    {id:'f0',present:['Outcast','小林','陌生医生'],display:['avg_npc_245_1','npc:lin','npc:bad'],variants:{'avg_npc_245_1':'1','npc:lin':'single','npc:bad':'single'}},
    {id:'f1',focus:'npc:bad',front:'npc:bad'},
    {id:'f2',display:['avg_npc_245_1'],focus:'avg_npc_245_1'},
  ]},pack);
  assert.deepEqual(result.failures,[]);
  assert.equal(result.warnings.length,1);
  assert.deepEqual(Object.keys(result.npcActors),['npc:lin']);
  assert.deepEqual(result.rows[0].display,['avg_npc_245_1','npc:lin']);
  assert.equal(result.rows[1].focus,null);
  assert.equal(result.rows[1].front,null);
  assert.equal(result.rows[2].focus,'avg_npc_245_1');
  assert(result.rows.every(r=>!r.fallback&&!Object.hasOwn(r.variants,'npc:bad')));
  assert.equal(parsed.source,source);
  let calls=0;const notices=[];
  const status=await createAnnotationRunner().run({capture:async()=>({cached:result}),onBusy:()=>{},useCached:async()=>{},report:t=>notices.push(t),request:()=>{calls++;}});
  assert.equal(status.kind,'cached');assert.equal(calls,0);assert(notices.at(-1).includes('未配图'));
});
