import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { validateAttachmentProbe, type AttachmentProbe } from '../toolset/attachment.js';

export type Decision = 'PENDING' | 'PASS' | 'FAIL';
export type Status = 'PENDING' | 'WAITING_ATTACHMENT' | 'DOWNLOADED' | 'RECHECK';
export type Entry = {
  dataId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  attachment: { probe: AttachmentProbe | null; lastError: string | null };
  status: Status;
  decision: Decision;
};
type Header = { version: 1; job: string; reading?: true; reconciliationRequired?: true };
type Document = { header: Header; candidates: Entry[] };

function atomicWrite(file: string, value: Document): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = openSync(temporary, 'wx');
  try {
    writeFileSync(handle, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fsyncSync(handle);
  } finally { closeSync(handle); }
  // A failed rename leaves the previous valid ledger and the temporary file for inspection.
  renameSync(temporary, file);
}

function validate(doc: Document, job: string): void {
  if (!doc || doc.header?.version !== 1 || doc.header.job !== job || !Array.isArray(doc.candidates) ||
      (doc.header.reading !== undefined && doc.header.reading !== true) ||
      (doc.header.reconciliationRequired !== undefined && doc.header.reconciliationRequired !== true)) {
    throw new Error(`账本格式或岗位不匹配：${job}`);
  }
  const ids = new Set<string>();
  for (const row of doc.candidates) {
    if (!row || Object.keys(row).sort().join(',') !== 'attachment,createdAt,dataId,decision,name,status,updatedAt' ||
        typeof row.dataId !== 'string' || !row.dataId.trim() || typeof row.name !== 'string' || !row.name.trim() || ids.has(row.dataId) ||
        typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) ||
        typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt)) ||
        !['PENDING', 'PASS', 'FAIL'].includes(row.decision) ||
        !['PENDING', 'WAITING_ATTACHMENT', 'DOWNLOADED', 'RECHECK'].includes(row.status) ||
        !row.attachment || !('probe' in row.attachment) ||
        (row.attachment.lastError !== null && typeof row.attachment.lastError !== 'string')) {
      throw new Error(`账本候选人记录无效或重复：job=${job} dataId=${row?.dataId}`);
    }
    if (row.attachment.probe !== null) validateAttachmentProbe(row.attachment.probe);
    ids.add(row.dataId);
  }
}

/** One owner per job. Publish each mutation to disk before exposing it in memory. */
export class Ledger {
  private rows = new Map<string, Entry>();
  private closed = false;
  recoveryRequired: boolean;
  private constructor(readonly file: string, readonly job: string, private lockFile: string, doc: Document, recovery: boolean) {
    this.recoveryRequired = recovery;
    for (const row of doc.candidates) {
      if (row.decision === 'FAIL') continue;
      if (recovery) row.status = 'RECHECK';
      this.rows.set(row.dataId, row);
    }
  }

  static async load(directory: string, job: string): Promise<Ledger> {
    if (!job.trim()) throw new Error('账本必须指定岗位。');
    await mkdir(directory, { recursive: true });
    const file = path.join(path.resolve(directory), createHash('sha256').update(job).digest('hex') + '.json');
    const lockFile = file + '.lock';
    // Serialize both stale-lock removal and acquisition so two starters cannot remove each other's lock.
    const openingFile = file + '.opening';
    let opening;
    try { opening = await open(openingFile, 'wx'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new Error(`岗位账本正在打开，或上次在获取锁期间中断：${openingFile}；若确认其进程已退出，删除此文件后重新打开。`);
    }
    try {
      await opening.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
      // Stale-owner recovery is explicit: a live or unidentifiable owner is never displaced.
      try {
        const owner = JSON.parse(await readFile(lockFile, 'utf8')) as { pid: number; host: string };
        if (!Number.isInteger(owner.pid) || owner.pid <= 0 || owner.host !== hostname()) throw new Error(`账本锁无效或属于其他主机：${lockFile}`);
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          alive = false;
        }
        if (alive) throw new Error(`岗位账本正在使用：job=${job} pid=${owner.pid}`);
        await rm(lockFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const lock = await open(lockFile, 'wx');
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
        await lock.sync();
      } finally { await lock.close(); }
    } finally {
      await opening.close();
      await rm(openingFile);
    }
    try {
      let doc: Document;
      try { doc = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        doc = { header: { version: 1, job }, candidates: [] };
      }
      validate(doc, job);
      const recovery = doc.header.reading === true || doc.header.reconciliationRequired === true;
      const ledger = new Ledger(file, job, lockFile, doc, recovery);
      ledger.save(ledger.rows);
      return ledger;
    } catch (error) {
      await rm(lockFile);
      throw new Error(`加载岗位账本失败：job=${job} file=${file}；${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  entries(): Entry[] { return structuredClone([...this.rows.values()]); }

  private save(rows: Map<string, Entry>, recovery = this.recoveryRequired): void {
    const header: Header = { version: 1, job: this.job };
    if (recovery) header.reconciliationRequired = true;
    atomicWrite(this.file, {header, candidates: [...rows.values()]});
  }

  private put(row: Entry): void {
    const next = new Map(this.rows).set(row.dataId, row);
    this.save(next);
    this.rows = next;
  }

  private requireOpen(): void { if (this.closed) throw new Error('账本会话已停止。'); }

  get(dataId: string): Entry {
    this.requireOpen();
    const row = this.rows.get(dataId);
    if (!row) throw new Error(`账本没有候选人：job=${this.job} dataId=${dataId}`);
    return structuredClone(row);
  }

  add(target: { dataId: string; name: string }): void {
    this.requireOpen();
    if (typeof target.dataId !== 'string' || !target.dataId.trim() || typeof target.name !== 'string' || !target.name.trim()) throw new Error('候选人必须有姓名和 data-id。');
    const old = this.rows.get(target.dataId);
    if (old) {
      if (old.name !== target.name) throw new Error(`账本姓名不匹配：${target.dataId} ${old.name} / ${target.name}`);
      return;
    }
    const now = new Date().toISOString();
    this.put({ dataId: target.dataId, name: target.name, createdAt: now, updatedAt: now,
      attachment: { probe: null, lastError: null }, status: this.recoveryRequired ? 'RECHECK' : 'PENDING', decision: 'PENDING' });
  }

  decide(dataId: string, decision: 'PASS' | 'FAIL'): void {
    const row = this.get(dataId);
    if (this.recoveryRequired) throw new Error('有信息需要恢复。');
    if (decision === 'FAIL') {
      const next = new Map(this.rows);
      next.delete(dataId);
      this.save(next);
      this.rows = next;
      return;
    }
    if (row.status === 'RECHECK') throw new Error(`候选人必须先复查/对账：${dataId}`);
    if (decision !== 'PASS') throw new Error('筛选结果只接受 PASS 或 FAIL。');
    row.decision = decision;
    row.updatedAt = new Date().toISOString();
    row.status = row.attachment.probe?.download ? 'DOWNLOADED' : 'WAITING_ATTACHMENT';
    this.put(row);
  }

  recordProbe(dataId: string, probe: AttachmentProbe): void {
    const row = this.get(dataId);
    validateAttachmentProbe(probe);
    if (probe.dataId !== dataId || probe.name !== row.name) throw new Error(`探测结果身份不匹配：${dataId}`);
    // A read-only recheck must not discard a previously completed download or send evidence.
    const previous = row.attachment.probe;
    if (!probe.download && previous?.download &&
        (probe.attachment === 'NOT_OBSERVED' || probe.attachmentName === previous.attachmentName)) {
      probe = { ...probe, attachment: previous.attachment, attachmentName: previous.attachmentName, download: previous.download };
    }
    if (probe.request !== 'SENT' && previous?.request === 'SENT') probe = { ...probe, request: 'SENT', requestEvidence: previous.requestEvidence };
    row.attachment = { probe, lastError: null };
    row.status = probe.download ? 'DOWNLOADED' : row.decision === 'PASS' ? 'WAITING_ATTACHMENT' : 'PENDING';
    row.updatedAt = new Date().toISOString();
    this.put(row);
  }

  recordFailure(dataId: string, error: Error): void {
    const row = this.get(dataId);
    row.status = 'RECHECK';
    row.attachment.lastError = `${error.name}: ${error.message}`;
    row.updatedAt = new Date().toISOString();
    this.put(row);
  }

  beginReconciliation(): void {
    this.requireOpen();
    this.save(this.rows, true);
    this.recoveryRequired = true;
  }

  completeReconciliation(): void {
    this.requireOpen();
    if (this.entries().some(row => row.status === 'RECHECK')) throw new Error('仍有未完成逐项对账的记录，不能解除恢复状态。');
    this.save(this.rows, false);
    this.recoveryRequired = false;
  }

  async stop(): Promise<void> {
    this.requireOpen();
    this.closed = true;
    await rm(this.lockFile);
  }

  /** EOF releases the lock without discarding previously saved candidate updates. */
  async abandon(): Promise<void> {
    if (!this.closed) { this.closed = true; await rm(this.lockFile); }
  }
}
