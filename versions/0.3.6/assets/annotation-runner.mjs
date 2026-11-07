export function annotationQuality(record={}){
  const rows=record.rows??[],all=(record.failures??[]).some(f=>f.includes('整条使用原文分页'));
  const failedIds=new Set((record.failures??[]).map(f=>f.match(/^(f\d+)：/)?.[1]).filter(Boolean));
  const fallbackCount=all?rows.length:rows.filter(r=>r.fallback||failedIds.has(r.id)).length;
  return {total:rows.length,fallbackCount,usable:rows.length-fallbackCount};
}
export function restoreFallbackRows(record){
  const all=(record.failures??[]).some(f=>f.includes('整条使用原文分页')),ids=new Set((record.failures??[]).map(f=>f.match(/^(f\d+)：/)?.[1]).filter(Boolean));
  return (record.rows??[]).map(r=>all||ids.has(r.id)?{...r,fallback:true}:r);
}
export const failureDetail=failures=>(failures??[]).slice(0,5).join('；')+((failures?.length??0)>5?`；另有${failures.length-5}项`:'');
const portraitNotice=record=>{const count=(record?.portraitDiagnostics??[]).filter(n=>n.reason==='not-displayed').length;return count?` 有 ${count} 段现场说话人可能漏配立绘，请查看“检查人物显示”。`:'';};
// One in-flight manual operation. A timed-out or stale response never reaches commit.
export function createAnnotationRunner({timeoutMs=180000}={}){
  let pending=null;
  return {get busy(){return !!pending;},cancel(){pending?.abort();},async run(job){
    if(pending){job.report('已有标注请求正在处理，请等待或取消。');return {kind:'busy'};}
    const controller=new AbortController();pending=controller;job.onBusy(true,controller);
    let timer;const aborted=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason??new DOMException('已取消','AbortError')),{once:true});});
    timer=setTimeout(()=>controller.abort(new DOMException('标注等待超时','TimeoutError')),timeoutMs);
    try{
      const work=async()=>{
        job.report(job.force?'正在重新标注：本次会新调用一次演出模型，正文与旧演出先保留。':'正在读取或请求演出；有结果优先复用。');
        const snapshot=await job.capture();controller.signal.throwIfAborted();
        if(!job.force&&snapshot.cached&&!snapshot.cached.failures?.length&&annotationQuality(snapshot.cached).fallbackCount===0){await job.useCached(snapshot.cached,snapshot,controller.signal);job.report('已读取现有演出，没有调用模型。'+portraitNotice(snapshot.cached));return {kind:'cached'};}
        const response=await job.request(snapshot,controller.signal);controller.signal.throwIfAborted();await job.assertCurrent(snapshot);controller.signal.throwIfAborted();
        const next=job.validate(response,snapshot),q=annotationQuality(next);
        if(response.keptPrevious){if(q.usable)await job.commit(next,snapshot,controller.signal);job.report(`新结果有${response.proposedFallbackCount??0}段未通过，已保留旧演出。${failureDetail(response.proposedFailures)}`);return {kind:'kept'};}
        if(!q.usable){job.report(`标注未得到可用演出，${q.fallbackCount}/${q.total}段回退；旧演出与正文保留。${failureDetail(next.failures)} 可点击重新标注。`);return {kind:'invalid'};}
        if(q.fallbackCount&&snapshot.oldUsable>0){job.report(`新结果${q.fallbackCount}/${q.total}段回退，原有可用演出保留。${failureDetail(next.failures)} 可再次重新标注。`);return {kind:'kept'};}
        await job.commit(next,snapshot,controller.signal);
        job.report((q.fallbackCount?`部分完成：${q.usable}/${q.total}段可用，${q.fallbackCount}段原文回退。${failureDetail(next.failures)} 可重新标注。`:response.recovered?`已恢复原付费结果：${q.total}段结构检查通过，本次没有调用模型。`:`标注完成：${q.total}段结构检查通过${response.cached?'，复用了服务端结果':'，演出已更新'}。`)+portraitNotice(next));
        return {kind:q.fallbackCount?'partial':'success'};
      };
      return await Promise.race([work(),aborted]);
    }catch(e){job.report(e.name==='TimeoutError'?'标注等待超时，旧演出和正文保留；可再次重新标注。':e.name==='AbortError'?'标注已取消，旧演出和正文保留。':'标注失败：'+e.message+'；旧演出和正文保留，可再次尝试。');return {kind:'error',error:e.name};}
    finally{clearTimeout(timer);if(pending===controller){pending=null;job.onBusy(false,null);}}
  }};
}
