/**
 * 2140 Social — bundled room directory.
 *
 * Mirrors the production directory served at www.2140.social/rooms.json
 * (members-gated there; bundled here so the in-app client joins the same
 * rooms over the same relay without a server round-trip). Join links are
 * "fat" — relay, welcomer pubkey, and routing id ride inside the fragment —
 * so the client library needs nothing else to join.
 *
 * To add a room: create it at www.2140.social and append its directory
 * entry here. The shape matches the server's rooms.json exactly.
 */
export interface BaoSocialRoomInfo {
  roomId: string;
  name: string;
  topic: string;
  joinLink: string;
  /** Same fragment as joinLink, /agent#… door — the executable agent link. */
  agentLink: string;
  welcomerPub: string;
  routingId: string;
  flushDeadlineMs: number;
  history?: string;
}

export interface BaoSocialDirectory {
  relayUrl: string;
  rooms: BaoSocialRoomInfo[];
}

export const BAO_SOCIAL_DIRECTORY: BaoSocialDirectory = {
  relayUrl: "wss://2140.social/ws",
  rooms: [
    {
      roomId: "b54caea8023c71e8",
      name: "general",
      topic: "BAO Markets community chat — open to everyone",
      joinLink:
        "https://2140.social/chat/join#eyJrIjoiOTgwNjQ2MGI5MWZiOTQ3ZjdlMDAwMjZhOTc1YzdlOGE2M2Q1ZmIxNzk2ZjZjN2M0YTg3YzA5NmI3YjlhMjFlNCIsInJvb20iOiJiNTRjYWVhODAyM2M3MWU4IiwicmVsYXkiOiJ3c3M6Ly9yZWxheS4yMTQwLnNvY2lhbCIsInciOiIwNTk1NWExYzlmZDNiNGU1MDY3ZTMyMWEyNTY3YzA1NDczMjNmOTg5MDg4YjQ1ODBhN2YxY2M0ODdlZDE0NTI3IiwiciI6IjYwNDVkMzI0MDZjM2YxODI4ZGJmNWE1N2U1ZGQxNWE1NGIyMzIyZGMxMTQ4Y2UxOGQ2ZmMyODU1N2QzYWM5ZjIiLCJoaXN0IjoiZnVsbCJ9",
      agentLink: "",
      history: "full",
      welcomerPub: "05955a1c9fd3b4e5067e321a2567c0547323f989088b4580a7f1cc487ed14527",
      routingId: "6045d32406c3f1828dbf5a57e5dd15a54b2322dc1148ce18d6fc28557d3ac9f2",
      flushDeadlineMs: 4000,
    },
  ],
};
