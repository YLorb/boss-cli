import type { Frame, HTTPRequest, HTTPResponse } from 'puppeteer-core';

// Search v5570: SearchCandidatesIndex subscribes to params$, loadding$, renderList$.
// The list request is geeks.json; each response geekCard carries an ID and query-specific lid.
export const SEARCH_STATE_SCRIPT = `(() => {
 const roots=[...document.querySelectorAll('.search-container')].map(e=>e.__vue__).filter(v=>v?.$options?.name==='SearchCandidatesIndex');
 if(roots.length!==1)throw Error('搜索列表组件缺失或不唯一');
 const v=roots[0];
 if(typeof v.loadding$!=='boolean'||!Array.isArray(v.renderList$)||!v.params$)throw Error('搜索完成状态字段不符');
 const key=g=>({id:g?.encryptGeekId||'',lid:g?.lid||''});
 return {loading:v.loadding$,initializing:v.isInitPage$,keyword:document.querySelector('.search-input')?.value,
  params:{keywords:v.params$.keywords,jobId:v.params$.jobId||'',page:Number(v.params$.page)},
  rendered:v.renderList$.filter(x=>x.geekCard).map(x=>key(x.geekCard)),
  cards:[...document.querySelectorAll('.geek-info-card')].map(e=>key(e.__vue__?.$props?.geek?.geekCard))};
})()`;

const endpoint='/wapi/zpitem/web/boss/search/geeks.json';
export type SearchQueryEvidence={keyword:string;jobId:string;cards:{id:string;lid:string}[]};

export function responseCards(payload:any):SearchQueryEvidence['cards'] {
 if(payload?.code!==0)throw Error(`搜索接口失败：code=${payload?.code}；message=${payload?.message||''}`);
 if(!Array.isArray(payload.zpData?.geeks))throw Error('搜索响应缺少geeks数组，不能当成零结果');
 const cards=payload.zpData.geeks.map((x:any)=>({id:x.geekCard?.encryptGeekId,lid:x.geekCard?.lid}));
 if(cards.some((x:any)=>typeof x.id!=='string'||!x.id||typeof x.lid!=='string'||!x.lid))throw Error('搜索响应候选人ID或查询标识缺失');
 if(new Set(cards.map((x:any)=>x.id)).size!==cards.length)throw Error('搜索响应候选人ID重复');
 return cards;
}

export function searchMatchesEvidenceScript(e:SearchQueryEvidence):string {
 return `(() => {
  const s=${SEARCH_STATE_SCRIPT}, expected=${JSON.stringify(e.cards)};
  return !s.loading && s.initializing===false && s.keyword===${JSON.stringify(e.keyword)} && s.params.keywords===${JSON.stringify(e.keyword)} &&
   s.params.jobId===${JSON.stringify(e.jobId)} && s.params.page===1 &&
   JSON.stringify(s.rendered)===JSON.stringify(expected) && JSON.stringify(s.cards)===JSON.stringify(expected);
 })()`;
}

/** Passive response observation only; the browser UI issues the single query. */
export async function submitSearchQuery(frame:Frame,keyword:string,submit:()=>Promise<void>,timeout=20_000):Promise<SearchQueryEvidence> {
 const initial=await frame.evaluate(SEARCH_STATE_SCRIPT) as any;
 if(initial.loading||initial.initializing!==false)throw Error('搜索列表仍在加载，不能提交新查询');
 const page=frame.page(),pending=new Set<HTTPRequest>();
 let requestCount=0, settled=false;
 let resolve!:(value:{data?:any;error?:Error})=>void;
 const response=new Promise<{data?:any;error?:Error}>(r=>{resolve=r;});
 const finish=(value:{data?:any;error?:Error})=>{if(!settled){settled=true;resolve(value);}};
 const request=(req:HTTPRequest)=>{
  const u=new URL(req.url());
  if(req.frame()!==frame||u.pathname!==endpoint)return;
  if(u.searchParams.get('keywords')!==keyword||(u.searchParams.get('jobId')||'')!==initial.params.jobId||u.searchParams.get('page')!=='1')return;
  requestCount++;pending.add(req);
  if(requestCount>1)finish({error:new Error('同次搜索出现多个匹配请求，停止，不能确认结果归属')});
 };
 const received=async(res:HTTPResponse)=>{
  if(!pending.has(res.request()))return;
  try {if(!res.ok())throw Error('搜索请求HTTP失败：'+res.status());finish({data:await res.json()});}
  catch(error){finish({error:error instanceof Error?error:new Error(String(error))});}
 };
 const failed=(req:HTTPRequest)=>{if(pending.has(req))finish({error:new Error('搜索请求失败：'+req.failure()?.errorText)});};
 page.on('request',request);page.on('response',received);page.on('requestfailed',failed);
 const timer=setTimeout(()=>finish({error:new Error(`搜索响应等待超时：keyword=${keyword}；jobId=${initial.params.jobId}；matchedRequests=${requestCount}；timeoutMs=${timeout}`)}),timeout);
 try {
  await submit();
  const outcome=await response;if(outcome.error)throw outcome.error;
  const evidence={keyword,jobId:initial.params.jobId,cards:responseCards(outcome.data)};
  try {
   await frame.waitForFunction(searchMatchesEvidenceScript(evidence),{timeout,polling:100});
  } catch(error) {
   throw new Error(`搜索响应已成功，但页面结果未同步：keyword=${keyword}；jobId=${evidence.jobId}；expectedCards=${evidence.cards.length}；timeoutMs=${timeout}；${error instanceof Error?error.message:String(error)}`);
  }
  if(requestCount!==1)throw Error('搜索请求数量已变化，停止');
  return evidence;
 } finally {clearTimeout(timer);page.off('request',request);page.off('response',received);page.off('requestfailed',failed);}
}
