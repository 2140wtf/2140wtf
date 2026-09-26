/**
 * agentPrompt - thin re-export of the canonical agent-onboarding brief.
 *
 * The canonical implementation lives in `@bao/community`
 * (`src/agentPrompt.ts`, built to `dist/agentPrompt.js`; bao-community#103).
 * The browser bundle cannot import the package ROOT: `dist/index.js` also
 * re-exports `./provision.js` → `provision-fs.js` (node:fs/node:crypto), which
 * Vite externalizes for the browser and then fails on missing bindings. The
 * `./dist/*` exports-map entry is the browser-safe path (the repo's other 60+
 * `@/baofund/community/*` imports follow the same rule). This module keeps the
 * local path/API so `ChatPanel.tsx` and the agentPrompt tests consume the one
 * shared source instead of a parity copy.
 */
export {
  AGENT_HELLO_URL,
  agentShareText,
  fetchAgentHelloSha,
  sanitizeRoomName,
} from '@/baofund/community/agentPrompt.js';
export type { AgentPromptOptions } from '@/baofund/community/agentPrompt.js';
