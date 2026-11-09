import {isStoryReply,parseStory} from '../core.mjs';
export const NODE_KEY='ark_story_node_v1';
export const THEMES={
  '9':{label:'第九章 · 风暴瞭望',prefix:'9',defaultBackground:'up',backgrounds:{up:{label:'灰白城区',file:'assets/supplement-20261106/catalog/zone_map_9_up.png'},middle:{label:'受损城区',file:'assets/supplement-20261106/catalog/zone_map_9_middle.png'},down:{label:'高塔夜景',file:'assets/supplement-20261106/catalog/zone_map_9_down.png'}}},
  '10':{label:'第十章（待接入）',prefix:'10',defaultBackground:null,backgrounds:{},disabled:true}
};
export function validReply(m,index){return isStoryReply(m,index)&&parseStory(m.mes).fragments.length>0&&parseStory(m.mes,180,m.extra?.ark_story_format??'auto').fragments.length>0;}
export function collectNodes(chat,prefix='9'){
  const nodes=[];
  chat.forEach((m,index)=>{if(!validReply(m,index))return;const id=m.extra?.[NODE_KEY];if(typeof id!=='string'||!id)return;const f=parseStory(m.mes,180,m.extra?.ark_story_format??'auto').fragments[0];nodes.push({id,index,label:prefix+'-'+(nodes.length+1),preview:f.text.replace(/\s+/g,' ').slice(0,60)});});
  return nodes;
}
// Metadata belongs to this component only. Identity is independent of text, swipe, and array index.
export function ensureNodeIds(chat,uuid=()=>crypto.randomUUID()){
  const seen=new Set();let changed=false;
  chat.forEach((m,index)=>{
    if(!validReply(m,index))return;
    let id=m.extra?.[NODE_KEY]??m.swipe_info?.find(s=>typeof s?.extra?.[NODE_KEY]==='string')?.extra[NODE_KEY];
    if(typeof id!=='string'||!id||seen.has(id))id=uuid();
    m.extra??={};if(m.extra[NODE_KEY]!==id){m.extra[NODE_KEY]=id;changed=true;}
    // SillyTavern restores extra from swipe_info on a swipe. Keep only our ID on each existing variant.
    for(const s of m.swipe_info??[]){if(!s||typeof s!=='object')continue;s.extra??={};if(s.extra[NODE_KEY]!==id){s.extra[NODE_KEY]=id;changed=true;}}
    seen.add(id);
  });
  return changed;
}
export function resolveNode(chat,id){return chat.findIndex((m,index)=>m.extra?.[NODE_KEY]===id&&validReply(m,index));}
