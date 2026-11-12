/** Compare job title + city; salary is presentation data, not job identity. */
export function recommendJobKey(value: string): string {
  return value
    .replace(/\s+\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[kK](?:\s*[·•]\s*\d+薪)?\s*$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Local patch 0.6.20-dev-7 — not present upstream (ylorb/dev@25b5968).
 * Job identity is the title alone: city and salary are presentation data (operator rule, 2026-11-11:
 * "never carry a city tag, match on job title only; when several candidates match, hand over to a human").
 * Written as one self-contained function so `jobTitleKey.toString()` can be injected into page scripts.
 */
export function jobTitleKey(value: string): string {
  return value
    .replace(/\s+\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[kK](?:\s*[·•]\s*\d+薪)?\s*$/, '')
    .replace(/\s*_[^_]+$/, '')
    .replace(/\s*【[^】]+】\s*$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** The dropdown search matches job titles, so city and salary stay in the final comparison only. */
export function recommendJobQuery(value: string): string {
  return value
    .replace(/\s+\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[kK](?:\s*[·•]\s*\d+薪)?\s*$/, '')
    .replace(/\s*_[^_]+$/, '')
    .replace(/\s*【[^】]+】$/, '')
    .trim();
}
