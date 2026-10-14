import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { Ledger } from './ledger.js';
import { CollectionRunner, type Candidate } from './runner.js';
import { runFullCandidateInventory } from '../toolset/list.js';

/** Newline-delimited JSON commands keep one job's ledger alive between rounds. */
export async function runCollectionSession(directory: string, job: string): Promise<void> {
  const ledger = await Ledger.load(directory, job);
  const runner = new CollectionRunner(ledger);
  const emit = (value: unknown) => stdout.write(JSON.stringify(value) + '\n');
  emit({ ok: true, event: 'started', job, file: ledger.file, recoveryRequired: ledger.recoveryRequired });
  const rl = createInterface({ input: stdin, terminal: false });
  let queue = Promise.resolve();
  let stopped = false;
  let stopQueued = false;

  async function stop(): Promise<void> {
    await ledger.stop();
    stopped = true;
    emit({ ok: true, event: 'stopped', file: ledger.file, recoveryRequired: ledger.recoveryRequired });
    rl.close();
  }

  function enqueue(line: string): void {
    let command: Record<string, unknown>;
    try {
      command = JSON.parse(line);
      if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('命令必须是 JSON 对象。');
    } catch (error) { emit({ ok: false, error: String(error) }); return; }
    if (stopQueued) { emit({ ok: false, error: '已收到 stop，不再接受新命令。' }); return; }
    if (command.op === 'stop') { stopQueued = true; runner.stopRequested = true; }
    queue = queue.then(async () => {
      if (command.op === 'stop') { await stop(); return; }
      if (runner.stopRequested) { emit({ ok: false, op: command.op, error: '已收到 stop，尚未开始的命令已取消。' }); return; }
      switch (command.op) {
        case 'show':
          emit({ ok: true, op: 'show', recoveryRequired: ledger.recoveryRequired, candidates: ledger.entries() });
          break;
        case 'add': {
          if (ledger.recoveryRequired) throw new Error('必须先 reconcile 全量对账。');
          if (command.job !== job) throw new Error(`add 必须明确指定当前岗位 job=${job}`);
          ledger.add({ dataId: command.dataId as string, name: command.name as string });
          emit({ ok: true, op: 'add', dataId: command.dataId });
          break;
        }
        case 'decision':
          if (command.decision !== 'PASS' && command.decision !== 'FAIL') throw new Error('decision 必须为 PASS 或 FAIL。');
          ledger.decide(command.dataId as string, command.decision);
          emit({ ok: true, op: 'decision', dataId: command.dataId, removed: command.decision === 'FAIL' });
          break;
        case 'round':
        case 'recheck':
          emit({ ok: true, op: command.op, results: await runner.round(command.op) });
          break;
        case 'reconcile': {
          const inventory = JSON.parse(await runFullCandidateInventory(() => runner.stopRequested)) as { candidates: Candidate[] };
          if (runner.stopRequested) break;
          emit({ ok: true, op: 'reconcile', results: await runner.round('reconcile', inventory.candidates) });
          break;
        }
        default: throw new Error('未知账本命令；支持 show/add/decision/round/recheck/reconcile/stop。');
      }
    }).catch(error => {
      emit({ ok: false, op: command.op, error: error instanceof Error ? error.message : String(error) });
      if (command.op === 'stop') { process.exitCode = 1; rl.close(); }
    });
  }

  // SIGINT/SIGTERM are explicit stop requests; fatal failures/EOF must leave reading intact.
  const onSignal = () => enqueue('{"op":"stop"}');
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  rl.on('line', enqueue);
  try {
    await new Promise<void>(resolve => rl.once('close', () => {
      if (!stopQueued) runner.stopRequested = true;
      resolve();
    }));
    await queue;
    if (!stopped) {
      runner.stopRequested = true;
      await ledger.abandon();
      throw new Error('输入已关闭但未收到 stop；未写回内存账本，保留 reading，下次必须全量对账。');
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    rl.close();
  }
}
