// 显式本地验收模式：即使宿主误调普通CLI或派生worker，也不能联网。
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
let installed = false;
export function installOfflineTestGuard(): void {
  if (process.env.BOSS_OFFLINE_TEST !== '1' || installed) return;
  const deny = (): never => { throw new Error('OFFLINE_NETWORK_FORBIDDEN'); };
  net.Socket.prototype.connect = deny;
  net.connect = deny; net.createConnection = deny; tls.connect = deny;
  globalThis.fetch = deny; syncBuiltinESMExports(); installed = true;
}
