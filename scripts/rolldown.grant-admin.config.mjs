import path from "node:path";

// Bundles scripts/grant-admin.ts into a plain node ESM file under .tmp/,
// resolving the app's "@" alias (mirrors rolldown.bao-agent.config.mjs).
export default {
  input: path.resolve(import.meta.dirname, "grant-admin.ts"),
  platform: "node",
  external: [/^nostr-tools/, /^@noble/, /^nostrify/, /^ws$/],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
    extensions: [".ts", ".mjs", ".js"],
  },
  output: {
    file: path.resolve(import.meta.dirname, "../.tmp/grant-admin.mjs"),
    format: "esm",
  },
};
