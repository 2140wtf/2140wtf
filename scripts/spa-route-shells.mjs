#!/usr/bin/env node
/**
 * GitHub Pages serves a static file per path; it cannot rewrite /community to
 * index.html with a 200. Copy the SPA shell into the directories for the chat
 * surfaces so direct links get a real page (and a 200/301) instead of 404.
 * The client router takes over from the same shell.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const routes = ['community', 'chat', 'bao/fund', 'bao/court', 'fal-live'];
for (const route of routes) {
  const target = join('dist', route, 'index.html');
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join('dist', 'index.html'), target);
}
