import { executeCommand } from './cliRouter.js';
import { detachBrowserSession } from '../browser/index.js';

// If the owner dies, this worker must not continue issuing browser actions.
process.on('disconnect', () => process.exit(1));
let result: { text?: string; error?: { name: string; message: string } };
try {
  const text = await executeCommand(process.argv.slice(2));
  await detachBrowserSession();
  result = { text };
} catch (error) {
  result = { error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } };
}
if (!process.send) throw new Error('附件命令 worker 必须由 CLI 父进程启动。');
process.send(result, (error) => process.exit(error || result.error ? 1 : 0));
