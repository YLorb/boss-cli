/** Search-row metadata, not a company classification or an identity selection rule. */
export type ChatSearchMatch = {
  name: string;
  uniqueId: string;
  label: string | null;
  info: string | null;
  tag: string | null;
};

// BOSS getContent uses workDesc for the name suffix; content-exchange uses
// exchangeDesc. Keep these component strings intact, never split the rendered
// label or infer a company/school. Shared by search, status and diagnostics.
export const CHAT_SEARCH_MATCH_SCRIPT = `((candidate, row) => {
  const optionalText = (value, field) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error('沟通搜索字段类型异常：' + field + '；uniqueId=' + candidate.uniqueId);
    return value;
  };
  return {
    name: candidate.name,
    uniqueId: candidate.uniqueId,
    label: row?.querySelector('.content-text')?.textContent?.trim() ?? null,
    info: optionalText(candidate.workDesc, 'workDesc'),
    tag: optionalText(candidate.exchangeDesc, 'exchangeDesc')
  };
})`;
