import { useSeoMeta } from "@unhead/react";

import { GroupChatPage } from "@/pages/GroupChatPage";

/**
 * 2140 Social — the in-app social chat.
 *
 * Backed by the app's own NIP-29 group chat on the shared Nostr relay pool
 * (custom code, no third-party chat stack). Renders the same group-chat
 * experience surfaced at /groups under the 2140 Social entry point.
 */
export function BaoCommunitiesPage() {
  useSeoMeta({
    title: "2140 Social",
    description: "2140 Social — public group chat on Nostr, inside 2140.",
  });

  return <GroupChatPage />;
}
