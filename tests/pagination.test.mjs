import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paginatePresentation,pageAtOffset} from '../versions/0.3.2/pagination.mjs';
const fits=({text,original})=>Array.from(text).length+Array.from(original).length<=48;
test('long bilingual passages fit, preserve exact text and order, and remain independently pageable',()=>{
  const text=('长句保持原来的字词。下一句继续阅读！\n').repeat(20),original=('Original words remain in order. ').repeat(25);
  const pages=paginatePresentation(text,original,fits);
  assert(pages.length>2);assert(pages.every(fits));
  assert.equal(pages.map(p=>p.text).join(''),text);assert.equal(pages.map(p=>p.original).join(''),original);
  assert.equal(pages.map(p=>p.text+p.original).join(''),text+original);
  for(let i=0;i<pages.length;i++){assert.equal(pageAtOffset(pages,pages[i].start),i);assert.equal(pages[i].end-pages[i].start,pages[i].text.length+pages[i].original.length);}
});
test('short bilingual text stays on one page; continuation offsets survive resized layout',()=>{
  assert.equal(paginatePresentation('短句','Short.',fits).length,1);
  const text='逐页阅读。'.repeat(50),wide=paginatePresentation(text,'',fits),narrow=paginatePresentation(text,'',p=>p.text.length<=20),offset=wide[3].start;
  const i=pageAtOffset(narrow,offset);assert(narrow[i].start<=offset&&narrow[i].end>offset);
  assert.equal(pageAtOffset(narrow,Number.MAX_SAFE_INTEGER),narrow.length-1);
});
test('graphemes, long unbroken strings, whitespace, and empty content are not lost',()=>{
  for(const text of ['👩🏽‍🚀'.repeat(45),'A'.repeat(300),'\n'.repeat(80),'']){
    const pages=paginatePresentation(text,'',fits);assert.equal(pages.map(p=>p.text).join(''),text);
    assert(pages.every(fits));assert(pages.length>0);
    if(text.startsWith('👩'))assert(pages.every(p=>p.text.length%'👩🏽‍🚀'.length===0));
  }
});
