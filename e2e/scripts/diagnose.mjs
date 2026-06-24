import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

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

const appId = '2140wtf';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', (msg) => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}\n${err.stack}`));
page.on('requestfailed', (req) => console.log(`[requestfailed] ${req.method()} ${req.url()} : ${req.failure()?.errorText}`));

await context.addInitScript((args) => {
  const { loginPayload, appId, pubkey } = args;
  localStorage.setItem('nostr:login', loginPayload);
  localStorage.setItem(`${appId}:sync-done:${pubkey}`, '1');
  localStorage.setItem(`${appId}:settings-lastSync:${pubkey}`, String(Date.now()));
}, { loginPayload: JSON.stringify([login]), appId, pubkey });

await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(5000);

console.log('URL:', page.url());
const storage = await page.evaluate(() => Object.entries(localStorage));
console.log('localStorage:', JSON.stringify(storage, null, 2));
console.log('Body text length:', (await page.locator('body').textContent()).length);
console.log('HTML snippet:', await page.locator('body').innerHTML().then((h) => h.slice(0, 1200)));

await browser.close();
