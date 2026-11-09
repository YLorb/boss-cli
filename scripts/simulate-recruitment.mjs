import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const worker=fileURLToPath(new URL('./simulation/driver.mjs',import.meta.url));
const result=spawnSync(process.execPath,['--experimental-test-module-mocks',worker,...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status??1;
