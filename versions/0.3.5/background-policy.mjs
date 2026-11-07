// A place is annotation state, never a search over the whole reply or quoted dialogue.
const contains=(text,term)=>text.includes(String(term).toLowerCase());
export function placeSetting(place) {
  const text=String(place??'').toLowerCase();
  const last=pattern=>[...text.matchAll(pattern)].at(-1)?.index??-1;
  const inside=last(/室内|屋内|房间|办公室|办事处|指挥部|走廊|通道|大厅|食堂|仓库|货栈|机房|医疗室|医务室|地图室|作战室|会客室|宴会厅|舱内|货舱|舰桥|木屋内|indoor|office|corridor|room|warehouse/g);
  const outside=last(/室外|户外|门外|屋外|楼外|街道|街巷|支巷|广场|树林|林地|森林|荒野|荒坡|山坡|草地|雪原|村庄|村落|outdoor|street|forest|wilderness/g);
  return inside<0&&outside<0?null:inside>outside?'indoor':'outdoor';
}
export function backgroundAllowed(asset,place) {
  const policy=asset?.scenePolicy??{},text=String(place??'').toLowerCase();
  if(policy.requiredPlaceTerms?.length&&!policy.requiredPlaceTerms.some(t=>contains(text,t)))return false;
  if(policy.excludedPlaceTerms?.some(t=>contains(text,t)))return false;
  const setting=placeSetting(place);
  return !setting||!policy.setting||policy.setting===setting;
}
export function backgroundScore(asset,place) {
  if(!backgroundAllowed(asset,place))return -1;
  const text=String(place??'').toLowerCase();
  const terms=asset.matchTerms??[];
  const score=terms.reduce((n,t)=>n+(contains(text,t)?t.length:0),0);
  return score?score+(asset.priority??0):0;
}
// These excerpts only widen the model's candidates. They never change playback state.
// A positive location clause is required to introduce a restricted location; mere mentions do not qualify.
export function candidatePlaces(parsed,previous={}) {
  const places=Object.values(previous).map(s=>s.place).filter(Boolean);
  for(const f of parsed.fragments??[]) {
    if(f.kind!=='narration')continue;
    const text=f.raw.replace(/[「『“"].*?[」』”"]/gs,'');
    for(const m of text.matchAll(/(?:来到|走进|进入|抵达|回到|位于|身处|地点[：:])([^。！？\n]{2,60})/g))places.push(m[1]);
  }
  return places;
}
