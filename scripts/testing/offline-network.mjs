// 必须在加载浏览器/HTTP模块前预加载；Node worker通过NODE_OPTIONS继承。
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';
const deny=()=>{throw new Error('OFFLINE_NETWORK_FORBIDDEN');};
net.Socket.prototype.connect=deny;
net.connect=deny;
net.createConnection=deny;
tls.connect=deny;
globalThis.fetch=deny;
syncBuiltinESMExports();
