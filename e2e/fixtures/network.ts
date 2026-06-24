import type { ConsoleMessage, Page, Request, Response, WebSocket } from '@playwright/test';

export interface NetworkFailure {
  kind: 'requestfailed' | 'response-error' | 'console-error' | 'websocket-close' | 'websocket-error' | 'page-error';
  url: string;
  detail: string;
}

export interface AttachOptions {
  /** If true, WebSocket errors/closes to Nostr relays are not treated as failures. */
  tolerateRelayErrors?: boolean;
}

const IGNORED_CONSOLE_PATTERNS = [
  /React Router Future Flag Warning/,
  /Download the React DevTools/,
  /WebSocket connection to 'wss:\/\/[^']+' failed/,
];

function shouldIgnoreConsole(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

export class NetworkMonitor {
  private failures: NetworkFailure[] = [];
  private options: AttachOptions;

  constructor(options: AttachOptions = {}) {
    this.options = options;
  }

  attach(page: Page): void {
    page.on('requestfailed', (request: Request) => {
      const url = request.url();
      const errorText = request.failure()?.errorText ?? 'unknown';
      // Requests aborted by navigation are not app failures.
      if (errorText === 'net::ERR_ABORTED') return;
      if (this.options.tolerateRelayErrors && this.isRelayUrl(url)) return;
      this.failures.push({
        kind: 'requestfailed',
        url,
        detail: `${request.method()} ${errorText}`,
      });
    });

    page.on('response', (response: Response) => {
      const status = response.status();
      if (status >= 400) {
        const url = response.url();
        if (this.options.tolerateRelayErrors && this.isRelayUrl(url)) return;
        this.failures.push({
          kind: 'response-error',
          url,
          detail: `HTTP ${status}`,
        });
      }
    });

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (shouldIgnoreConsole(text)) return;
        this.failures.push({
          kind: 'console-error',
          url: page.url(),
          detail: text.slice(0, 500),
        });
      }
    });

    page.on('pageerror', (error: Error) => {
      this.failures.push({
        kind: 'page-error',
        url: page.url(),
        detail: `${error.message}\n${error.stack?.slice(0, 500) ?? ''}`,
      });
    });

    page.on('websocket', (ws: WebSocket) => {
      ws.on('close', () => {
        if (this.options.tolerateRelayErrors && this.isRelayUrl(ws.url())) return;
        this.failures.push({
          kind: 'websocket-close',
          url: ws.url(),
          detail: 'WebSocket closed',
        });
      });
      ws.on('error', (error: string) => {
        if (this.options.tolerateRelayErrors && this.isRelayUrl(ws.url())) return;
        this.failures.push({
          kind: 'websocket-error',
          url: ws.url(),
          detail: error.slice(0, 500),
        });
      });
    });
  }

  getFailures(): NetworkFailure[] {
    return this.failures;
  }

  assertNoFailures(): void {
    if (this.failures.length > 0) {
      const summary = this.failures
        .map((f) => `[${f.kind}] ${f.url} — ${f.detail}`)
        .join('\n');
      throw new Error(`Network/console failures detected:\n${summary}`);
    }
  }

  private isRelayUrl(url: string): boolean {
    return url.startsWith('wss://') || url.startsWith('ws://');
  }
}

export interface TimingResult {
  loadTime: number;
  domContentLoaded: number;
}

export async function measurePageLoad(page: Page, url: string): Promise<TimingResult> {
  const start = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  const loadTime = Date.now() - start;
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
    };
  });
  return { loadTime, domContentLoaded: timing.domContentLoaded };
}
