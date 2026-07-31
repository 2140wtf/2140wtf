import path from "node:path";

// Bundles the ₿AO chat MCP server (scripts/bao-chat-mcp.ts) into a plain
// node ESM file under .tmp/ (gitignored), resolving the app's "@" alias.
// App deps stay external (node_modules).
//   node_modules/.bin/rolldown -c scripts/rolldown.bao-chat-mcp.config.mjs
export default {
  input: path.resolve(import.meta.dirname, "bao-chat-mcp.ts"),
  platform: "node",
  external: [/^nostr-tools/, /^@noble/, /^nostrify/, /^ws$/, /^@modelcontextprotocol/, /^zod$/],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
    extensions: [".ts", ".mjs", ".js"],
  },
  output: {
    file: path.resolve(import.meta.dirname, "../.tmp/bao-chat-mcp.mjs"),
    format: "esm",
  },
};
