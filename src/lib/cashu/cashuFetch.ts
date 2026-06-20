/**
 * SSRF-hardened fetch wrapper for Cashu mint communication.
 *
 * cashu-ts exposes a pluggable `request` function to CashuMint/CashuWallet.
 * This module provides a factory that returns a request function which:
 *   - re-validates every request URL against the allowed-mint list,
 *   - forces `redirect: 'manual'` so mints cannot redirect us elsewhere,
 *   - rejects 3xx responses before any response body is read,
 *   - attaches a per-request abort timeout so network calls cannot hang forever.
 */
import { isAllowedMintUrl } from '@/lib/cashu/cashu';
import { devLog } from '@/lib/cashu/devLog';

export type MintRequestOptions = {
  endpoint: string;
  requestBody?: Record<string, unknown>;
  headers?: Record<string, string>;
} & Omit<RequestInit, 'body' | 'headers'>;

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function isAllowedMintEndpoint(endpoint: string, allowedUrls: string[]): boolean {
  if (!isAllowedMintUrl(endpoint)) return false;
  if (allowedUrls.length === 0) return true;
  try {
    const u = new URL(endpoint);
    return allowedUrls.some((allowed) => {
      try {
        const a = new URL(allowed);
        const basePath = a.pathname.replace(/\/+$/, '');
        const endpointPath = u.pathname;
        const endpointPathLower = endpointPath.toLowerCase();
        const basePathLower = basePath.toLowerCase();
        const isPathMatch =
          endpointPathLower === basePathLower ||
          endpointPathLower.startsWith(basePathLower + '/');
        return (
          u.protocol === a.protocol &&
          u.host.toLowerCase() === a.host.toLowerCase() &&
          isPathMatch
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Create a Cashu-compatible request function hardened against SSRF and
 * unwanted redirects.
 *
 * @param allowedUrls Known mint base URLs that requests are allowed to target.
 */
export function createMintFetch(allowedUrls: string[]) {
  return async function mintFetch<T>(options: MintRequestOptions): Promise<T> {
    const { endpoint, requestBody, headers, ...rest } = options;

    if (!isAllowedMintEndpoint(endpoint, allowedUrls)) {
      throw new Error(`Mint URL is not allowed: ${endpoint}`);
    }

    const body = requestBody ? JSON.stringify(requestBody) : undefined;
    // Per-request timeout prevents hung mint connections from leaking forever.
    // Callers may pass their own signal via `rest.signal`.
    const signal = rest.signal ?? AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        ...rest,
        method: rest.method ?? 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...(body ? { 'Content-Type': 'application/json' } : undefined),
          ...headers,
        },
        body,
        signal,
        redirect: 'manual',
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
        throw new Error('Mint request was aborted');
      }
      devLog.warn('Mint network request failed:', endpoint, err);
      throw new Error(err instanceof Error ? err.message : 'Network request failed');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Mint redirect blocked (${response.status})`);
    }

    if (!response.ok) {
      let detail: string;
      try {
        const json = await response.json();
        detail =
          (json && typeof json.detail === 'string' && json.detail) ||
          (json && typeof json.error === 'string' && json.error) ||
          `HTTP ${response.status}`;
      } catch {
        detail = `HTTP ${response.status}`;
      }
      throw new Error(detail);
    }

    try {
      return (await response.json()) as T;
    } catch (err: unknown) {
      devLog.warn('Mint returned non-JSON response:', endpoint, err);
      throw new Error('Mint returned an invalid response');
    }
  };
}
