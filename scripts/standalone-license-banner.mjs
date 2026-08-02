import { readFileSync } from 'node:fs';

const nobleScureMit = readFileSync(
  new URL('../LICENSES/Noble-Scure-MIT.txt', import.meta.url),
  'utf8',
).trim();
const nobleCiphersMit = readFileSync(
  new URL('../LICENSES/Noble-Ciphers-MIT.txt', import.meta.url),
  'utf8',
).trim();

/** Legal header retained in downloadable standalone agent bundles. */
export function standaloneLicenseBanner(artifactName) {
  return `/*!
${artifactName} — part of 2140.wtf
Copyright remains with the respective contributors.
Licensed under GNU AGPL-3.0-only.
Corresponding source: https://github.com/2140wtf/2140wtf
License: https://github.com/2140wtf/2140wtf/blob/main/LICENSE
Third-party notices: https://github.com/2140wtf/2140wtf/blob/main/THIRD_PARTY_NOTICES.md

${nobleScureMit}

${nobleCiphersMit}
*/`;
}
