import { Place } from '../../shared/model';
import { collectMealEvidence, mealAssessment } from '../../shared/meals';
export function SourceEvidence({place,meal}:{place:Place;meal?:string|null}){
 const check=meal?mealAssessment(place,meal):null,meals=collectMealEvidence(place).filter(e=>!meal||e.meal===meal);
 return <>
  {check&&<p className="mt-3 text-xs text-amber-200">{check.conflict?'餐期來源資訊衝突，尚待確認':check.status==='unknown'?'用餐時段未確認':check.status==='confirmed'?'來源支持所選用餐時段；非目前營業保證':'來源表示不符合所選用餐時段'}</p>}
  <details className="mt-4 text-xs text-slate-400" data-testid="source-evidence"><summary className="cursor-pointer text-emerald-300">可查證來源 · {place.evidence.length} 筆</summary><div className="mt-3 space-y-3">{place.evidence.map((e,i)=><div key={`${e.url}:${i}`} className="rounded-lg border border-slate-700 p-3"><a className="break-words text-emerald-200 underline" href={e.url} target="_blank" rel="noopener noreferrer">{e.sourceTitle??e.provider}</a><p className="mt-1">{e.providerName??e.provider} · {e.evidenceType??(e.kind==='osm-tags'?'地點類別標籤':'公開文章場所證據')}</p><p className="mt-2 leading-5">{e.description}</p>{e.extractedPlaceName&&<p className="mt-1">文章場所：{e.extractedPlaceName}</p>}{e.locationEvidence&&<p className="mt-1">定位依據：{e.locationEvidence}</p>}{e.categoryEvidence&&<p className="mt-1">類別依據：{e.categoryEvidence}</p>}<p className="mt-2 text-slate-500">取得：{new Date(e.retrievedAt).toLocaleString('zh-TW')}{e.publishedAt?` · 發布／更新：${e.publishedAt}`:''}</p></div>)}</div>
   <details className="mt-3"><summary>餐期原始證據（衝突資料均保留）</summary>{meals.length?meals.map((e,i)=><p key={i} className="mt-2 break-words">{e.meal} · {e.status==='confirmed'?'符合':e.status==='excluded'?'不符合':'未知'} · {e.verificationStatus==='verified'?'可解析證據':'未能確認'} · {e.evidenceType} · 原文：{e.raw} · 營業時間：{e.openingHours??'未知'} · <a href={e.sourceUrl} className="underline" target="_blank" rel="noopener noreferrer">來源</a></p>):<p>尚無可確認用餐時段的證據。</p>}</details>
  </details>
 </>;
}
