#!/usr/bin/env node
/**
 * GitHub Pages serves a static file per path; it cannot rewrite /community to
 * index.html with a 200. Copy the SPA shell into the paths of the surfaces
 * people link to directly, so those links get a real page and a 200 instead of
 * the 404.html fallback — which renders correctly, but tells crawlers, link
 * unfurlers and agents that the page does not exist.
 *
 * Two shapes are written per route, because GitHub Pages treats them
 * differently:
 *
 *   dist/<route>.html          → /<route>          answered directly, 200
 *   dist/<route>/index.html    → /<route>/         answered directly, 200
 *                              ( /<route> 301s here when only this exists )
 *
 * The flat file is what removes the redirect: Pages resolves an extensionless
 * path to `<path>.html` — verified on the live site, where /404 serves
 * dist/404.html with a 200 and text/html — while a directory of the same name
 * makes it 301 to the trailing-slash form instead. Shipping both means neither
 * URL 404s, whichever shape the CDN prefers, and existing links that already
 * carry the trailing slash keep working.
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
  const written = [];
  for (const route of routes) {
    for (const target of [join(distDir, `${route}.html`), join(distDir, route, 'index.html')]) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(shell, target);
      written.push(target);
    }
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeRouteShells();
}
