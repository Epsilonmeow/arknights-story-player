import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStory} from '../versions/0.3.9/core.mjs';
import {contextFor,recordMatches} from '../versions/0.3.9/continuity.mjs';

test('preset planning and memory edits do not become story or parallel scenes',()=>{
 const source='<think><details><summary>规划</summary>准备让甲进场。</details><content>不是正文。</content></think><konatan_planning~>另一份规划。</konatan_planning~>\n甲推开门。\n「你好。」\n『Hello.』\n<details><summary>平行事件详情</summary>远处乙正在守夜。</details><IzumiEdit>新建记录\n甲到达了。</IzumiEdit><tucao>附加说明。</tucao>';
 const parsed=parseStory(source);
 const shown=parsed.fragments.map(f=>f.raw).join('');
 assert.equal(shown.replace(/\s/g,''),'甲推开门。「你好。」『Hello.』远处乙正在守夜。');
 assert.equal(parsed.fragments.at(-1).track,'parallel-1');
 assert.equal(parsed.spans.map(s=>source.slice(s.start,s.end)).join(''),source);
 assert.equal(parsed.fragments.find(f=>f.kind==='dialogue').original.trim(),'『Hello.』');
});

test('known auxiliary blocks are excluded inside content; unknown markup stays readable',()=>{
 const parsed=parseStory('<content>开场。<THINK>规划。</THINK>继续。<mystery>原文标记。</mystery><IzumiEdit>记忆。</IzumiEdit>结束。</content>');
 assert.equal(parsed.fragments.map(f=>f.raw).join(''),'开场。继续。<mystery>原文标记。</mystery>结束。');
});

test('standalone preset floor counters do not create pages; spoken floor text is preserved',()=>{
 const source='（第2楼）\r\n甲在第二层，指着标牌（第3楼）说话。\n（第12楼）\n乙回答。';
 const parsed=parseStory(source);
 assert.equal(parsed.fragments.map(f=>f.raw).join('').trim(),'甲在第二层，指着标牌（第3楼）说话。\n\n乙回答。');
 assert.equal(parsed.spans.map(s=>source.slice(s.start,s.end)).join(''),source);
});

test('new auxiliary boundaries invalidate only affected caches and manual corrections',async()=>{
 const m={id:0,role:'assistant',swipe:0,text:'甲进门。',format:'auto'}, hash=async s=>s;
 const resolve=(messages,fixes=[],read=async()=>null,target=0)=>contextFor(messages,target,'p','r',fixes,hash,read);
 const old=await resolve([m]);assert(!('parserRevision' in old.expected));
 const tagged={...m,text:'<think>规划。</think>甲进门。'};
 const fix={id:'fix',anchor:0,swipe:0,sourceHash:tagged.text,position:0,stage:{display:[]}};
 const fresh=await resolve([tagged],[fix]);assert.equal(fresh.corrections.length,0);
 const stale={...fresh.expected};delete stale.parserRevision;
 assert(!recordMatches(stale,fresh.expected));
 assert.equal((await resolve([tagged],[{...fix,parserRevision:fresh.expected.parserRevision}])).corrections.length,1);
 const following={...m,id:1,text:'乙进门。'};
 assert.equal((await resolve([tagged,following],[],async()=>({...stale,finalTracks:{main:{display:['wrong']}}}),1)).ancestor,null);
 assert.equal((await resolve([m,following],[],async()=>({...old.expected,finalTracks:{main:{display:[]}}}),1)).ancestor,0);
});
