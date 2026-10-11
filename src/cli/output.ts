/** --json is a boolean output flag; tokens after -- remain literal arguments. */
export function splitJsonFlag(argv: string[]): { args: string[]; json: boolean } {
  const args: string[] = [];
  let json = false;
  let literal = false;
  for (const token of argv) {
    if (token === '--') literal = true;
    if (!literal && token === '--json') json = true;
    else args.push(token);
  }
  return { args, json };
}

export function jsonError(command: string, error: unknown): string {
  return JSON.stringify({ ok: false, command, error: {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  } });
}
