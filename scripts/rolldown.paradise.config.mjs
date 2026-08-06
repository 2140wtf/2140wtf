import path from "node:path";

// Bundles the Paradise autonomous-agent CLI (scripts/paradise.ts) into a plain
// node ESM file under .tmp/ (gitignored), resolving the app's "@" alias. App
// deps stay external (node_modules).
//   node_modules/.bin/rolldown -c scripts/rolldown.paradise.config.mjs
export default {
  input: path.resolve(import.meta.dirname, "paradise.ts"),
  platform: "node",
  external: [/^nostr-tools/, /^@noble/, /^nostrify/, /^ws$/],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
    extensions: [".ts", ".mjs", ".js"],
  },
  output: {
    file: path.resolve(import.meta.dirname, "../.tmp/paradise.mjs"),
    format: "esm",
  },
};
