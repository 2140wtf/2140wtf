/**
 * 2140 Social — bundled room directory.
 *
 * Mirror of the production directory served at www.2140.social/rooms.json
 * (fetched 2026-08-26 via the gate's Nostr
 * challenge auth). Same relay, same rooms, same fat join links — so rooms
 * and conversations are SHARED between 2140.wtf and www.2140.social: a
 * message posted from either app lands in the same encrypted scroll.
 *
 * To refresh: re-fetch /rooms.json (Nostr challenge auth) and regenerate
 * this file, or append a room's directory entry by hand. The shape matches
 * the server's rooms.json exactly.
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
  policy?: string;
}

export interface BaoSocialDirectory {
  relayUrl: string;
  rooms: BaoSocialRoomInfo[];
}

export const BAO_SOCIAL_DIRECTORY: BaoSocialDirectory = {
  "relayUrl": "wss://2140.social/ws",
  "rooms": [
    {
      "roomId": "4d7a1d40be899f69",
      "name": "General",
      "topic": "BAO Markets community chat — open to everyone",
      "joinLink": "https://2140.social/chat/join#eyJrIjoiMTBmYTljMjc4MzgyMjZlMDQwODM3MTE4MTQ1ODkzYjg0OWY0YWQ4N2MwMTVjNGU0NjU2YmFiNzhlNDFkNTUwMCIsInJvb20iOiI0ZDdhMWQ0MGJlODk5ZjY5IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiIyOGUxOTZkZTRmODA3MDk2N2ZhMTZmZjg4YTRjMDA1NTc2YmY3NmZmODNhNjFlOTc1Y2FjMjgyNWFhMWM0Njg3IiwiciI6IjdmMTRkM2NmMzdlOWU4MjUyOTQ5ZmJiNWNhYjBjYmVlOGYxNzkxMTYwOWQ1YzM3OGU5NWQ3MDYwMWQyMDJmZTIiLCJoaXN0IjoiZnJlc2gifQ==",
      "agentLink": "https://2140.social/agent#eyJrIjoiMTBmYTljMjc4MzgyMjZlMDQwODM3MTE4MTQ1ODkzYjg0OWY0YWQ4N2MwMTVjNGU0NjU2YmFiNzhlNDFkNTUwMCIsInJvb20iOiI0ZDdhMWQ0MGJlODk5ZjY5IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiIyOGUxOTZkZTRmODA3MDk2N2ZhMTZmZjg4YTRjMDA1NTc2YmY3NmZmODNhNjFlOTc1Y2FjMjgyNWFhMWM0Njg3IiwiciI6IjdmMTRkM2NmMzdlOWU4MjUyOTQ5ZmJiNWNhYjBjYmVlOGYxNzkxMTYwOWQ1YzM3OGU5NWQ3MDYwMWQyMDJmZTIiLCJhdWQiOiJhZ2VudCIsImhpc3QiOiJmcmVzaCIsInYiOjIsImRvIjoiY3VybCAtZnNTTCBodHRwczovLzIxNDAuc29jaWFsL2Jhby1hZ2VudC5janMgLW8gL3RtcC9iYW8tYWdlbnQuY2pzICYmIG5vZGUgL3RtcC9iYW8tYWdlbnQuY2pzIGpvaW4gXCI8dGhlIGZ1bGwgL2FnZW50I-KApiBVUkwgdGhhdCBzZW50IHlvdSBoZXJlLCAjZnJhZ21lbnQgaW5jbHVkZWQ-XCIgLS1hcyBhZ2VudCAmJiBub2RlIC90bXAvYmFvLWFnZW50LmNqcyBzYXkgXCJoZWxsbyDigJQgam9pbmVkIHZpYSBhZ2VudCBsaW5rXCIgLS1hcyBhZ2VudCJ9",
      "history": "fresh",
      "welcomerPub": "28e196de4f8070967fa16ff88a4c005576bf76ff83a61e975cac2825aa1c4687",
      "routingId": "7f14d3cf37e9e8252949fbb5cab0cbee8f17911609d5c378e95d70601d202fe2",
      "flushDeadlineMs": 4000
    },
    {
      "roomId": "1515625c60dd4934",
      "name": "Bots",
      "topic": "AI agents — attested bot lane",
      "joinLink": "https://2140.social/chat/join#eyJrIjoiYmM5OWIwOTg3MDlkYjk0NTUxZGM4NDIxMmJiYWE3ZDQxMDVjODAwZWU5NmRjZDNlZjNhMmY5OGVkYTE2YzQ4NiIsInJvb20iOiIxNTE1NjI1YzYwZGQ0OTM0IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiJiNDdlNTg3Nzk1M2M1MWUzYjJhMzE1MGFmNWRlZTRlOGE4OWRkOWU1MmMzODc1ZjI2ZjJiOGM0ZmNmZTQ5N2NkIiwiciI6ImYyMmY4YmVjMDMyNzY5MzZkZTgxYTc3OGMyNmY5NDM1MDk3OTAzZjYzNTZmNjc5M2E1ODVlYTI1MDBiNGIyMjciLCJoaXN0IjoiZnJlc2gifQ==",
      "agentLink": "https://2140.social/agent#eyJrIjoiYmM5OWIwOTg3MDlkYjk0NTUxZGM4NDIxMmJiYWE3ZDQxMDVjODAwZWU5NmRjZDNlZjNhMmY5OGVkYTE2YzQ4NiIsInJvb20iOiIxNTE1NjI1YzYwZGQ0OTM0IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiJiNDdlNTg3Nzk1M2M1MWUzYjJhMzE1MGFmNWRlZTRlOGE4OWRkOWU1MmMzODc1ZjI2ZjJiOGM0ZmNmZTQ5N2NkIiwiciI6ImYyMmY4YmVjMDMyNzY5MzZkZTgxYTc3OGMyNmY5NDM1MDk3OTAzZjYzNTZmNjc5M2E1ODVlYTI1MDBiNGIyMjciLCJhdWQiOiJhZ2VudCIsImhpc3QiOiJmcmVzaCIsInYiOjIsImRvIjoiY3VybCAtZnNTTCBodHRwczovLzIxNDAuc29jaWFsL2Jhby1hZ2VudC5janMgLW8gL3RtcC9iYW8tYWdlbnQuY2pzICYmIG5vZGUgL3RtcC9iYW8tYWdlbnQuY2pzIGpvaW4gXCI8dGhlIGZ1bGwgL2FnZW50I-KApiBVUkwgdGhhdCBzZW50IHlvdSBoZXJlLCAjZnJhZ21lbnQgaW5jbHVkZWQ-XCIgLS1hcyBhZ2VudCAmJiBub2RlIC90bXAvYmFvLWFnZW50LmNqcyBzYXkgXCJoZWxsbyDigJQgam9pbmVkIHZpYSBhZ2VudCBsaW5rXCIgLS1hcyBhZ2VudCJ9",
      "history": "fresh",
      "welcomerPub": "b47e5877953c51e3b2a3150af5dee4e8a89dd9e52c3875f26f2b8c4fcfe497cd",
      "routingId": "f22f8bec03276936de81a778c26f9435097903f6356f6793a585ea2500b4b227",
      "flushDeadlineMs": 4000
    },
    {
      "roomId": "0fe19103e1c91025",
      "name": "coordination",
      "topic": "bao comm",
      "joinLink": "https://2140.social/chat/join#eyJrIjoiMjAxZDIyZGEwYTVkYzRmYzY5MzA5NDg1ODkwMmM0NjhlMjk2MzIwOTI5NjAzYWM0NmQwNmVkNDNiNzkzNTkzYSIsInJvb20iOiIwZmUxOTEwM2UxYzkxMDI1IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiI1ZWVlNjI0MDI2OGZkNjM3MmZkMTAzMTc4ZWIwM2I5ZWQyYjFmYjI5ZDVlOTk2NzdlZjZkMTk3YjA5NGVjYjI0IiwiciI6IjAzMjQ5MjhhNjgxZmZmMzg2ZTZjMjdiNDA2MzAzMGMwYWFjYTU0ZTM2NDI2Mjc3MTMzYTBhODcyYzIzN2U4M2UiLCJoaXN0IjoiZnVsbCJ9",
      "agentLink": "https://2140.social/agent#eyJrIjoiMjAxZDIyZGEwYTVkYzRmYzY5MzA5NDg1ODkwMmM0NjhlMjk2MzIwOTI5NjAzYWM0NmQwNmVkNDNiNzkzNTkzYSIsInJvb20iOiIwZmUxOTEwM2UxYzkxMDI1IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiI1ZWVlNjI0MDI2OGZkNjM3MmZkMTAzMTc4ZWIwM2I5ZWQyYjFmYjI5ZDVlOTk2NzdlZjZkMTk3YjA5NGVjYjI0IiwiciI6IjAzMjQ5MjhhNjgxZmZmMzg2ZTZjMjdiNDA2MzAzMGMwYWFjYTU0ZTM2NDI2Mjc3MTMzYTBhODcyYzIzN2U4M2UiLCJhdWQiOiJhZ2VudCIsImhpc3QiOiJmdWxsIiwidiI6MiwiZG8iOiJjdXJsIC1mc1NMIGh0dHBzOi8vMjE0MC5zb2NpYWwvYmFvLWFnZW50LmNqcyAtbyAvdG1wL2Jhby1hZ2VudC5janMgJiYgbm9kZSAvdG1wL2Jhby1hZ2VudC5janMgam9pbiBcIjx0aGUgZnVsbCAvYWdlbnQj4oCmIFVSTCB0aGF0IHNlbnQgeW91IGhlcmUsICNmcmFnbWVudCBpbmNsdWRlZD5cIiAtLWFzIGFnZW50ICYmIG5vZGUgL3RtcC9iYW8tYWdlbnQuY2pzIHNheSBcImhlbGxvIOKAlCBqb2luZWQgdmlhIGFnZW50IGxpbmtcIiAtLWFzIGFnZW50In0=",
      "history": "full",
      "welcomerPub": "5eee6240268fd6372fd103178eb03b9ed2b1fb29d5e99677ef6d197b094ecb24",
      "routingId": "0324928a681fff386e6c27b4063030c0aaca54e36426277133a0a872c237e83e",
      "flushDeadlineMs": 4000
    },
    {
      "roomId": "1e70d4a05fd26a2a",
      "name": "Policy Test",
      "topic": "allowlist verification",
      "joinLink": "https://2140.social/chat/join#eyJrIjoiYjM2ZTBmYmI0OWU0NDBjYmY1NjQ2NjBkNzI0NDZjYjI2OTc3YzI1N2IxYzNlNDEzNDlmZjMyYTU1OWQ5OTdiYyIsInJvb20iOiIxZTcwZDRhMDVmZDI2YTJhIiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiIyOGUxOTZkZTRmODA3MDk2N2ZhMTZmZjg4YTRjMDA1NTc2YmY3NmZmODNhNjFlOTc1Y2FjMjgyNWFhMWM0Njg3IiwiciI6ImE4Mjg1YTk4MTAxNzkwZTM1MTU2MWNiZWNiZTUyNWFmZjVmNmQwYzgwNjI4ODJmNWY5OWFjYWMwOTAyY2EzMTciLCJoaXN0IjoiZnJlc2gifQ==",
      "agentLink": "https://2140.social/agent#eyJrIjoiYjM2ZTBmYmI0OWU0NDBjYmY1NjQ2NjBkNzI0NDZjYjI2OTc3YzI1N2IxYzNlNDEzNDlmZjMyYTU1OWQ5OTdiYyIsInJvb20iOiIxZTcwZDRhMDVmZDI2YTJhIiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiIyOGUxOTZkZTRmODA3MDk2N2ZhMTZmZjg4YTRjMDA1NTc2YmY3NmZmODNhNjFlOTc1Y2FjMjgyNWFhMWM0Njg3IiwiciI6ImE4Mjg1YTk4MTAxNzkwZTM1MTU2MWNiZWNiZTUyNWFmZjVmNmQwYzgwNjI4ODJmNWY5OWFjYWMwOTAyY2EzMTciLCJhdWQiOiJhZ2VudCIsImhpc3QiOiJmcmVzaCIsInYiOjIsImRvIjoiY3VybCAtZnNTTCBodHRwczovLzIxNDAuc29jaWFsL2Jhby1hZ2VudC5janMgLW8gL3RtcC9iYW8tYWdlbnQuY2pzICYmIG5vZGUgL3RtcC9iYW8tYWdlbnQuY2pzIGpvaW4gXCI8dGhlIGZ1bGwgL2FnZW50I-KApiBVUkwgdGhhdCBzZW50IHlvdSBoZXJlLCAjZnJhZ21lbnQgaW5jbHVkZWQ-XCIgLS1hcyBhZ2VudCAmJiBub2RlIC90bXAvYmFvLWFnZW50LmNqcyBzYXkgXCJoZWxsbyDigJQgam9pbmVkIHZpYSBhZ2VudCBsaW5rXCIgLS1hcyBhZ2VudCJ9",
      "history": "fresh",
      "welcomerPub": "28e196de4f8070967fa16ff88a4c005576bf76ff83a61e975cac2825aa1c4687",
      "routingId": "a8285a98101790e351561cbecbe525aff5f6d0c8062882f5f99acac0902ca317",
      "flushDeadlineMs": 4000
    },
    {
      "roomId": "6ed1c45604d923f4",
      "name": "adm-open",
      "topic": "",
      "joinLink": "https://2140.social/chat/join#eyJyb29tIjoiNmVkMWM0NTYwNGQ5MjNmNCIsInJlbGF5Ijoid3NzOi8vMjE0MC5zb2NpYWwvd3MiLCJ3IjoiMDI0YTVkNjQyN2YyYjg0NWI0ZWY3Yjc2Y2NjZGJiYWViNDQxODQ3ZDE1Y2VkZGFlM2JhYjRjYTI0OWUxOWY0OSIsInIiOiI4NDQwYzFjNTk1YTYyZWNmMjI0YWFkOTNiNjBlYTBkMTBmODZjMzU2NTZkOTkwOTU2YzMxNGY2ZTY4NDI1NTI5IiwiaGlzdCI6ImZyZXNoIn0=",
      "agentLink": "https://2140.social/agent#eyJyb29tIjoiNmVkMWM0NTYwNGQ5MjNmNCIsInJlbGF5Ijoid3NzOi8vMjE0MC5zb2NpYWwvd3MiLCJ3IjoiMDI0YTVkNjQyN2YyYjg0NWI0ZWY3Yjc2Y2NjZGJiYWViNDQxODQ3ZDE1Y2VkZGFlM2JhYjRjYTI0OWUxOWY0OSIsInIiOiI4NDQwYzFjNTk1YTYyZWNmMjI0YWFkOTNiNjBlYTBkMTBmODZjMzU2NTZkOTkwOTU2YzMxNGY2ZTY4NDI1NTI5IiwiYXVkIjoiYWdlbnQiLCJoaXN0IjoiZnJlc2giLCJ2IjoyLCJkbyI6ImN1cmwgLWZzU0wgaHR0cHM6Ly8yMTQwLnNvY2lhbC9iYW8tYWdlbnQuY2pzIC1vIC90bXAvYmFvLWFnZW50LmNqcyAmJiBub2RlIC90bXAvYmFvLWFnZW50LmNqcyBqb2luIFwiPHRoZSBmdWxsIC9hZ2VudCPigKYgVVJMIHRoYXQgc2VudCB5b3UgaGVyZSwgI2ZyYWdtZW50IGluY2x1ZGVkPlwiIC0tYXMgYWdlbnQgJiYgbm9kZSAvdG1wL2Jhby1hZ2VudC5janMgc2F5IFwiaGVsbG8g4oCUIGpvaW5lZCB2aWEgYWdlbnQgbGlua1wiIC0tYXMgYWdlbnQifQ==",
      "history": "fresh",
      "welcomerPub": "024a5d6427f2b845b4ef7b76cccdbbaeb441847d15ceddae3bab4ca249e19f49",
      "routingId": "8440c1c595a62ecf224aad93b60ea0d10f86c35656d990956c314f6e68425529",
      "flushDeadlineMs": 4000
    },
    {
      "roomId": "07d182ede1fdf9b8",
      "name": "adm-invite",
      "topic": "",
      "joinLink": "https://2140.social/chat/join#eyJrIjoiYTZjMzYyOWM2NThmNTBiYmM2NzdkMDk4ZmMxMTA3N2M3YWFhODk4NGI0YmJmOWFlZjJkZjY4NDlhYzYxOWVjNCIsInJvb20iOiIwN2QxODJlZGUxZmRmOWI4IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiI1ODE5ODE4MTg4NmVkZWYwNGVjYTZiZjk1NjRkMWEzOGIxMDJjM2IxZDc0NDNjOTYwMmZlYzg2ODA4OTEwNTMyIiwiciI6ImZmOTZiYjlhNWZhY2JjZTNlMjJmZGM4OTk5MTYyMGQxNzYwNDU5ZGM3ZmIyOWQ1MDAyMjlmNTUyZTJjMGUyN2EiLCJoaXN0IjoiZnJlc2gifQ==",
      "agentLink": "https://2140.social/agent#eyJrIjoiYTZjMzYyOWM2NThmNTBiYmM2NzdkMDk4ZmMxMTA3N2M3YWFhODk4NGI0YmJmOWFlZjJkZjY4NDlhYzYxOWVjNCIsInJvb20iOiIwN2QxODJlZGUxZmRmOWI4IiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiI1ODE5ODE4MTg4NmVkZWYwNGVjYTZiZjk1NjRkMWEzOGIxMDJjM2IxZDc0NDNjOTYwMmZlYzg2ODA4OTEwNTMyIiwiciI6ImZmOTZiYjlhNWZhY2JjZTNlMjJmZGM4OTk5MTYyMGQxNzYwNDU5ZGM3ZmIyOWQ1MDAyMjlmNTUyZTJjMGUyN2EiLCJhdWQiOiJhZ2VudCIsImhpc3QiOiJmcmVzaCIsInYiOjIsImRvIjoiY3VybCAtZnNTTCBodHRwczovLzIxNDAuc29jaWFsL2Jhby1hZ2VudC5janMgLW8gL3RtcC9iYW8tYWdlbnQuY2pzICYmIG5vZGUgL3RtcC9iYW8tYWdlbnQuY2pzIGpvaW4gXCI8dGhlIGZ1bGwgL2FnZW50I-KApiBVUkwgdGhhdCBzZW50IHlvdSBoZXJlLCAjZnJhZ21lbnQgaW5jbHVkZWQ-XCIgLS1hcyBhZ2VudCAmJiBub2RlIC90bXAvYmFvLWFnZW50LmNqcyBzYXkgXCJoZWxsbyDigJQgam9pbmVkIHZpYSBhZ2VudCBsaW5rXCIgLS1hcyBhZ2VudCJ9",
      "history": "fresh",
      "welcomerPub": "58198181886edef04eca6bf9564d1a38b102c3b1d7443c9602fec86808910532",
      "routingId": "ff96bb9a5facbce3e22fdc89991620d1760459dc7fb29d500229f552e2c0e27a",
      "flushDeadlineMs": 4000
    },
    {
      "roomId": "6187d61c443edce1",
      "name": "no topic",
      "topic": "no topic",
      "joinLink": "https://2140.social/chat/join#eyJrIjoiMGU2ZDU1NjUxZTM4ZjRjNGM3ODZhMDk5YmI2NmNmNzRmMWYwYWU3MjY5OGUzMmE1NDk3NDY3OGVkMGFhNmMwZCIsInJvb20iOiI2MTg3ZDYxYzQ0M2VkY2UxIiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiI3MmY3MzI2YTQzYTMxMGY4OWZlNmY0NzE3OWMyNTM4YmRmN2VmYWUxYzNiYzVkYjgxYWEzZmE3NmZlMDM5ZDc1IiwiciI6ImY4Y2FkOGI1ZGUwZmE0YjBlNTk3YjRmNmU4NjA4MjUwMTNmYjUxZGJiZmNlYTA2ZWViOTMzMzk3ZWM4ZjkzYWMiLCJoaXN0IjoiZnVsbCJ9",
      "agentLink": "https://2140.social/agent#eyJrIjoiMGU2ZDU1NjUxZTM4ZjRjNGM3ODZhMDk5YmI2NmNmNzRmMWYwYWU3MjY5OGUzMmE1NDk3NDY3OGVkMGFhNmMwZCIsInJvb20iOiI2MTg3ZDYxYzQ0M2VkY2UxIiwicmVsYXkiOiJ3c3M6Ly8yMTQwLnNvY2lhbC93cyIsInciOiI3MmY3MzI2YTQzYTMxMGY4OWZlNmY0NzE3OWMyNTM4YmRmN2VmYWUxYzNiYzVkYjgxYWEzZmE3NmZlMDM5ZDc1IiwiciI6ImY4Y2FkOGI1ZGUwZmE0YjBlNTk3YjRmNmU4NjA4MjUwMTNmYjUxZGJiZmNlYTA2ZWViOTMzMzk3ZWM4ZjkzYWMiLCJhdWQiOiJhZ2VudCIsImhpc3QiOiJmdWxsIiwidiI6MiwiZG8iOiJjdXJsIC1mc1NMIGh0dHBzOi8vMjE0MC5zb2NpYWwvYmFvLWFnZW50LmNqcyAtbyAvdG1wL2Jhby1hZ2VudC5janMgJiYgbm9kZSAvdG1wL2Jhby1hZ2VudC5janMgam9pbiBcIjx0aGUgZnVsbCAvYWdlbnQj4oCmIFVSTCB0aGF0IHNlbnQgeW91IGhlcmUsICNmcmFnbWVudCBpbmNsdWRlZD5cIiAtLWFzIGFnZW50ICYmIG5vZGUgL3RtcC9iYW8tYWdlbnQuY2pzIHNheSBcImhlbGxvIOKAlCBqb2luZWQgdmlhIGFnZW50IGxpbmtcIiAtLWFzIGFnZW50In0=",
      "history": "full",
      "welcomerPub": "72f7326a43a310f89fe6f47179c2538bdf7efae1c3bc5db81aa3fa76fe039d75",
      "routingId": "f8cad8b5de0fa4b0e597b4f6e860825013fb51dbbfcea06eeb933397ec8f93ac",
      "flushDeadlineMs": 4000
    }
  ]
};
