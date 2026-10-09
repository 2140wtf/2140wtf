/**
 * Static agent-discovery contract for 2140.wtf.
 *
 * This host had NO llms.txt at all — the other five BAO hosts each had one, and
 * this is the flagship app. It also had a robots.txt that was a bare
 * `User-agent: * Allow: /`: nothing refused bulk AI training, and nothing
 * distinguished on-demand retrieval from corpus building.
 *
 * Everything asserted here is a file, not a component, so this test is the one
 * thing that will notice if the discovery surface silently disappears from a
 * release build. The parser below is the RFC 9309 §2.2.2 selection rule written
 * out (longest matching path wins; Allow beats Disallow at equal length; the
 * most specific matching user-agent group wins) — transcribed rather than
 * imported, because the point is that OUR file reads the way crawlers read it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// process.cwd(), like serviceWorkerPolicy.test.ts next door: vitest runs from
// the repo root, so this is stable regardless of where the file sits.
const publicDir = resolve(process.cwd(), 'public')
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

interface Rule {
  pattern: string
  allow: boolean
}

function parseRobots(text: string): { agents: string[]; rules: Rule[] }[] {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let current: { agents: string[]; rules: Rule[] } | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = (raw.split('#')[0] ?? '').trim()
    if (!line) continue
    const [field = '', ...rest] = line.split(':')
    const key = field.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      // Consecutive User-agent lines share a group, but only until a rule
      // appears — that is what makes two tokens one group with one rule set.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.rules.push({ pattern: value, allow: key === 'allow' })
    }
  }
  return groups
}

/** robots.txt path patterns: `*` matches any run, `$` anchors the end. */
function patternMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
}

function canFetch(text: string, agent: string, path: string): boolean {
  const groups = parseRobots(text)
  const ua = agent.toLowerCase()
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)))
  const rules = (specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'))).flatMap(
    (g) => g.rules,
  )
  let decision: boolean | undefined
  let best = -1
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, path)) continue
    const rank = rule.pattern === '' ? -1 : rule.pattern.length
    if (rank > best || (rank === best && rule.allow && decision === false)) {
      best = rank
      decision = rule.allow
    }
  }
  return decision ?? true
}

const ROBOTS = read(publicDir, 'robots.txt')

/** Crawlers that also do on-demand retrieval when a user asks. */
const RETRIEVAL_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Claude-User',
  'Claude-SearchBot',
]

/** Crawlers whose only job is to build a corpus. */
const TRAINING_AGENTS = [
  'CCBot',
  'Google-Extended',
  'Amazonbot',
  'Applebot-Extended',
  'Diffbot',
  'ImagesiftBot',
  'Omgilibot',
  'YouBot',
  'Bytespider',
  'FacebookBot',
  'meta-externalagent',
  'cohere-ai',
]

/** The written surface an agent is allowed to fetch here. */
const AGENT_DOCS = [
  '/llms.txt',
  '/llms.md',
  '/llms-full.txt',
  '/.well-known/llms.txt',
  '/.well-known/agent.json',
  '/AGENTS.md',
  '/CHAT_PROTOCOL.md',
  '/CHANGELOG.md',
  '/manifest.webmanifest',
]

describe('llms.txt exists and follows the llmstxt.org shape', () => {
  it('has an H1 title and a one-paragraph blockquote summary', () => {
    const llms = read(publicDir, 'llms.txt')
    expect(llms.startsWith('# ')).toBe(true)
    expect(llms).toMatch(/^> .+/m)
  })

  it('describes the real product rather than a template', () => {
    const llms = read(publicDir, 'llms.txt')
    // Every claim here was checked against the router, the README and the
    // agent surfaces in this repo. If a feature is renamed or dropped, this is
    // the assertion that has to be revisited with it.
    for (const fact of ['wss://relay.bao.fund', 'NIP-22', 'kind-38000', 'NIP-60/61', 'AGPL-3.0']) {
      expect(llms).toContain(fact)
    }
    // The bearer-capability rule is the single most important thing in the
    // agent surface; a summary that omitted it would be actively misleading.
    expect(llms).toContain('bearer capability')
  })

  // Committed copies: this app has no build step that could generate them, and
  // three copies WILL drift. A red test beats a stale document an agent reads.
  it.each(['llms.md', '.well-known/llms.txt'])('%s is the same document as llms.txt', (variant) => {
    expect(read(publicDir, ...variant.split('/'))).toBe(read(publicDir, 'llms.txt'))
  })

  it('llms-full.txt explains the absent corpus instead of 404ing as HTML', () => {
    const full = read(publicDir, 'llms-full.txt')
    expect(full).toContain('/llms.txt')
    expect(full).toContain('no expanded corpus')
  })

  // The llmstxt.org layout an agent crawler expects: a lead section of the few
  // links that matter most, and `Optional` last so the tail is skimmable.
  it('leads with Start here and keeps Optional last', () => {
    const sections = [...read(publicDir, 'llms.txt').matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(sections[0]).toBe('Start here')
    expect(sections.at(-1)).toBe('Optional')
    expect(sections.length).toBeGreaterThan(4)
  })

  // Every link was verified live (HTTP 200 with real content) before it was
  // added. An absolute https URL is the cheap half of that promise: it cannot
  // silently re-point at a 404 when the host or the build layout changes.
  it('links only absolute https destinations', () => {
    const llms = read(publicDir, 'llms.txt')
    const links = [...llms.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? '')
    expect(links.length).toBeGreaterThan(20)
    for (const href of links) expect(href, href).toMatch(/^https:\/\/[a-z0-9.-]+\//)
  })
})

describe('the <head> discovery tag', () => {
  it('index.html advertises this host’s OWN llms.txt', () => {
    const html = read(process.cwd(), 'index.html')
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="/llms.txt"')
    // The existing rel="agents" link is kept: it advertises a different,
    // much larger document, not the site summary.
    expect(html).toContain('<link rel="agents" href="/AGENTS.md" />')
  })
})

describe('robots.txt — training refused, retrieval allowed', () => {
  it.each(RETRIEVAL_AGENTS)('%s may fetch the written surface', (agent) => {
    for (const path of AGENT_DOCS) {
      expect(canFetch(ROBOTS, agent, path), `${agent} ${path}`).toBe(true)
    }
  })

  it.each(RETRIEVAL_AGENTS)('%s is refused the app shell and the assets', (agent) => {
    for (const path of ['/', '/community', '/bao/markets', '/assets/app.js', '/AGENTS.md.bak']) {
      expect(canFetch(ROBOTS, agent, path), `${agent} ${path}`).toBe(false)
    }
  })

  it.each(TRAINING_AGENTS)('%s is refused everywhere, llms.txt included', (agent) => {
    for (const path of ['/', '/llms.txt', '/AGENTS.md', '/CHAT_PROTOCOL.md']) {
      expect(canFetch(ROBOTS, agent, path), `${agent} ${path}`).toBe(false)
    }
  })

  // The llms discovery paths must stay UNANCHORED: Python's
  // `urllib.robotparser` percent-encodes `$` to `%24`, so an anchored rule
  // never matches and the group reads as `Disallow: /` for every agent
  // framework built on that parser. The prefix widening (`/llms.txt*`) is
  // accepted because the origin publishes no such neighbour files. Verified
  // live with urllib.robotparser as part of this change.
  it('leaves the llms paths unanchored for non-conformant parsers', () => {
    for (const path of ['/llms.txt', '/llms.md', '/llms-full.txt', '/.well-known/llms.txt']) {
      expect(ROBOTS).toContain(`Allow: ${path}\n`)
      expect(ROBOTS).not.toContain(`Allow: ${path}$`)
    }
  })

  it.each(['Googlebot', 'Bingbot', 'DuckDuckBot', 'Mozilla/5.0 (compatible; SomeBot/1.0)'])(
    'search engine %s keeps the whole site',
    (agent) => {
      for (const path of ['/', '/community', '/llms.txt']) {
        expect(canFetch(ROBOTS, agent, path), `${agent} ${path}`).toBe(true)
      }
    },
  )
})