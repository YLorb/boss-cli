import type { Frame, Page } from 'puppeteer-core';
import { readSearchCandidateId } from './search-greet.js';

/** Selecting and explicitly confirming are separate actions; neither is retried. */
export async function selectSearchContactJob(page: Page, search: Frame, name: string, job: string, check: boolean, confirm = false, expectedCandidateId?: string) {
  const candidateId = await readSearchCandidateId(search, name, expectedCandidateId);
  const script = (click: boolean) => `(() => {
    const norm=v=>(v||'').replace(/\\s+/g,' ').trim();
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity)>0;};
    const boxes=Array.from(document.querySelectorAll('.resume-middle-wrap .resume-right-side .resume-simple-box')).filter(visible);
    if(boxes.length!==1) throw new Error('候选人简历操作区不唯一');
    const props=boxes[0].__vue__?.$props;
    if(props?.geekInfo?.encryptGeekId!==${JSON.stringify(candidateId)} ||
       props?.resumeInfo?.encryptGeekId!==${JSON.stringify(candidateId)})
      throw new Error('选岗前候选人 ID 不符');
    const dialogs=Array.from(document.querySelectorAll('.common-job-list-dialog')).filter(visible);
    if(dialogs.length!==1) throw new Error('需要唯一已打开的联系岗位选择弹层');
    const dialog=dialogs[0];
    const rows=Array.from(dialog.querySelectorAll('.select-list > li'));
    const matches=rows.filter(el=>norm(el.querySelector('h3')?.textContent)===${JSON.stringify(job)});
    if(matches.length!==1) throw new Error('联系岗位完整名称须唯一匹配：'+${JSON.stringify(job)}+'；matches='+matches.length);
    const row=matches[0];
    if(!visible(row) || row.matches('[disabled],[aria-disabled="true"]') || getComputedStyle(row).pointerEvents==='none')
      throw new Error('联系岗位不可用');
    const selected=rows.filter(el=>el.classList.contains('active'));
    if(selected.length>1) throw new Error('多个联系岗位同时选中');
    const alreadySelected=selected[0]===row;
    if(${confirm}) {
      if(!alreadySelected) throw new Error('确认沟通要求目标岗位已选中，不自动改选');
      const buttons=Array.from(dialog.querySelectorAll('.footer button')).filter(el=>visible(el) && norm(el.textContent)==='立即沟通');
      if(buttons.length!==1) throw new Error('弹层确认按钮不唯一');
      const button=buttons[0];
      if(button.matches(':disabled,[disabled],[aria-disabled="true"]') || getComputedStyle(button).pointerEvents==='none')
        throw new Error('弹层确认按钮不可用');
      const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      if(!hit || !button.contains(hit)) throw new Error('弹层确认按钮被遮挡');
      if(${click}) button.click();
      return {job:${JSON.stringify(job)},selected:true,clicked:${click}};
    }
    if(${click} && !alreadySelected) {
      row.scrollIntoView({block:'nearest'});
      const r=row.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      if(!hit || !row.contains(hit)) throw new Error('联系岗位被遮挡，停止点击');
      row.click();
    }
    return {job:${JSON.stringify(job)},selected:alreadySelected,clicked:${click} && !alreadySelected};
  })()`;
  const state = await page.evaluate(script(!check)) as {job:string;selected:boolean;clicked:boolean};
  if (confirm) {
    if (check) return {source:'search-contact-job',name,candidateId,job,status:'confirmation-ready',
      selected:true,clicked:false,contactConfirmed:false};
    try {
      await page.waitForFunction(`(() => {
        const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';};
        if(Array.from(document.querySelectorAll('.common-job-list-dialog')).some(visible)) return false;
        const boxes=Array.from(document.querySelectorAll('.resume-middle-wrap .resume-right-side .resume-simple-box')).filter(visible);
        if(boxes.length!==1) return false;
        const props=boxes[0].__vue__?.$props;
        if(props?.geekInfo?.encryptGeekId!==${JSON.stringify(candidateId)} || props?.resumeInfo?.encryptGeekId!==${JSON.stringify(candidateId)}) return false;
        const buttons=Array.from(boxes[0].querySelectorAll('button')).filter(el=>visible(el) && el.textContent.trim()==='继续沟通');
        return buttons.length===1;
      })()`, {timeout:5000,polling:100});
      return {source:'search-contact-job',name,candidateId,job,status:'contact-confirmed',
        selected:true,clicked:true,contactConfirmed:true};
    } catch (error) {
      throw new Error(`已点击一次弹层「立即沟通」，未确认成功，禁止自动重试；${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!check && state.clicked) {
    await page.waitForFunction(`(() => {
      const dialogs=Array.from(document.querySelectorAll('.common-job-list-dialog')).filter(el=>el.getBoundingClientRect().width>0);
      if(dialogs.length!==1) return false;
      const selected=dialogs[0].querySelectorAll('.select-list > li.active');
      return selected.length===1 && selected[0].querySelector('h3')?.textContent.trim()===${JSON.stringify(job)};
    })()`, {timeout:3000,polling:100});
  }
  const verified = await page.evaluate(script(false)) as {selected:boolean};
  if (!check && !verified.selected) throw new Error('联系岗位选中状态未确认，禁止自动重试');
  return {source:'search-contact-job',name,candidateId,job,status:check?'job-check':'job-selected',
    selected:verified.selected,clicked:state.clicked,contactConfirmed:false};
}
