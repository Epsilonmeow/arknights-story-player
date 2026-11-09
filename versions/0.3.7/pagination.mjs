// Display-only pagination: source fragment IDs, annotations and raw text remain intact.
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const sentences=new Intl.Segmenter(undefined,{granularity:'sentence'});
function boundaries(text){const result=[0];for(const part of graphemes.segment(text))result.push(part.index+part.segment.length);return result;}
function take(text,fit){
  if(fit(text))return text;
  const ends=boundaries(text);let low=0,high=ends.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(fit(text.slice(0,ends[mid]).trimEnd()))low=mid;else high=mid-1;}
  // A pathological viewport must still make progress without splitting a grapheme.
  if(!low)return text.slice(0,ends[1]);
  let end=ends[low],sentenceEnd=0;
  for(const part of sentences.segment(text)){
    // ICU may include the next Chinese opening quote in the previous sentence.
    const stop=part.index+part.segment.replace(/[「『“‘《〈（(【\[]+[ \t]*$/u,'').length;
    if(stop>end)break;
    sentenceEnd=stop;
  }
  if(sentenceEnd)end=sentenceEnd;
  else {
    // Only a sentence that cannot fit by itself may be split at a clause/word boundary.
    const prefix=text.slice(0,end),pause=[...prefix.matchAll(/[，,；;：:、\n—…]+/gu)].at(-1),word=[...prefix.matchAll(/\s+/gu)].at(-1);
    const preferred=pause??word,cut=preferred?preferred.index+preferred[0].length:0;
    if(cut>0&&ends.includes(cut))end=cut;
  }
  return text.slice(0,end);
}
export function paginatePresentation(text,fits){
  const pages=[];let at=0;
  while(at<text.length){
    const rest=text.slice(at);at+=rest.length-rest.trimStart().length;
    const remaining=text.slice(at).trimEnd();if(!remaining)break;
    const part=take(remaining,text=>fits({text}));
    pages.push({text:part.trimEnd(),start:at,end:at+part.length});
    at+=part.length;
  }
  return pages;
}
export function pageAtOffset(pages,offset){
  const index=pages.findIndex(page=>page.end>offset);
  return index<0?Math.max(0,pages.length-1):index;
}
export function readableFragmentIndex(fragments,start,direction=1){
  const step=direction<0?-1:1;
  for(let i=start;i>=0&&i<fragments.length;i+=step){
    if((fragments[i].text??'').trim()||(fragments[i].original??'').trim())return i;
  }
  return -1;
}
