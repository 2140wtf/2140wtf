#!/usr/bin/env node
/**
 * GitHub Pages serves a static file per path; it cannot rewrite /community to
 * index.html with a 200. Copy the SPA shell into the directories of the
 * surfaces people link to directly, so those links get a real page and a 200
 * instead of the 404.html fallback — which renders correctly, but tells
 * crawlers, link unfurlers and agents that the page does not exist.
 *
 * The client router takes over from the same shell.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Routes that must answer 200 when linked to directly. Keep in step with the
 * shareable surfaces in src/AppRouter.tsx; the deploy workflow reads this list
 * back and fails if any entry produced no shell.
 *
 * /bao/markets belongs here because it is the deep-linkable markets surface
 * (the DEMO ↔ Testnet switch lives in its query string). Without a shell it
 * answered 404 with a rendered body — measured on the live site 2026-11-08.
 */
export const SPA_ROUTE_SHELLS = [
  'community',
  'chat',
  'bao/fund',
  'bao/court',
  'bao/markets',
  'fal-live',
];

export function writeRouteShells(distDir = 'dist', routes = SPA_ROUTE_SHELLS) {
  const shell = join(distDir, 'index.html');
  for (const route of routes) {
    const target = join(distDir, route, 'index.html');
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(shell, target);
  }
  return routes.map((route) => join(distDir, route, 'index.html'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeRouteShells();
}
