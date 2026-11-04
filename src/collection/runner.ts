import { AttachmentTimeoutError, runCommandProcess } from '../cli/command_process.js';
import type { AttachmentProbe } from '../toolset/attachment.js';
import { Ledger } from './ledger.js';

export type Candidate = { dataId: string; name: string; job: string };
type CommandRunner = (argv: string[]) => Promise<string>;

export class CollectionRunner {
  stopRequested = false;
  private active = false;
  private consecutiveTimeouts = 0;
  constructor(readonly ledger: Ledger, private run: CommandRunner = runCommandProcess) {}

  async round(mode: 'round' | 'recheck' | 'reconcile', inventory?: Candidate[]): Promise<unknown[]> {
    if (this.active) throw new Error('上一轮仍在执行。');
    if (this.stopRequested) throw new Error('会话正在停止。');
    if (this.consecutiveTimeouts >= 3) throw new Error('连续三位候选人处理失败，本轮已暂停。');
    if (this.ledger.recoveryRequired && mode !== 'reconcile') throw new Error('有信息需要恢复。');
    if (mode === 'reconcile') {
      if (!inventory) throw new Error('全量对账缺少完整候选人列表。');
      // The inventory includes candidates added in the lost in-memory session.
      for (const target of inventory) if (target.job === this.ledger.job) this.ledger.add({ dataId: target.dataId, name: target.name });
    }
    const selected = this.ledger.entries().filter(row => mode === 'reconcile' ||
      (mode === 'recheck' ? row.status === 'RECHECK' : row.status !== 'RECHECK' && row.status !== 'DOWNLOADED'));
    const results: unknown[] = [];
    this.active = true;
    try {
      for (const row of selected) {
        if (this.stopRequested) break;
        const argv = ['probe-resume', row.name, '--data-id', row.dataId, '--json'];
        // Recheck/reconcile are evidence-only. A subsequent explicit round resumes downloads.
        if (mode === 'round' && row.decision === 'PASS') argv.push('--download');
        // Persist the candidate before launching the worker: an interrupted action is evidence-only on recovery.
        this.ledger.recordFailure(row.dataId, new Error('附件操作已开始，结果尚未确认'));
        let probe: AttachmentProbe;
        try {
          probe = JSON.parse(await this.run(argv)) as AttachmentProbe;
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          this.ledger.recordFailure(row.dataId, failure);
          if (!(failure instanceof AttachmentTimeoutError)) throw failure;
          if (++this.consecutiveTimeouts >= 3) throw new Error(`连续三位候选人处理超时，本轮已暂停：${row.dataId}；${failure.message}`);
          results.push({ dataId: row.dataId, status: 'RECHECK', error: failure.message });
          // No retry, screening, sending, or upload for this candidate in this round.
          continue;
        }
        this.ledger.recordProbe(row.dataId, probe);
        this.consecutiveTimeouts = 0;
        results.push({ dataId: row.dataId, status: this.ledger.get(row.dataId).status, probe });
      }
      if (mode === 'reconcile' && !this.stopRequested) this.ledger.completeReconciliation();
      return results;
    } finally { this.active = false; }
  }
}
