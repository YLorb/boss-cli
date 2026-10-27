/** Current communication-page virtual list; do not use the embedded-chat list container. */
export const INVENTORY_LIST_SELECTOR = '.chat-user .user-container > .user-list';

/** Read only. Component state distinguishes loading, an empty result and a complete list. */
export const INVENTORY_STATE_SCRIPT = `(() => {
 const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const roots=[...document.querySelectorAll('.chat-user')].filter(visible);
 const lists=[...document.querySelectorAll(${JSON.stringify(INVENTORY_LIST_SELECTOR)})].filter(visible);
 const root=roots[0],vm=root?.__vue__;
 const context={roots:roots.length,lists:lists.length,rows:root?.querySelectorAll('.geek-item').length||0,loading:vm?.loading$,hasMore:vm?.hasMore$};
 const fail=message=>{throw Error(message+'；context='+JSON.stringify(context))};
 if(roots.length!==1)fail('全量盘点会话列表根节点不唯一');
 if(![0,1,2].includes(vm?.loading$)||typeof vm?.hasMore$!=='boolean'||!Array.isArray(vm?.list$)||!Array.isArray(vm?.topList$))fail('全量盘点列表加载状态缺失或格式不符');
 if(vm.loading$!==0)return {loading:true,empty:false};
 const sources=[...vm.list$,...vm.topList$];
 if(!sources.length){
  const empty=[...root.querySelectorAll('.common-no-data')].filter(visible);
  if(vm.hasMore$||lists.length||context.rows||empty.length!==1||empty[0].textContent.trim()!=='暂无牛人')fail('全量盘点零结果未确认');
  return {loading:false,empty:true};
 }
 if(lists.length!==1)fail('完整列表容器缺失或不唯一，不能确认全量候选人');
 const list=lists[0],rect=list.getBoundingClientRect();
 const footer=[...list.querySelectorAll('.load-tips')];
 if(footer.length!==1)fail('完整列表缺少唯一 load-tips 结束标志');
 const tip=footer[0],f=tip.getBoundingClientRect();
 const end=!vm.hasMore$&&!tip.classList.contains('active')&&visible(tip)&&tip.textContent.trim().length>0&&
  list.scrollTop+list.clientHeight>=list.scrollHeight-2&&f.top>=rect.top-2&&f.bottom<=rect.bottom+2;
 const ids=sources.map(x=>x.uniqueId);
 if(ids.some(x=>typeof x!=='string'||!x))fail('全量盘点组件会话ID缺失');
 return {loading:false,empty:false,end,top:list.scrollTop<=2,expectedIds:[...new Set(ids)],x:rect.left+rect.width/2,y:rect.top+rect.height/2};
})()`;
