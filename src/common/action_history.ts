// 跨轮联系/消息回执。固定岗位目录保存，结果未知不能靠新 run 清除。
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getBoundRun } from '../cli/run_state.js';
type Entry = { attemptId: string; runId: string; cmd: string; id: string; text: string; outcome: 'intent' | 'success' | 'unknown' | 'not-attempted'; at: string };
function file(): string { const run = getBoundRun(); if (!run) throw new Error('持久动作记录需要运行绑定'); return join(run.ledgerDir, createHash('sha256').update(run.job).digest('hex') + '.actions.json'); }
async function entries(): Promise<Entry[]> {
  let value: any;
  try { value = JSON.parse(await readFile(file(), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error(`岗位动作记录损坏：${file()}；${String(error)}`); }
  if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.some((e: any) => !e || ['attemptId','runId','cmd','id','at'].some(k=>typeof e[k]!=='string'||!e[k]) || typeof e.text!=='string' || !Number.isFinite(Date.parse(e.at)) || !['intent', 'success', 'unknown', 'not-attempted'].includes(e.outcome))) throw new Error(`岗位动作记录结构无效：${file()}`);
  return value.entries;
}
async function append(entry: Entry): Promise<void> {
  const rows = await entries(); rows.push(entry); const run = getBoundRun()!; await mkdir(run.ledgerDir, { recursive: true });
  const target = file(), tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, entries: rows }, null, 2) + '\n', { flag: 'wx' });
  try { await rename(tmp, target); } finally { await unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function assertActionHistory(cmd: string, id: string, text: string): Promise<void> {
  const rows = await entries(), last = new Map<string, Entry>(); for (const e of rows) last.set(e.attemptId, e);
  for (const e of last.values()) {
    if (e.id !== id) continue;
    if (e.outcome === 'intent' || e.outcome === 'unknown') throw new Error(`历史动作结果未决：${e.cmd}/${id}，需明确核验，禁止重放`);
    if (e.outcome === 'success' && e.cmd === cmd && ['greet', 'send'].includes(cmd) && (cmd === 'greet' || e.text === text)) throw new Error(`历史 ${cmd} 已成功，禁止重复：${id}`);
  }
}
export async function beginAction(cmd: string, id: string, text: string): Promise<string> {
  await assertActionHistory(cmd, id, text); const attemptId = randomUUID();
  await append({ attemptId, runId: getBoundRun()!.runId, cmd, id, text, outcome: 'intent', at: new Date().toISOString() }); return attemptId;
}
export async function finishAction(attemptId: string, outcome: 'success' | 'unknown' | 'not-attempted'): Promise<void> {
  const rows = await entries(), entry = [...rows].reverse().find(e => e.attemptId === attemptId);
  if (!entry) throw new Error(`动作意图不存在：${attemptId}`);
  await append({ ...entry, outcome, at: new Date().toISOString() });
}
