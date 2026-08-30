import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => console.log(`[console:${m.type()}] ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/shot1.png', fullPage: true });

// Try clicking through to the widget if there's a button
const buttons = await page.locator('button').allTextContents();
console.log('BUTTONS:', JSON.stringify(buttons));

await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/shot2.png', fullPage: true });

await browser.close();
