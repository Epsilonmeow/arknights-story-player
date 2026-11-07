// Presentation-only pages: fragment IDs, model annotations and source text stay intact.
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function boundaries(text){const result=[0];for(const part of segmenter.segment(text))result.push(part.index+part.segment.length);return result;}
function take(text,fit){
  if(!text)return '';
  const ends=boundaries(text);let low=0,high=ends.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(fit(text.slice(0,ends[mid])))low=mid;else high=mid-1;}
  if(!low)return '';
  let end=ends[low];
  if(end<text.length){
    const prefix=text.slice(0,end),preferred=[...prefix.matchAll(/[。！？!?；;\n]|[.](?=\s)|\s+/gu)].at(-1);
    const cut=preferred?preferred.index+preferred[0].length:0;
    if(cut>=end*.55&&ends.includes(cut))end=cut;
  }
  return text.slice(0,end);
}
export function paginatePresentation(text,original,fits){
  const pages=[];let a=0,b=0;
  do{
    let main=take(text.slice(a),part=>fits({text:part,original:''}));
    // A final main-text page may also hold original-language text. Any remaining
    // original continues on explicitly labelled pages, without inventing alignment.
    let other=a+main.length===text.length?take(original.slice(b),part=>fits({text:main,original:part})):'';
    if(!main&&!other&&(a<text.length||b<original.length)){
      const from=a<text.length?text.slice(a):original.slice(b);
      const first=segmenter.segment(from)[Symbol.iterator]().next().value.segment;
      if(a<text.length)main=first;else other=first;
    }
    pages.push({text:main,original:other,start:a+b,end:a+b+main.length+other.length});a+=main.length;b+=other.length;
  }while(a<text.length||b<original.length);
  return pages;
}
export function pageAtOffset(pages,offset){
  const index=pages.findIndex(page=>page.end>offset);
  return index<0?Math.max(0,pages.length-1):index;
}
