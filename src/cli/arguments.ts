export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
export function parseOpts(argv: string[], booleanFlags: ReadonlySet<string> = new Set()): {
  rest: string[];
  flags: Set<string>;
  opts: Record<string, string>;
} {
  const rest: string[] = [];
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const k = a.slice(2, eq);
        if (booleanFlags.has(k)) throw new CliError(`❌ --${k} 是布尔开关，不接受值。`);
        opts[k] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      if (booleanFlags.has(key)) {
        flags.add(key);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        opts[key] = next;
        i += 1;
      } else {
        flags.add(key);
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
      const short = a.slice(1);
      const next = argv[i + 1];
      if (short === 't' && next !== undefined && !next.startsWith('-')) {
        opts.t = next;
        i += 1;
        continue;
      }
      if (!/^\d/.test(short)) {
        flags.add(short);
        continue;
      }
    }
    rest.push(a);
  }
  return { rest, flags, opts };
}


import { splitJsonFlag } from './output.js';
const BOOLEAN_FLAGS: Record<string, ReadonlySet<string>> = {
 send:new Set(['check','embedded']), preview:new Set(['open-only','reopen-on-frame-error']),
 greet:new Set(['check','confirm-contact','continue-chat']), 'probe-resume':new Set(['download']),
 'accept-resume':new Set(['check']), 'download-resume':new Set(['check']), check:new Set(['embedded'])
};
export function parseCommandArguments(argv:string[]) {
 const {args,json}=splitJsonFlag(argv.slice(1));
 return {...parseOpts(args,BOOLEAN_FLAGS[argv[0]]),json};
}
