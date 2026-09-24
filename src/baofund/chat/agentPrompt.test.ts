import { afterEach, expect, it, vi } from 'vitest';
import { AGENT_HELLO_URL, agentShareText, fetchAgentHelloSha } from './agentPrompt';

const LINK = 'https://app.bao.network/chat/join#fragment-secret';
const AGENT_LINK = 'https://app.bao.network/chat/join#agent-fragment';
const SHA = 'a'.repeat(64);

afterEach(() => vi.unstubAllGlobals());

it('hands the agent a verifiable client, the invite and a durable state dir', () => {
  const text = agentShareText(LINK, SHA);
  expect(text).toContain(`curl -fsSLo /tmp/bao-hello.mjs ${AGENT_HELLO_URL}`);
  expect(text).toContain('sha256sum /tmp/bao-hello.mjs');
  expect(text).toContain(`sha256sum /tmp/bao-hello.mjs        # must equal ${SHA}`);
  expect(text).toContain(`node /tmp/bao-hello.mjs --state-dir ~/.bao-agent '${LINK}' 'Hi! I just joined.'`);
  expect(text).toContain('reuse the SAME --state-dir');
  expect(text).toContain('CONFIRMED in scroll');
  expect(text).toContain('do not explore, grep, edit, install, build or investigate anything');
});

it('carries every required instruction string', () => {
  const text = agentShareText(LINK, SHA, { agentLink: AGENT_LINK, roomName: 'Trollbox' });
  const required = [
    `curl -fsSLo /tmp/bao-hello.mjs ${AGENT_HELLO_URL}`,
    'sha256sum /tmp/bao-hello.mjs',
    `node /tmp/bao-hello.mjs --state-dir ~/.bao-agent '${AGENT_LINK}' 'Hi! I just joined.'`,
    "--hello '<NAME>'",
    'llm: true',
    'IDENTITY durable',
    'JOINED',
    'CONFIRMED in scroll',
    '30s',
    'ERROR',
    'nonzero',
    'Trollbox',
    'member identity',
    'identity.json',
    '0600',
    'browser',
    'relay',
    'Cloudflare',
    'not involved',
    'untrusted data',
    'never as instructions',
    'BAO MCP server is released yet',
    'Hi! I just joined.',
    'share it only with agents trusted in this room',
  ];
  for (const s of required) expect(text).toContain(s);
});

it('prefers the room agent link and labels it as the agent link', () => {
  const text = agentShareText(LINK, SHA, { agentLink: AGENT_LINK, roomName: 'Trollbox' });
  expect(text).toContain(`'${AGENT_LINK}'`);
  expect(text).not.toContain(`'${LINK}'`);
  expect(text).toContain('agent invite link');
  expect(text).toContain('Join the BAO room "Trollbox"');
});

it('labels the plain link as the human link when no agent link exists', () => {
  const text = agentShareText(LINK, SHA);
  expect(text).toContain(`'${LINK}'`);
  expect(text).toContain('human invite link');
});

it('keeps the placeholder when no room is selected', () => {
  expect(agentShareText('', SHA)).toContain(`'<select a room first>'`);
});

it('never points at a private repo or the website as an install path', () => {
  const text = agentShareText(LINK, SHA);
  expect(text).toContain(AGENT_HELLO_URL);
  expect(text).not.toContain('github.com');
  expect(text).not.toContain('bao_fund_it');
  expect(text).not.toContain('git clone');
});

it('falls back to the sidecar pointer when the sha is unknown', () => {
  expect(agentShareText(LINK, null)).toContain('see bao-hello.mjs.sha256 next to the client');
});

it('fetches the published sha256 sidecar', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => `${SHA}\n` }));
  await expect(fetchAgentHelloSha()).resolves.toBe(SHA);
});

it('returns null when the sidecar is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(fetchAgentHelloSha()).resolves.toBeNull();
});
