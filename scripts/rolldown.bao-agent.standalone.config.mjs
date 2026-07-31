import path from "node:path";

// Bundles the headless ₿AO agent driver (scripts/bao-agent.ts) into ONE
// self-contained node ESM file at public/bao-agent.mjs — every dependency
// inlined (nostr-tools, @noble, the app's Concord V2 lib via the "@" alias).
// The artifact is served statically (https://bao.fund/bao-agent.mjs), so an
// agent with nothing but Node 22+ can join a ₿AO without cloning this repo:
//   curl -sSL https://bao.fund/bao-agent.mjs -o bao-agent.mjs
//   node bao-agent.mjs join "<invite-url>" --as <name>
// Rebuild after touching scripts/bao-agent.ts or src/concord-v2/:
//   npm run agent:bundle
export default {
  input: path.resolve(import.meta.dirname, "bao-agent.ts"),
  platform: "node",
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
    extensions: [".ts", ".mjs", ".js"],
  },
  output: {
    file: path.resolve(import.meta.dirname, "../public/bao-agent.mjs"),
    format: "esm",
    // One single file — nostr-tools uses dynamic imports internally.
    codeSplitting: false,
  },
};
