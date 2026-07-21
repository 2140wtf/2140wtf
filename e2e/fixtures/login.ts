import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

function getAppId(): string {
  try {
    const configPath = path.resolve(process.cwd(), 'e2e/fixtures/ditto.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { appId?: string };
    return parsed.appId ?? '2140wtf';
  } catch {
    return '2140wtf';
  }
}

export interface TestLogin {
  pubkey: string;
  nsec: string;
  payload: string;
}

export function generateTestLogin(): TestLogin {
  const sk = generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  const pubkey = getPublicKey(sk);
  const login = {
    id: `nsec:${pubkey}`,
    type: 'nsec',
    pubkey,
    createdAt: new Date().toISOString(),
    data: { nsec },
  };
  return { pubkey, nsec, payload: JSON.stringify([login]) };
}

export async function injectTestLogin(page: Page): Promise<TestLogin> {
  const login = generateTestLogin();
  const appId = getAppId();
  const syncDoneKey = `${appId}:sync-done:${login.pubkey}`;
  const lastSyncKey = `${appId}:settings-lastSync:${login.pubkey}`;

  await page.context().addInitScript((value: string) => {
    localStorage.setItem('nostr:login', value);
  }, login.payload);

  await page.context().addInitScript((kv: { syncDoneKey: string; lastSyncKey: string; lastSync: number }) => {
    localStorage.setItem(kv.syncDoneKey, '1');
    localStorage.setItem(kv.lastSyncKey, String(kv.lastSync));
  }, {
    syncDoneKey,
    lastSyncKey,
    lastSync: Date.now(),
  });

  return login;
}

export async function seedLocalStorage<T>(page: Page, key: string, value: T): Promise<void> {
  await page.context().addInitScript((kv: { key: string; value: string }) => {
    localStorage.setItem(kv.key, kv.value);
  }, { key, value: JSON.stringify(value) });
}
