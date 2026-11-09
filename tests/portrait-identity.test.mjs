import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseStory,annotationPrompt,validateAnnotations} from '../versions/0.3.7/core.mjs';
import {mergeChapter,assetRecordMatches} from '../versions/0.3.7/assets/chapter-library.mjs';
const read=(version,p)=>JSON.parse(fs.readFileSync(new URL('../versions/'+version+'/'+p,import.meta.url),'utf8'));
const load=v=>mergeChapter(read(v,'pack.json'),read(v,'assets/chapter09/library.json'),read(v,'assets/background-library.json')).pack;
const pack=load('0.3.7');
const candidates=text=>JSON.parse(annotationPrompt(parseStory(text),pack).split('候选资料:')[1].split('\n')[0]);
test('surprised Horn can choose the reviewed surprised face, independently of unrelated prose',()=>{
 const horn=candidates('号角：一颗球？好眼熟。远处的人闭眼休息。').characters.find(c=>c.name==='号角');
 const shy=horn.variants.find(v=>v.variant==='3'),surprised=horn.variants.find(v=>v.variant==='4');
 assert(surprised,'surprised face must not be evicted by a four-variant cap');
 assert.match(shy.description,/脸红/);assert.match(shy.description,/害羞/);
 assert.match(surprised.description,/惊讶/);
 assert.match(pack.characters[horn.id].variantInfo['3'].description,/害羞/);
});
test('Loughshinny resolves to Reed with two outfits, without assigning the generic title leader to her',()=>{
 const id=pack.aliases['拉芙希妮'];assert.equal(id,'avg_226_weed_1');
 const reed=candidates('拉芙希妮提着长枪走出巷口。').characters.find(c=>c.id===id);
 assert(reed);assert(reed.variants.some(v=>v.id==='avg_npc_231'));assert(reed.variants.some(v=>v.id==='avg_226_weed_1'));
 assert.equal(pack.aliases['领袖'],undefined);assert.equal(pack.aliases['“领袖”'],undefined);
 assert(!candidates('一位陌生领袖来到广场。').characters.some(c=>c.id===id));
 assert.equal(pack.characters[id].variants.default,'assets/chapter09/images/0ec11a7cb6ba30ab.png');
 assert.equal(pack.characters[id].default,'default');
 const {poses}=mergeChapter(read('0.3.7','pack.json'),read('0.3.7','assets/chapter09/library.json'),read('0.3.7','assets/background-library.json'));
 assert.equal(poses[id].variants.default.headHeight,225);
 assert.equal(poses[id].variants['avg_npc_231:default'].headHeight,265);
});
test('confirmed aliases validate presence and still reject offscreen or remote contradictions',()=>{
 const parsed=parseStory('路易斯·凯利：停下。',180,'speaker-lines');
 const response={rows:[{id:'f0',present:['路易斯·凯利'],display:['avg_npc_238']}]};
 const before=JSON.stringify(response),checked=validateAnnotations(parsed,response,pack);
 assert.deepEqual(checked.failures,[]);assert.deepEqual(checked.rows[0].present,['凯利上尉']);assert.equal(JSON.stringify(response),before);
 for(const patch of [{present:['上尉']},{remote:['凯利上尉']},{present:[],referenced:['路易斯·凯利']}]){
  assert.equal(validateAnnotations(parsed,{rows:[{...response.rows[0],...patch}]},pack).failures.length,1);
 }
});
test('existing safe portrait signatures remain compatible; newly identified outfit has a new signature',()=>{
 const old=load('0.3.6');
 for(const id of ['avg_npc_245_1#1','avg_npc_229_1#3','avg_226_weed_1','avg_npc_240'])assert(assetRecordMatches({assetRefs:{[id]:old.assetSignatures[id]}},pack),id);
 assert.notEqual(pack.assetSignatures.avg_npc_231,old.assetSignatures.avg_npc_231);
});
