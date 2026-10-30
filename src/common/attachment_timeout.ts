export const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Total command budget includes locating, previewing, downloading and verification. */
export function attachmentCommandTimeoutMs(argv: string[]): number {
  const delimiter = argv.indexOf('--');
  const options = delimiter < 0 ? argv.slice(1) : argv.slice(1, delimiter);
  return argv[0] === 'download-resume' || (argv[0] === 'probe-resume' && options.includes('--download'))
    ? DOWNLOAD_TIMEOUT_MS : 15_000;
}
