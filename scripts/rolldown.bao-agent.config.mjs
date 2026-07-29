import path from "node:path";

// Bundles the headless ₿AO agent driver (scripts/bao-agent.ts) into a plain
// node ESM file under .tmp/ (gitignored), resolving the app's "@" alias.
// App deps stay external (node_modules).
//   node_modules/.bin/rolldown -c scripts/rolldown.bao-agent.config.mjs
export default {
  input: path.resolve(import.meta.dirname, "bao-agent.ts"),
  platform: "node",
  external: [/^nostr-tools/, /^@noble/, /^nostrify/, /^ws$/],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
    extensions: [".ts", ".mjs", ".js"],
  },
  output: {
    file: path.resolve(import.meta.dirname, "../.tmp/bao-agent.mjs"),
    format: "esm",
  },
};
