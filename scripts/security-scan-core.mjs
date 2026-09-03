import { createHash } from 'node:crypto';

/** Patterns for bearer capabilities that must never enter Git history. */
const capabilityPatterns = [
  {
    category: 'Embedded BAO invite capability',
    pattern: /(?:https?:\/\/[^\s"'`<>]+)?\/(?:chat\/join|agent)#[A-Za-z0-9_-]{40,}={0,2}/g,
  },
  {
    category: 'Embedded BAO room-link field',
    pattern: /["'](?:joinLink|agentLink)["']\s*:\s*["'][^"'\r\n]*#[A-Za-z0-9_-]{40,}={0,2}/g,
  },
  {
    category: 'Embedded BAO split-invite secret',
    pattern: /(?:^|\n)\s*secret\s*=\s*[0-9a-f]{64}\s*(?:\r?\n|$)/gi,
  },
  {
    category: 'Embedded BAO short invite',
    pattern: /https:\/\/2140\.social\/i\/[A-Za-z0-9_-]{8,}/g,
  },
];

export function findCapabilityLeaks(content) {
  const findings = [];
  for (const { category, pattern } of capabilityPatterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      findings.push({ category, index: match.index ?? 0, value: match[0] });
    }
  }
  return findings;
}

export function redactedEvidence(value) {
  return {
    chars: value.length,
    sha256: createHash('sha256').update(value).digest('hex').slice(0, 12),
  };
}
