/** Optional CLI evidence on stderr; never include candidate details or affect stdout. */
export function traceResumeCapture(event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.BOSS_CLI_TRACE !== 'true' && process.env.BOSS_CLI_TRACE !== '1') return;
  console.error(`[boss-cli][resume] ${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}`);
}
