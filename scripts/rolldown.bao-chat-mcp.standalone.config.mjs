import path from "node:path";

// Bundles the ₿AO chat MCP server (scripts/bao-chat-mcp.ts) into ONE
// self-contained node ESM file at public/bao-chat-mcp.mjs — every dependency
// inlined (nostr-tools, @noble, @modelcontextprotocol/sdk, zod, the app's
// Concord V2 lib via the "@" alias). An agent registers it with nothing but
// Node 22+ and an identity made with bao-agent.mjs:
//   claude mcp add bao-chat -- node bao-chat-mcp.mjs
// (BAO_AGENT_IDENTITY=<name> selects the ~/.concord-live identity.)
// Rebuild after touching scripts/bao-chat-mcp.ts or scripts/chat-core.ts:
//   npm run mcp:bundle
export default {
  input: path.resolve(import.meta.dirname, "bao-chat-mcp.ts"),
  platform: "node",
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
    extensions: [".ts", ".mjs", ".js"],
  },
  output: {
    file: path.resolve(import.meta.dirname, "../public/bao-chat-mcp.mjs"),
    format: "esm",
    // One single file — nostr-tools uses dynamic imports internally.
    codeSplitting: false,
  },
};
