import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {contextFor,recordMatches} from '../versions/0.3.9/continuity.mjs';
const hash=async s=>createHash('sha256').update(s).digest('hex');
const msg=(id,text)=>({id,role:'assistant',swipe:0,format:'auto',text});
const first=msg(0,'（第2楼）\n<tucao>说明</tucao>\nOutcast坐在桌边。\n“请进。”');
const next=msg(2,'（第4楼）\n<tucao>说明</tucao>\n“你好。”');
const context=(messages,target,records={},fixes=[])=>contextFor(messages,target,'pack','revision',fixes,hash,async id=>records[id],{name:'玩家'});

test('auxiliary-only preset edits preserve paid records and their ancestor state',async()=>{
  const a=await context([first],0),record={...a.expected,finalTracks:{main:{display:['outcast']}}};
  const edited={...first,text:first.text.replace('<tucao>','<advice>下一轮输入</advice>\n<tucao>')};
  const b=await context([edited],0);
  assert.notEqual(a.expected.hash,b.expected.hash);
  assert(recordMatches(record,b.expected));
  const c=await context([edited,next],2,{0:record});
  assert.equal(c.ancestor,0);assert.deepEqual(c.initial,record.finalTracks);
  const savedNext={...c.expected,finalTracks:{main:{display:['outcast']}}};
  const changedAgain={...edited,text:edited.text.replace('下一轮输入','修改辅助说明')};
  assert(recordMatches(savedNext,(await context([changedAgain,next],2,{0:record})).expected));
});

test('real story, translation, unknown markup, user input and swipe edits still invalidate',async()=>{
  const user={id:1,role:'user',swipe:0,text:'请继续'},base=[first,user,next];
  const record=(await context(base,2)).expected;
  for(const changed of [
    [first,user,{...next,text:next.text.replace('你好','再见')}],
    [first,user,{...next,text:next.text+'\n『Hello.』'}],
    [first,user,{...next,text:next.text+'<unknown>新正文</unknown>'}],
    [{...first,text:first.text.replace('坐在桌边','已经离开')},user,next],
    [first,{...user,text:'改为离开'},next],
    [first,user,{...next,swipe:1}],
  ])assert(!recordMatches(record,(await context(changed,2)).expected));
});

test('legacy exact-source records remain readable but do not guess auxiliary equivalence',async()=>{
  const expected=(await context([first],0)).expected,legacy={...expected};
  delete legacy.storyHash;delete legacy.storyLineageHash;
  assert(recordMatches(legacy,expected));
  const changed={...first,text:first.text.replace('说明','另一份说明')};
  assert(!recordMatches(legacy,(await context([changed],0)).expected));
});

test('new manual corrections survive auxiliary edits but not changed story fragments',async()=>{
  const expected=(await context([first],0)).expected;
  const fix={id:'fix',anchor:0,sourceHash:expected.hash,storyHash:expected.storyHash,parserRevision:expected.parserRevision,swipe:0,position:0,stage:{display:['outcast']}};
  assert.equal((await context([{...first,text:first.text.replace('说明','新的说明')}],0,{},[fix])).corrections.length,1);
  assert.equal((await context([{...first,text:first.text.replace('请进','再见')}],0,{},[fix])).corrections.length,0);
});
