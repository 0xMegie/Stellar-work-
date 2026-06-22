// IPFS-backed description storage with localStorage cache and fallback chain.
//
// Resolution order for any description:
//   1. localStorage text  (fast, works offline, survives page reload)
//   2. IPFS public gateway via stored CID (cross-session recovery)
//   3. null              (caller shows "unavailable" fallback)
//
// All localStorage calls are wrapped in try/catch so the module never
// crashes in Safari private-browsing mode.

const GATEWAY_TIMEOUT_MS = 5_000;
const DESC_TEXT_PREFIX = 'job-desc:';
const DESC_CID_PREFIX = 'job-ipfs-cid:';

// ── localStorage helpers ──────────────────────────────────────────────────────

export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Safari private mode or storage quota exceeded — swallow silently.
  }
}

// ── IPFS upload via Pinata ────────────────────────────────────────────────────

export interface IpfsUploadOptions {
  pinataJwt: string;
}

/** Upload text content to IPFS via Pinata and return the resulting CID. */
export async function uploadToIpfs(
  text: string,
  options: IpfsUploadOptions,
): Promise<string> {
  const blob = new Blob([text], { type: 'text/plain' });
  const form = new FormData();
  form.append('file', blob, 'job-description.txt');
  // Request CIDv1 from Pinata (more portable than CIDv0).
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const res = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.pinataJwt}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`IPFS upload failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as { data?: { cid?: string } };
  const cid = json.data?.cid;
  if (!cid) throw new Error('IPFS upload succeeded but no CID was returned');
  return cid;
}

// ── IPFS fetch via public gateways ────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromGateways(
  cid: string,
  pinataGateway: string | undefined,
): Promise<string | null> {
  const urls = [
    pinataGateway ? `https://${pinataGateway}/ipfs/${cid}` : null,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://ipfs.io/ipfs/${cid}`,
  ].filter((u): u is string => u !== null);

  for (const url of urls) {
    const text = await fetchWithTimeout(url, GATEWAY_TIMEOUT_MS);
    if (text !== null) return text;
  }
  return null;
}

// ── Description resolution ────────────────────────────────────────────────────

/**
 * Resolve a job description for the given SHA-256 hex hash.
 *
 * Resolution chain:
 *   1. localStorage (instant, no network)
 *   2. IPFS via the CID stored in localStorage (only if pinataGateway is set)
 *   3. Returns null — caller should show its own "unavailable" message
 *
 * IPFS fetching is intentionally skipped when `pinataGateway` is not provided
 * so unit tests run fast without network access.
 */
export async function resolveDescription(
  hash: string,
  pinataGateway?: string,
): Promise<string | null> {
  // Step 1: localStorage text (fast path)
  const cached = safeLocalStorageGet(`${DESC_TEXT_PREFIX}${hash}`);
  if (cached !== null) return cached;

  // Step 2: IPFS via stored CID — only when a gateway is configured
  if (!pinataGateway) return null;

  const cid = safeLocalStorageGet(`${DESC_CID_PREFIX}${hash}`);
  if (!cid) return null;

  const text = await fetchFromGateways(cid, pinataGateway);
  if (text !== null) {
    // Repopulate localStorage so subsequent reads are instant.
    safeLocalStorageSet(`${DESC_TEXT_PREFIX}${hash}`, text);
  }
  return text;
}

/**
 * Store a successfully uploaded description in localStorage.
 * Call this after both the IPFS upload and the contract transaction succeed.
 */
export function cacheDescription(hash: string, text: string, cid: string): void {
  safeLocalStorageSet(`${DESC_TEXT_PREFIX}${hash}`, text);
  safeLocalStorageSet(`${DESC_CID_PREFIX}${hash}`, cid);
}
