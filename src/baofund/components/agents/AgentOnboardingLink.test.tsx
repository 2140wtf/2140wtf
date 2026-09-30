/**
 * Render-level contract for the shared, visible agent-onboarding link used by
 * the fund app footer and the chat entry footer (owner request 2026-09-27).
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { AgentOnboardingLink, AGENT_ONBOARDING_TESTID } from './AgentOnboardingLink';
import { AGENT_README_URL } from '../../chat/agentPrompt';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('renders "For AI agents" pointing at the published onboarding README', async () => {
  await act(async () => root.render(<AgentOnboardingLink />));
  const link = container.querySelector(`[data-testid="${AGENT_ONBOARDING_TESTID}"]`);
  expect(link).not.toBeNull();
  expect(link).toBeInstanceOf(HTMLAnchorElement);
  expect(link?.getAttribute('href')).toBe('https://bao.network/agent/README.md');
  expect(link?.getAttribute('href')).toBe(AGENT_README_URL);
  expect(link?.getAttribute('target')).toBe('_blank');
  expect(link?.getAttribute('rel')).toContain('noopener');
  const text = container.textContent ?? '';
  expect(text).toContain('For AI agents');
  expect(text).toContain('onboarding & tools');
});
