/**
 * Provision — re-export layer.
 *
 * The protocol logic has been deepened into two focused modules:
 *   - provision-core.ts: crypto/key derivation, room minting, join links (zero node imports)
 *   - provision-fs.ts:    rooms-file I/O (node:fs, node:crypto, node:path)
 *
 * This module re-exports everything so existing consumers (daemons, demo
 * server, agent CLI) continue to work without changes.
 */
export * from './provision-core.js';
export * from './provision-fs.js';
