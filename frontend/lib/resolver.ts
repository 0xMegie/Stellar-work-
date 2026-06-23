// Resolver abstraction for job description storage backends.
//
// Consumers call `resolveJobDescription(hash)` without knowing whether the
// text comes from localStorage, IPFS, or any future backend.  Swapping
// storage implementations only requires changing this file, not every caller.

import { resolveDescription } from '@/lib/storage';

export type DescriptionBackend = 'localStorage' | 'ipfs' | 'unavailable';

export interface ResolvedDescription {
  text: string;
  backend: DescriptionBackend;
}

const UNAVAILABLE: ResolvedDescription = {
  text: 'Description unavailable',
  backend: 'unavailable',
};

/**
 * Resolve a job description hash to human-readable text.
 *
 * Resolution order (delegated to storage.ts):
 *   1. localStorage  → backend: 'localStorage'
 *   2. IPFS gateway  → backend: 'ipfs'
 *   3. null          → backend: 'unavailable'
 *
 * Pass `pinataGateway` (NEXT_PUBLIC_PINATA_GATEWAY) to enable IPFS fallback.
 */
export async function resolveJobDescription(
  hash: string,
  pinataGateway?: string,
): Promise<ResolvedDescription> {
  if (!hash) return UNAVAILABLE;

  // Check localStorage synchronously first (fast path via storage module).
  const fromStorage = await resolveDescription(hash, undefined);
  if (fromStorage !== null) {
    return { text: fromStorage, backend: 'localStorage' };
  }

  // IPFS fallback — only attempted when a gateway is configured.
  if (pinataGateway) {
    const fromIpfs = await resolveDescription(hash, pinataGateway);
    if (fromIpfs !== null) {
      return { text: fromIpfs, backend: 'ipfs' };
    }
  }

  return UNAVAILABLE;
}

/**
 * Resolve descriptions for a batch of hashes concurrently.
 * Returns a map of hash → ResolvedDescription.
 */
export async function resolveJobDescriptions(
  hashes: string[],
  pinataGateway?: string,
): Promise<Map<string, ResolvedDescription>> {
  const unique = [...new Set(hashes.filter(Boolean))];
  const results = await Promise.all(
    unique.map(async (hash) => [hash, await resolveJobDescription(hash, pinataGateway)] as const),
  );
  return new Map(results);
}
