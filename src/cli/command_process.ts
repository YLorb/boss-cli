import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ATTACHMENT_TIMEOUT_MS = 15_000;

export class AttachmentTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`附件命令 ${command} 超过 ${timeoutMs}ms，子进程已退出；附件状态未知，必须 RECHECK，不能按无附件继续处理。`);
    this.name = 'AttachmentTimeoutError';
  }
}

type WorkerResult = { text?: string; error?: { name: string; message: string } };

/** Resolve only after close: a reported result alone does not prove the worker exited. */
export function runCommandProcess(
  argv: string[],
  timeoutMs = ATTACHMENT_TIMEOUT_MS,
  worker = new URL('./command_worker.js', import.meta.url),
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(worker), ...argv], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    let result: WorkerResult | undefined;
    let failure: Error | undefined;
    let timedOut = false;
    child.stderr?.on('data', (data) => process.stderr.write(data));
    child.on('message', (message) => { result = message as WorkerResult; });
    child.on('error', (error) => { failure = error; });
    const timer = setTimeout(() => {
      timedOut = true;
      // Do not resolve here. Killing Node does not undo actions already issued to Chrome.
      if (!child.kill('SIGKILL')) failure = new Error(`无法终止附件命令子进程 pid=${child.pid}；禁止继续页面操作。`);
    }, timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (timedOut) return reject(new AttachmentTimeoutError(argv.join(' '), timeoutMs));
      if (result?.error) {
        const error = new Error(result.error.message);
        error.name = result.error.name;
        return reject(error);
      }
      if (code !== 0 || typeof result?.text !== 'string') {
        return reject(new Error(`命令子进程异常退出：command=${argv[0]} pid=${child.pid} code=${code} signal=${signal}`));
      }
      resolve(result.text);
    });
  });
}

export function isAttachmentCommand(argv: string[]): boolean {
  return ['probe-resume', 'accept-resume', 'download-resume'].includes(argv[0] ?? '');
}
