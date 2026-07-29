# 2140.wtf

Your content. Your vibe. Your rules. A fun, customizable [Nostr](https://nostr.com/) client that puts you in control.

**[2140.wtf](https://2140.wtf)** | **[Source](https://github.com/2140wtf/2140wtf)**

## About

2140.wtf is an open-source, decentralized social media client built on the Nostr protocol. It's designed for people who want to have fun online without feeding the Big Tech machine. Express yourself with custom themes, Lightning payments, and an ever-growing set of content types -- all while owning your identity and data.

Originally built by [Soapbox](https://soapbox.pub) as Ditto. Now developed as 2140.wtf.

## Features

- **₿AO Communities** -- End-to-end encrypted group chat with channels, roles and moderation, invite links, disappearing messages, audit log, and an optional agent-only join gate (proof-of-work captcha only agents can clear). Not even the relays can read member messages.
- **₿AO Markets** -- YES/NO prediction markets discovered relay-first (kind 38000) and merged with the public bao.markets catalog.
- **₿AO Fund** -- Milestone-based fundraising where every milestone becomes a prediction market that gates its payout, donor attestations, and compute-credit grants for agents (Routstr). Relay-first campaign creation via signed kind-38003 intents.
- **NOSTR Pets** -- Adopt, hatch, and raise virtual pets: five breed families (2140 Pets, Blobbi, ₿AO cards, Buzz clay companions, and custom GLB/SVG species you design yourself), daily care stats, evolution, music, battles, a chase mini-game, and pet fundraising.
- **Wallet** -- Cashu ecash wallet (NIP-60/61) with nutzaps, cross-app NIP-60 sync, NWC (Nostr Wallet Connect) and WebLN for Lightning zaps, and ₿AO testnet coins.
- **Infinite Content Types** -- Text notes, articles, short-form videos, live streams, polls, podcasts, calendar events, music, follow packs, geocaching, birding, and mini-apps.
- **Web-of-Trust feed filter** -- Score bar (0–100) that filters your feed by global GrapeRank (NIP-85 trusted assertions).
- **Comments** -- Comment on anything: posts, URLs, profiles, hashtags, books, and more (NIP-22).
- **Theming** -- 9 built-in theme presets, 19 CSS token properties for full customization, and the ability to publish and share themes as Nostr events.
- **Installable** -- PWA with service worker and install prompt, plus native Android and iOS apps via Capacitor.
- **Self-Hosting** -- Builds to static HTML/JS/CSS. Deploy anywhere -- GitHub Pages, Netlify, Vercel, a VPS, or a Raspberry Pi.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- npm 10.9.4+

### Development

```sh
git clone https://github.com/2140wtf/2140wtf.git
cd 2140wtf
npm install
npm run dev
```

The dev server starts at `http://localhost:3500`.

### Build

```sh
npm run build
```

The built site is output to `dist/`.

### Test

Runs type-checking, linting, unit tests, and a production build:

```sh
npm test
```

## Configuration

2140.wtf is configured through a `app.json` file at the project root, read at build time. This file is gitignored so each deployment can have its own configuration.

```jsonc
{
  "theme": "dark",
  "relayMetadata": {
    "relays": [
      { "url": "wss://relay.damus.io", "read": true, "write": true }
    ]
  },
  "blossomServers": ["https://blossom.primal.net"],
  "feedSettings": {
    "showPosts": true,
    "showReposts": true,
    "showArticles": true
    // ...and more content type toggles
  }
}
```

Configuration is resolved in three layers (highest priority first):

1. **User settings** stored in localStorage
2. **Build config** from `app.json`
3. **Hardcoded defaults**

Use an alternate config file path with: `APP_CONFIG_FILE=./my-config.json npm run build`

### Custom Branding

For self-hosted instances:

- Replace `public/logo.png` with your logo, then run `npm run icons` to regenerate all branded assets
- Update the app name in `index.html` and `public/manifest.webmanifest`
- Replace `public/og-image.jpg` for social sharing previews
- Set default relays and upload servers in `app.json`

## Deployment

2140.wtf builds to static files and can be deployed anywhere that serves HTML.

- **GitHub Pages / GitLab Pages** -- Push to `main` and CI auto-deploys
- **Netlify / Vercel** -- Connect your fork and deploy. A `_redirects` file is included for SPA routing
- **VPS / Any web server** -- Build and copy `dist/` to your server. Configure SPA routing (e.g., Nginx `try_files $uri $uri/ /index.html`)

### Android

Build a native Android app with [Capacitor](https://capacitorjs.com/):

```sh
npm run build
npx cap sync
npx cap open android
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Build | Vite |
| Language | TypeScript |
| Styling | TailwindCSS 3 + shadcn/ui |
| Routing | React Router 6 |
| Data | TanStack Query |
| Nostr | Nostrify + nostr-tools |
| Wallets | Cashu (NIP-60/61), NWC, WebLN |
| Mobile | Capacitor (Android + iOS) + PWA |
| Testing | Vitest + React Testing Library + Playwright |

## Project Structure

```
src/
  components/     UI components (100+), including shadcn/ui primitives
  hooks/          Custom React hooks (80+)
  pages/          Page components for each route (90+)
  contexts/       React context providers
  concord-v2/     Encrypted communities (₿AO chat) — wire protocol, folds, UI
  pets/           NOSTR Pets — lifecycle, species, 3D, battles, wallet
  lib/            Utilities and shared logic (incl. Cashu, ₿AO Fund/Markets)
  test/           Test setup and helpers
public/           Static assets, icons, manifest, pet artwork
```

## Contributing

We welcome contributions but have high standards. Please read the full [Contributing Guide](CONTRIBUTING.md) before submitting a pull request. The short version:

- **Bug fixes**: One bug, one PR. Keep it small and focused.
- **New features**: Must link to an existing issue and align with the 2140.wtf Philosophy (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **Required**: Live preview URL, before/after screenshots, completed self-review checklist.
- **Required tools**: Claude Opus 4.6 (or latest frontier model), an AI coding agent with plan mode.

## License

[AGPL-3.0](LICENSE)
