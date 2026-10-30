import type { Frame, Page } from 'puppeteer-core';

// Verified on the live recommendation page, 2026-10-27. The enclosing li is NOT another card.
export const RECOMMEND_CARD_ROOT_SELECTOR = '.candidate-card-wrap';
export const RECOMMEND_CARD_IDENTITY_SCRIPT = `((card) => {
 const norm=v=>(v||'').replace(/\\s+/g,' ').trim();
 const inner=card.querySelector('.card-inner');
 const row=inner?.__vue__?.$props?.geekInfo;
 return {name:norm(card.querySelector('.name-wrap .name')?.textContent),candidateId:inner?.getAttribute('data-geekid')||'',componentId:row?.encryptGeekId||'',componentName:norm(row?.geekName)};
})`;

export function recommendTargetScript(name: string, candidateId?: string): string {
 return `(() => {
  const name=${JSON.stringify(name.trim())}, expected=${JSON.stringify(candidateId)};
  const all=[...document.querySelectorAll(${JSON.stringify(RECOMMEND_CARD_ROOT_SELECTOR)})].map(card=>({card,identity:${RECOMMEND_CARD_IDENTITY_SCRIPT}(card)}));
  const matches=all.filter(x=>x.identity.name===name && (!expected||x.identity.candidateId===expected));
  if(matches.length!==1)throw Error('推荐候选人姓名或ID不唯一，暂停：'+JSON.stringify({name,candidateId:expected,matches:matches.map(x=>x.identity)}));
  const {card,identity}=matches[0];
  if(!identity.candidateId||identity.candidateId!==identity.componentId||identity.componentName!==name)
   throw Error('推荐卡片姓名/ID缺失或与组件不符：'+JSON.stringify(identity));
  if(all.filter(x=>x.identity.candidateId===identity.candidateId).length!==1)throw Error('推荐列表候选人ID重复，暂停：'+identity.candidateId);
  return {card,identity};
 })()`;
}

export async function readRecommendCandidateId(frame: Frame, name: string, candidateId?: string): Promise<string> {
 if(!name.trim()||(candidateId!==undefined&&!candidateId.trim()))throw Error('推荐候选人姓名和提供的ID不能为空');
 return await frame.evaluate(`(() => { const target=${recommendTargetScript(name,candidateId)};return target.identity.candidateId; })()`) as string;
}

function resumeIdentityScript(cardProp: string, detailProp: string): string { return `(() => {
 const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';
 const panels=[...document.querySelectorAll('.resume-middle-wrap')].filter(visible);
 if(panels.length!==1)throw Error('可见简历面板不唯一：'+panels.length);
 const boxes=[...panels[0].querySelectorAll('.resume-right-side .resume-simple-box')].filter(visible);
 if(boxes.length!==1)throw Error('简历身份组件不唯一：'+boxes.length);
 const frames=[...panels[0].querySelectorAll('iframe[src*="c-resume"]')].filter(visible);
 if(frames.length!==1)throw Error('简历面板与iframe关联不唯一');
 const props=boxes[0].__vue__?.$props;
 return {geekId:props?.[${JSON.stringify(cardProp)}]?.encryptGeekId||'',resumeId:props?.[${JSON.stringify(detailProp)}]?.encryptGeekId||''};
})()`; }

export const RESUME_IDENTITY_SCRIPT = resumeIdentityScript('geekInfo','resumeInfo');
export const RECOMMEND_RESUME_IDENTITY_SCRIPT = resumeIdentityScript('dataSource','personInfo');

export async function assertRecommendResumeIdentity(frame: Frame | Page, candidateId: string): Promise<void> {
 const actual=await frame.evaluate(RECOMMEND_RESUME_IDENTITY_SCRIPT) as {geekId:string;resumeId:string};
 if(!candidateId||actual.geekId!==candidateId||actual.resumeId!==candidateId)
  throw Error(`推荐简历ID核验失败：expected=${candidateId}；actual=${JSON.stringify(actual)}`);
}
