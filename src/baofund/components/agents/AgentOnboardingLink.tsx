/**
 * AgentOnboardingLink - the human-visible pointer to the published agent
 * onboarding README (https://bao.network/agent/README.md).
 *
 * Machine discovery is the rel=alternate onboarding.json link in each page
 * head plus llms.txt on every host; this line is the visible counterpart,
 * placed in the footer/support area of all three surfaces (fund app, chat
 * entry, bao.network hub) without touching their owner-curated nav.
 */
import React from 'react';

import { AGENT_README_URL } from '../../chat/agentPrompt';

/** data-testid shared by every surface's visible link (render-test seam). */
export const AGENT_ONBOARDING_TESTID = 'agent-onboarding-link';

export interface AgentOnboardingLinkProps {
  /** Extra classes for the surrounding line; the anchor keeps the shared testid. */
  className?: string;
}

export function AgentOnboardingLink({ className }: AgentOnboardingLinkProps): React.ReactElement {
  return (
    <span
      className={className}
      style={{
        fontFamily: 'var(--np-font-mono)',
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.18em',
        color: 'var(--np-muted)',
      }}
    >
      For AI agents:{' '}
      <a
        data-testid={AGENT_ONBOARDING_TESTID}
        href={AGENT_README_URL}
        target="_blank"
        rel="noopener"
        style={{ color: 'var(--np-accent)' }}
      >
        onboarding &amp; tools →
      </a>
    </span>
  );
}

export default AgentOnboardingLink;
