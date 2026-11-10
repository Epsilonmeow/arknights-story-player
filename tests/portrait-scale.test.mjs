import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {portraitStyle,mergePortraitLayout} from '../versions/0.3.9/app.mjs';
import {mergeChapter,assetRecordMatches} from '../versions/0.3.9/assets/chapter-library.mjs';
import {parseStory,annotationPrompt,validateAnnotations} from '../versions/0.3.9/core.mjs';
import {NPC_CATALOG} from '../versions/0.3.9/npc.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../versions/0.3.9/'+p,import.meta.url)));
const base=read('pack.json'),library=read('assets/chapter09/library.json'),backgrounds=read('assets/background-library.json');
const {pack,poses}=mergeChapter(base,library,backgrounds,read('assets/mostima/library.json'));
const layout=mergePortraitLayout(read('assets/portrait-layout.json'),poses,base.characters);
const pixels=(css,w,h)=>Math.min(...[...css.matchAll(/([\d.]+)(vh|vw)/g)].map(m=>Number(m[1])*(m[2]==='vh'?h:w)/100));
// Independent landmarks from visually reviewed source PNGs, not derived from the layout under test.
const references=[['avg_npc_245_1','6',130,176],['avg_226_weed_1','avg_npc_231:default',188,230],['avg_226_weed_1','default',225,260],['avg_npc_229_1','4',105,153],['avg_222_bpipe_1','3',262,300],['char_213_mostma_1','default',155,205]];
test('actual renderer keeps reviewed faces at a comparable scale and eye line on desktop and narrow screens',()=>{
  for(const [w,h]of [[1280,800],[390,780]]){
    const measured=references.map(([id,v,eye,chin])=>{const p=portraitStyle(layout,id,v,50),scale=pixels(p.height,w,h)/1024,top=Number(p.top.match(/calc\(([\d.]+)vh/)[1])*h/100-pixels(p.top.slice(p.top.indexOf('min(')),w,h);return {face:(chin-eye)*scale,eye:top+eye*scale};});
    const faces=measured.map(p=>p.face),eyes=measured.map(p=>p.eye);
    assert(Math.max(...faces)/Math.min(...faces)<=1.15,JSON.stringify(measured));
    assert(Math.max(...eyes)-Math.min(...eyes)<=h*.02,JSON.stringify(measured));
  }
});
test('masked NPCs have comparable head scale to the same-scene adults, excluding ears and horns',()=>{
  // Visible crown-to-jaw references are independent of the eye-to-chin sizing rule.
  // A hidden anatomical chin cannot be inferred from the edge of a mask.
  const heads=[['avg_npc_245_1','6',36,176],['avg_npc_089','single',75,200],['avg_226_weed_1','avg_npc_231:default',113,230],['avg_npc_244','single',8,130],['char_013_riop','single',53,193],['avg_npc_090','single',62,200],['avg_npc_012','single',38,176],['avg_npc_088','single',130,270],['char_1002_nsabr_2','single',40,164]];
  for(const [w,h]of [[1280,800],[390,780]]){
    const sizes=heads.map(([id,v,top,chin])=>(chin-top)*pixels(portraitStyle(layout,id,v,50).height,w,h)/1024);
    assert(Math.max(...sizes)/Math.min(...sizes)<=1.25,JSON.stringify(sizes));
  }
});
test('all twelve approved reusable appearances have independent layout references',()=>{
  for(const npc of NPC_CATALOG){
    assert(layout.characters[npc.id]?.face,npc.label);
    assert(portraitStyle(layout,npc.id,'single',50).calibrated,npc.label);
  }
});
test('expression switches and stage slots do not change a calibrated character scale',()=>{
  for(const id of ['avg_npc_229_1','avg_npc_245_1','char_213_mostma_1']){
    const first=portraitStyle(layout,id,pack.characters[id].default,50);
    for(const variant of Object.keys(pack.characters[id].variants))for(const x of [25,33.3333,50,66.6667,75]){
      const pose=portraitStyle(layout,id,variant,x);
      assert.equal(pose.width,first.width,id+' '+variant);assert.equal(pose.top,first.top,id+' '+variant);
    }
  }
});
test('Mostima normal expressions enter the real prompt; her unconfirmed shadow remains manual only',()=>{
  const parsed=parseStory('莫斯提马：下午好。'),candidate=JSON.parse(annotationPrompt(parsed,pack).split('候选资料:')[1].split('\n')[0]).characters.find(c=>c.name==='莫斯提马');
  assert(candidate);assert.equal(candidate.id,'char_213_mostma_1');assert.equal(candidate.variants.length,6);
  assert(!candidate.variants.some(v=>v.variant==='6'));
  assert.equal(pack.characters[candidate.id].variants.default,pack.characters[candidate.id].variants['1']);
  assert(pack.supplementRegistry.find(a=>a.id==='char_213_mostma_1#6').manualOnly);
  const row={id:'f0',kind:'dialogue',speaker:'莫斯提马',present:['莫斯提马'],display:[candidate.id],variants:{[candidate.id]:'2'}};
  assert.deepEqual(validateAnnotations(parsed,{rows:[row]},pack).failures,[]);
  assert.equal(validateAnnotations(parsed,{rows:[{...row,variants:{[candidate.id]:'6'}}]},pack).failures.length,1);
});
test('adding supplemental art and layout calibration preserves every existing resource signature',()=>{
  const previous=mergeChapter(base,library,backgrounds).pack;
  assert(assetRecordMatches({assetRefs:previous.assetSignatures},pack));
  assert.equal(pack.chapterRegistry.length,162);assert.equal(pack.supplementRegistry.length,7);
  assert.deepEqual(base,read('pack.json'));
});
