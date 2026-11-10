import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseStory,validateAnnotations,stageAt,annotationPrompt} from '../versions/0.3.9/core.mjs';
import {mergeChapter} from '../versions/0.3.9/assets/chapter-library.mjs';
import {playerStagePack,annotationPlayer} from '../versions/0.3.9/assets/player-avatar.mjs';
import * as staging from '../versions/0.3.9/staging.mjs';
import {createAnnotationRunner} from '../versions/0.3.9/assets/annotation-runner.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../versions/0.3.9/'+p,import.meta.url),'utf8'));
const {pack}=mergeChapter(read('pack.json'),read('assets/chapter09/library.json'),read('assets/background-library.json'));
const player=annotationPlayer({playerName:'测试玩家',name:'测试玩家',characterId:null},{personaId:'fixture.png',playerName:'测试玩家'});
const scenePack=playerStagePack(pack,player);
const previous={main:{present:['风笛','琴柳','Outcast'],display:['avg_222_bpipe_1','avg_479_sleach_1','avg_npc_245_1'],variants:{}},parallel:{present:['号角','副官希尔'],display:['avg_npc_229_1','avg_npc_248'],variants:{}}};
const source='风笛来到街口，看见凯利上尉。克雷格跑来，停在他们身边。\n凯利上尉：慢一点。\n克雷格：我有话要说。\n琴柳提到西尔莎、汉密尔顿上校、阿米娅和苇草。';
test('long reply retains every matched portrait despite prior cast and player priority',()=>{
 const parsed=parseStory(source,180,'speaker-lines'),before=JSON.stringify({parsed,previous});
 const selected=staging.selectCandidates(parsed,{...scenePack,currentPlayerId:player.characterId},previous);
 const names=new Set(selected.characters.map(c=>c.name));
 for(const name of ['凯利上尉','克雷格','西尔莎','汉密尔顿上校','阿米娅','苇草','风笛','号角','琴柳','Outcast','副官希尔','测试玩家'])assert(names.has(name),'Missing candidate: '+name);
 assert.equal(JSON.stringify({parsed,previous}),before);
 for(const c of selected.characters)assert(c.variants.some(v=>v.variant===c.defaultVariant),c.name+' default missing');
 const prompt=annotationPrompt(parsed,scenePack,previous,player);
 const submitted=JSON.parse(prompt.split('候选资料:')[1].split('\n')[0]);
 assert.deepEqual(submitted.characters.map(c=>c.id),selected.characters.map(c=>c.id));
});
test('confirmed alias is included; generic titles do not invent identities or enable shared NPCs',()=>{
 const names=text=>staging.selectCandidates(parseStory(text),pack,{}).characters.map(c=>c.name);
 assert(names('路易斯·凯利走了进来。').includes('凯利上尉'));
 assert(!names('一个上尉和一个小男孩在街边交谈。').includes('凯利上尉'));
 assert(!names('深池士兵走过街口。').includes('深池士兵'));
});
const row=(id,patch={})=>({id,kind:'dialogue',speaker:'凯利上尉',sceneChange:false,background:null,place:null,present:['风笛','凯利上尉','克雷格'],referenced:[],remote:[],display:['avg_222_bpipe_1'],communication:[],focus:null,front:null,variants:{},...patch});
test('valid cached rows expose missing speaker portraits without rewriting or rejecting them',()=>{
 const parsed=parseStory('凯利上尉：慢一点。\n克雷格：等等。',180,'speaker-lines');
 const saved={rows:[row('f0'),row('f1',{speaker:'克雷格'})]},before=JSON.stringify(saved);
 const checked=validateAnnotations(parsed,saved,pack);
 assert.equal(checked.failures.length,0);assert.deepEqual(checked.rows.map(r=>r.display),[['avg_222_bpipe_1'],['avg_222_bpipe_1']]);
 assert.deepEqual(checked.portraitDiagnostics.map(d=>[d.id,d.speaker,d.reason]),[['f0','凯利上尉','not-displayed'],['f1','克雷格','not-displayed']]);
 assert.equal(JSON.stringify(saved),before);
});
test('diagnostics distinguish unavailable art and omit offscreen, remote, player, CG and fallback',()=>{
 const diagnose=staging.portraitDiagnostics;
 assert.equal(typeof diagnose,'function');
 const notes=diagnose([row('f0',{speaker:'路易斯·凯利'}),row('f1',{speaker:'路人甲',present:['路人甲']}),
  row('f2',{kind:'voiceover'}),row('f3',{kind:'communication',present:[],remote:['凯利上尉']}),
  row('f4',{present:['风笛'],referenced:['凯利上尉']}),row('f5',{speaker:'测试玩家',present:['测试玩家']}),
  row('f6',{illustration:'21_I14'}),row('f7',{fallback:true}),row('f8',{display:['avg_npc_238']})],scenePack);
 assert.deepEqual(notes.map(d=>[d.id,d.reason]),[['f0','not-displayed'],['f1','no-portrait']]);
});
test('entry, dialogue, exit, mention and parallel-track inheritance remain distinct',()=>{
 const parsed={fragments:['main','parallel','main','main','parallel','main'].map((track,i)=>({id:'f'+i,track,kind:'dialogue',speakerHint:''}))};
 const response={rows:[row('f0',{display:['avg_222_bpipe_1','avg_npc_238','avg_npc_240'],focus:'avg_npc_238'}),
  row('f1',{speaker:'号角',present:['号角'],display:['avg_npc_229_1'],focus:'avg_npc_229_1'}),
  {id:'f2',speaker:'克雷格',focus:'avg_npc_240'},
  {id:'f3',speaker:'凯利上尉',present:['风笛','凯利上尉'],display:['avg_222_bpipe_1','avg_npc_238'],focus:'avg_npc_238'},
  {id:'f4',speaker:'号角',focus:'avg_npc_229_1'},
  {id:'f5',speaker:'凯利上尉',referenced:['克雷格'],focus:'avg_npc_238'}]};
 const checked=validateAnnotations(parsed,response,pack);assert.deepEqual(checked.failures,[]);
 assert.deepEqual(checked.portraitDiagnostics,[]);
 assert(stageAt(parsed.fragments,checked.rows,2).stage.display.includes('avg_npc_240'));
 assert.deepEqual(stageAt(parsed.fragments,checked.rows,4).stage.display,['avg_npc_229_1']);
 assert(!stageAt(parsed.fragments,checked.rows,5).stage.display.includes('avg_npc_240'));
});
test('portrait warnings neither invalidate cached rows nor cause automatic paid retries',async()=>{
 const record={rows:[row('f0')],failures:[],portraitDiagnostics:[{id:'f0',speaker:'凯利上尉',reason:'not-displayed'}]};
 let calls=0,commits=0;const notices=[];
 const job={force:false,onBusy(){},report:t=>notices.push(t),capture:async()=>({cached:record,oldUsable:1}),useCached:async()=>{},request:async()=>{calls++;return record;},assertCurrent:async()=>{},validate:r=>r,commit:async()=>{commits++;}};
 assert.equal((await createAnnotationRunner().run(job)).kind,'cached');assert.equal(calls,0);assert.equal(commits,0);assert(notices.at(-1).includes('可能漏配'));
 assert.equal((await createAnnotationRunner().run({...job,force:true})).kind,'success');assert.equal(calls,1);assert.equal(commits,1);assert(notices.at(-1).includes('结构检查通过'));assert(notices.at(-1).includes('可能漏配'));
});
