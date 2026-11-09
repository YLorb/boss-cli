import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import net from 'node:net';
import './testing/offline-network.mjs';
test('offline harness denies socket before any connection',()=>{
 assert.throws(()=>net.createConnection({host:'127.0.0.1',port:9222}),/OFFLINE_NETWORK_FORBIDDEN/);
 assert.throws(()=>new net.Socket().connect(9222,'127.0.0.1'),/OFFLINE_NETWORK_FORBIDDEN/);
});
test('Node workers inherit offline guard',()=>{
 const guard=pathToFileURL(resolve('scripts/testing/offline-network.mjs')).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',"import net from 'node:net';net.connect(9222,'127.0.0.1');"],{encoding:'utf8',windowsHide:true,env:{...process.env,NODE_OPTIONS:'--import '+guard}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/OFFLINE_NETWORK_FORBIDDEN/);
});
