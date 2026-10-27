export type ChatSearchFailureDetails = {
  stage: string;
  timeoutMs: number;
  name: string;
  expectedDataId?: string;
  originalFilterJob?: string;
  clickState: 'not-attempted' | 'attempted' | 'returned';
  locationVerified: boolean;
  verifiedConversation?: { name: string; dataId: string; job: string };
  diagnostics: unknown;
};

/** Preserve verified identity separately from a later page-state failure. */
export class ChatSearchFailure extends Error {
  constructor(readonly details: ChatSearchFailureDetails, cause: unknown) {
    const phase = details.locationVerified ? '候选人身份曾核验通过，但定位结束状态核验失败' : '候选人定位未确认';
    super(`${phase}；stage=${details.stage}；name=${details.name}；timeoutMs=${details.timeoutMs}；${String(cause)}；diagnostics=${JSON.stringify(details)}`, { cause });
    this.name = details.locationVerified ? 'ChatStateError' : 'ChatLocateError';
  }
}
