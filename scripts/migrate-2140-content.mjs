#!/usr/bin/env node
/**
 * Migrate 2140.wtf PrestaShop content into Nostr events.
 *
 * This script is intentionally offline: it reads the local catalog.json,
 * produces signed Nostr events, and writes them to migrated-events.json.
 * It does NOT publish to any relay unless ALLOW_PUBLISH is explicitly set.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from "nostr-tools";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const ALLOW_PUBLISH = process.env.ALLOW_PUBLISH === "true";
if (ALLOW_PUBLISH) {
  console.warn("⚠️ ALLOW_PUBLISH=true — this would publish events. Skipping network calls in this script.");
}

// Generate a throwaway test key. All events are marked as test data.
const sk = generateSecretKey();
const pk = getPublicKey(sk);
console.log("Test pubkey:", pk);

const catalogRaw = await readFile(resolve(root, "..", "catalog.json"), "utf-8");
const catalog = JSON.parse(catalogRaw);

const now = Math.floor(Date.now() / 1000);

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeDtag(prefix, title) {
  return `${prefix}-${slugify(title)}`;
}

function isoToUnix(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

const articleEventKinds = new Set(["article"]);
const eventPages = [
  {
    url: "https://2140.wtf/content/10-bitcoin-halloween-party",
    title: "Bitcoin Whitepaper / Halloween Party",
    summary: "Bitcoin Whitepaper Day + Halloween Party at Dockside Vaults, London.",
    start: "2024-10-31T18:00:00",
    end: "2024-11-01T00:00:00",
    location: "Dockside Vaults, Ivory House, London",
    tags: ["bitcoin", "halloween", "whitepaper-day", "party"],
  },
  {
    url: "https://2140.wtf/content/11-bitcoin-pizza-day-24",
    title: "Bitcoin Pizza Day '24",
    summary: "Bitcoin Pizza Day art show and live music in central London.",
    start: "2024-05-22T18:00:00",
    end: "2024-05-22T23:00:00",
    location: "Central London",
    tags: ["bitcoin", "pizza-day", "art", "music"],
  },
  {
    url: "https://2140.wtf/content/31-jan3-15-years-of-bitcoin-exhibition-2009-2024",
    title: "JAN3: 15 Years of Bitcoin Exhibition",
    summary: "January 3rd exhibition memorised in the virtual gallery.",
    start: "2024-01-03T10:00:00",
    end: "2024-01-03T22:00:00",
    location: "Virtual gallery / London",
    tags: ["bitcoin", "exhibition", "jan3", "art"],
  },
  {
    url: "https://2140.wtf/content/32-freeassangenow-tribute-exhibition",
    title: "FreeAssangeNow Tribute Exhibition",
    summary: "A virtual exhibition dedicated to Julian Assange and his freedom.",
    start: "2024-01-03T10:00:00",
    end: "2024-01-03T22:00:00",
    location: "Virtual gallery",
    tags: ["bitcoin", "assange", "exhibition", "virtual"],
  },
  {
    url: "https://2140.wtf/content/33-berlin-meetup-6-9-june-24",
    title: "Berlin Meetup 6-9 June '24",
    summary: "2140 Crew and the Berlin Bitcoiners organised a few days of anti-conference.",
    start: "2024-06-06T10:00:00",
    end: "2024-06-09T22:00:00",
    location: "Berlin",
    tags: ["bitcoin", "meetup", "berlin"],
  },
  {
    url: "https://2140.wtf/content/44-nostr-london",
    title: "Nostr London",
    summary: "#NOSTRLDN — Purple is for everyone Open Source Day. Culture of Code Art Gallery and #nostrldn MeetUp.",
    start: "2024-11-01T10:00:00",
    end: "2024-11-01T22:00:00",
    location: "Cyphermunk House, London",
    tags: ["nostr", "nostrldn", "bitcoin", "opensource", "meetup"],
  },
  {
    url: "https://2140.wtf/content/46-art-panel",
    title: "Art / Culture Panel",
    summary: "Art / Culture Panel with discussion panels, art, music, literature, and cocktail party.",
    start: "2024-11-02T10:00:00",
    end: "2024-11-02T22:00:00",
    location: "Cyphermunk House, 9 John Street, Bloomsbury, London",
    tags: ["art", "culture", "panel", "bitcoin", "nostr"],
  },
  {
    url: "https://2140.wtf/content/47-private-viewing",
    title: "Private Viewing",
    summary: "Private viewing of Culture of Code art exhibition.",
    start: "2024-10-29T18:30:00",
    end: "2024-10-29T20:30:00",
    location: "Cyphermunk House, London",
    tags: ["art", "exhibition", "private-viewing"],
  },
  {
    url: "https://2140.wtf/content/43-tooting-market",
    title: "Tooting Market Meetup",
    summary: "Meetup with Bitcoin merchants by 2140 Collective at Tooting Market.",
    start: "2024-10-30T17:00:00",
    end: "2024-10-30T23:00:00",
    location: "Tooting Market, London",
    tags: ["bitcoin", "merchants", "tooting", "meetup"],
  },
  {
    url: "https://2140.wtf/content/52-bitcoin-cypherpunk-tattoo-session",
    title: "Bitcoin Cypherpunk Tattoo Session",
    summary: "Tattoo session with Bitcoin tattoo artists Zazawowow and Fzero at Cyphermunk House.",
    start: "2024-11-02T12:00:00",
    end: "2024-11-02T20:00:00",
    location: "Cyphermunk House, London",
    tags: ["bitcoin", "tattoo", "cypherpunk", "art"],
  },
];

const events = [];

function addPublishedAt(tags) {
  if (!tags.some((t) => t[0] === "published_at")) {
    tags.push(["published_at", String(now)]);
  }
  return tags;
}

// Build About Us article
const aboutEntry = catalog["https://2140.wtf/content/35-about-us"];
if (aboutEntry) {
  const content = [
    "# About 2140",
    "",
    aboutEntry.text_preview || "",
    "",
    "---",
    "",
    "Migrated from 2140.wtf PrestaShop site. Signed with a test key for local development.",
  ].join("\n");

  const tags = [
    ["d", "about-us"],
    ["title", "About 2140"],
    ["summary", "2140.wtf is a Bitcoin culture collective promoting the tools of freedom through art, film, music, and Nostr."],
    ["image", "https://2140.wtf/img/logo-1746639749.jpg"],
    ["t", "2140"],
    ["t", "about"],
    ["t", "bitcoin"],
    ["t", "nostr"],
  ];
  addPublishedAt(tags);

  events.push(
    finalizeEvent(
      {
        kind: 30023,
        created_at: now,
        content,
        tags,
      },
      sk,
    ),
  );
  console.log("Created article: About 2140");
}

// Build calendar events
for (const ev of eventPages) {
  const entry = catalog[ev.url];
  if (!entry) {
    console.warn("Missing catalog entry:", ev.url);
    continue;
  }

  const startUnix = isoToUnix(ev.start);
  const endUnix = isoToUnix(ev.end);
  const startDay = Math.floor(startUnix / 86400);
  const endDay = Math.floor(endUnix / 86400);

  const tags = [
    ["d", makeDtag("event", ev.title)],
    ["title", ev.title],
    ["summary", ev.summary],
    ["start", String(startUnix)],
    ["end", String(endUnix)],
    ["start_tzid", "Europe/London"],
    ["end_tzid", "Europe/London"],
    ["location", ev.location],
    ["image", "https://2140.wtf/img/logo-1746639749.jpg"],
    ["t", "2140-event"],
    ...ev.tags.map((t) => ["t", t]),
  ];
  for (let d = startDay; d <= endDay; d++) {
    tags.push(["D", String(d)]);
  }
  addPublishedAt(tags);

  const content = [
    `## ${ev.title}`,
    "",
    entry.text_preview || ev.summary,
    "",
    `**When:** ${ev.start} → ${ev.end} (Europe/London)`,
    "",
    `**Where:** ${ev.location}`,
    "",
    `**Original URL:** ${ev.url}`,
    "",
    "---",
    "",
    "Migrated from 2140.wtf PrestaShop site. Signed with a test key for local development.",
  ].join("\n");

  events.push(
    finalizeEvent(
      {
        kind: 31923,
        created_at: now,
        content,
        tags,
      },
      sk,
    ),
  );
  console.log("Created calendar event:", ev.title);
}

await writeFile(
  resolve(root, "migrated-events.json"),
  JSON.stringify(events, null, 2),
);

console.log(`\n✅ Generated ${events.length} events and saved to migrated-events.json`);
console.log("Test pubkey:", pk);
console.log("No events were published to any relay.");
if (!ALLOW_PUBLISH) {
  console.log("Set ALLOW_PUBLISH=true to enable publishing in a future step.");
}
