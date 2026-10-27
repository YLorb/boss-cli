/** Compare job title + city; salary is presentation data, not job identity. */
export function recommendJobKey(value: string): string {
  return value
    .replace(/\s+\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[kK](?:\s*[·•]\s*\d+薪)?\s*$/, '')
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
