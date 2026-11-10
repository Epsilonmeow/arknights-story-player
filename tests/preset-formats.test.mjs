import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStory,storyParserRevision,dialogueDisplayText} from '../versions/0.3.9/core.mjs';

test('now_plot excludes draft instructions and scene metadata without losing the raw reply',()=>{
  const source='<draft>规划里提到号角。<now_plot>这里只是格式示例</now_plot></draft>\n<scene_time>1097-11-04T16:20 | 地点 | 天气</scene_time>\n<now_plot>雨声很轻。\n\n{Outcast}「请进。」\n\n她放下茶杯。\n{小林}「物资送到了。」\n</now_plot>\n<summary>摘要不播放</summary>';
  const p=parseStory(source);
  assert.equal(p.spans.map(s=>source.slice(s.start,s.end)).join(''),source);
  assert.equal(p.fragments.map(f=>f.raw).join('').replace(/\s/g,''),'雨声很轻。{Outcast}「请进。」她放下茶杯。{小林}「物资送到了。」');
  assert.deepEqual(p.fragments.filter(f=>f.kind==='dialogue').map(f=>[f.speakerHint,f.raw.trim()]),[['Outcast','{Outcast}「请进。」'],['小林','{小林}「物资送到了。」']]);
});

test('explicit speaker dialogue stays separate from narration and preserves its translation',()=>{
  const source='<now_plot>门开了。\n{小林}「'+('我带来了药箱，'.repeat(35))+'请检查。」\n『Please check.』\n她走进屋。\n{白榆}“收到。”</now_plot>';
  const p=parseStory(source),spoken=p.fragments.filter(f=>f.speakerHint);
  assert.equal(spoken.length,2);assert(spoken[0].text.startsWith('{小林}「'));assert.equal(spoken[0].original.trim(),'『Please check.』');
  assert.equal(spoken[1].speakerHint,'白榆');
  assert.equal(dialogueDisplayText(spoken[1].text,{kind:'dialogue',speaker:'白榆'},{characters:{}}),'“收到。”');
});

test('new format compatibility invalidates only affected annotations',()=>{
  assert.equal(storyParserRevision('普通正文'),null);
  assert.equal(storyParserRevision('<think>规划</think><content>正文</content>'),'auxiliary-20261108');
  assert.notEqual(storyParserRevision('<draft>规划</draft><now_plot>正文</now_plot>'),null);
  assert.equal(storyParserRevision('{甲}「你好。」','speaker-lines'),null);
  assert(parseStory('<content>正文说“draft只是英文单词”。<unknown>保留</unknown></content>').fragments.map(f=>f.raw).join('').includes('<unknown>保留</unknown>'));
});

test('preset planning comments inside the story wrapper never become dialogue or stage evidence',()=>{
  const source='<now_plot><!-- plotThink: 规划地点与角色 --><!-- charThink: <content>仅为范例</content> -->Outcast放下杯子。\n{Outcast}「请进。」<!-- jp: hidden note --></now_plot>';
  const p=parseStory(source);
  assert.equal(p.fragments.map(f=>f.raw).join('').replace(/\s/g,''),'Outcast放下杯子。{Outcast}「请进。」');
  assert.equal(p.spans.map(s=>source.slice(s.start,s.end)).join(''),source);
});

test('plain quoted dialogue keeps each speaker turn intact, including interrupted speech',()=>{
  const source='（第2楼）\n<tucao>辅助说明</tucao>\n屋里有一张“物资登记”表。\n\n“封条完整？”\n\n“没有动过。”小林翻开清单，“'+('这是完整的情况，'.repeat(40))+'请核对。”\n\n通讯器里传来白榆的声音：\n“收到。”\n\nOutcast回答：「谢谢。」';
  const p=parseStory(source),q=p.fragments.filter(f=>f.kind==='dialogue');
  assert.equal(q.length,4);
  assert.equal(q[0].text.trim(),'“封条完整？”');
  assert.equal(q[1].text.trim(),'“没有动过。”小林翻开清单，“'+('这是完整的情况，'.repeat(40))+'请核对。”');
  assert(p.fragments.some(f=>f.kind==='narration'&&f.text.includes('“物资登记”')));
  assert.equal(p.spans.map(s=>source.slice(s.start,s.end)).join(''),source);
  assert.equal(storyParserRevision(source),'preset-dialogue-20261110');
  assert.equal(storyParserRevision('门开了。\n「你好。」『Hello.』'),null);
  assert.equal(storyParserRevision('屋里有一张“物资登记”表。'),null);
});
