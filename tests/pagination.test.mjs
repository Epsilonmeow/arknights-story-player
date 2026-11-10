import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as pagination from '../versions/0.3.8/pagination.mjs';
const {paginatePresentation,pageAtOffset}=pagination;
const fits=(width=30)=>({text})=>text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(Array.from(line).length/width)),0)<=3;
const letters=text=>text.replace(/\s/gu,'');
test('paragraph padding does not split a sentence that fits three lines',()=>{
  const body='他压了压头顶的帽子，从椅子上站起身，顺手拿起桌上盘子里最后一块点心，递到来访者手中。';
  const pages=paginatePresentation('\n\n'+body+'\n\n',fits());
  assert.equal(pages.length,1);assert.equal(pages[0].text,body);assert.equal(pages[0].start,2);
});
test('keep a whole fitting sentence on the next page even when this leaves a short first page',()=>{
  const a='甲'.repeat(18)+'。',b='乙'.repeat(80)+'。';
  assert.deepEqual(paginatePresentation(a+b,fits()).map(p=>p.text),[a,b]);
  assert.equal(paginatePresentation('门开了。风停了。她走进屋内。',fits()).length,1);
});
test('oversized sentences prefer clauses, while unpunctuated text still advances safely',()=>{
  const text='甲'.repeat(40)+'，'+'乙'.repeat(60)+'；'+'丙'.repeat(60)+'。';
  const pages=paginatePresentation(text,fits());
  assert(pages.every(fits()));assert(pages.slice(0,-1).every(p=>/[，；]$/.test(p.text)));
  assert.equal(pages.map(p=>p.text).join(''),text);
  for(const text of ['A'.repeat(300),'👩🏽‍🚀'.repeat(100)]){
    const pages=paginatePresentation(text,fits());assert(pages.every(fits()));assert.equal(pages.map(p=>p.text).join(''),text);
    if(text.startsWith('👩'))assert(pages.every(p=>p.text.length%'👩🏽‍🚀'.length===0));
  }
});
test('closing quotes stay with their sentence and explicit interior newlines use the line budget',()=>{
  const a='「门已经关上了。」',b='「'+'乙'.repeat(75)+'。」';
  const pages=paginatePresentation(a+b,fits(27));assert.equal(pages[0].text,a);
  const text='第一行\n第二行\n\n第四行\n第五行。';
  const broken=paginatePresentation(text,fits());assert(broken.every(fits()));assert(broken.every(p=>p.text.trim()));
  assert.equal(letters(broken.map(p=>p.text).join('')),letters(text));
});
test('long text stays complete and original source offsets survive resize and old translation-page offsets',()=>{
  const text='\n\n'+('长句保持字词和次序。下一句继续阅读！\n').repeat(20)+'\n';
  const wide=paginatePresentation(text,fits()),narrow=paginatePresentation(text,fits(9));
  for(const pages of [wide,narrow]){
    assert.equal(letters(pages.map(p=>p.text).join('')),letters(text));
    for(let i=0;i<pages.length;i++){assert.equal(pageAtOffset(pages,pages[i].start),i);assert.equal(text.slice(pages[i].start,pages[i].end).trim(),pages[i].text);}
  }
  const offset=wide[3].start,i=pageAtOffset(narrow,offset);
  assert(narrow[i].end>offset);assert.equal(pageAtOffset(narrow,Number.MAX_SAFE_INTEGER),narrow.length-1);
});
test('whitespace has no presentation pages and navigation skips empty fragments in both directions',()=>{
  for(const text of ['', '\n'.repeat(80), ' \t\n '])assert.deepEqual(paginatePresentation(text,fits()),[]);
  const fragments=[{text:'甲。'},{text:'\n\n',original:' '},{text:'乙。'},{text:'\n'}];
  assert.equal(pagination.readableFragmentIndex(fragments,1,1),2);
  assert.equal(pagination.readableFragmentIndex(fragments,1,-1),0);
  assert.equal(pagination.readableFragmentIndex(fragments,3,1),-1);
  assert.equal(pagination.readableFragmentIndex([{text:'',original:'Original only.'}],0,1),0);
  assert.equal(fragments.length,4);
});
