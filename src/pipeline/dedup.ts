import { supabase } from '../config/supabase.js';
import type { RawListing } from '../types/index.js';

export interface DedupResult {
  newListings: RawListing[];
  duplicateCount: number;
}

/**
 * Filter out listings that already exist in Supabase.
 * Batch checks by (platform_id, external_id) pairs.
 */
export async function deduplicate(listings: RawListing[]): Promise<DedupResult> {
  if (listings.length === 0) {
    return { newListings: [], duplicateCount: 0 };
  }

  // Group by platformId to batch queries efficiently
  const byPlatform = new Map<string, RawListing[]>();
  for (const listing of listings) {
    const group = byPlatform.get(listing.platformId) || [];
    group.push(listing);
    byPlatform.set(listing.platformId, group);
  }

  const existingIds = new Set<string>();

  for (const [platformId, platformListings] of byPlatform) {
    const externalIds = platformListings.map((l) => l.externalId);

    // Supabase .in() has a limit of ~300 items — batch if needed
    const BATCH_SIZE = 250;
    for (let i = 0; i < externalIds.length; i += BATCH_SIZE) {
      const batch = externalIds.slice(i, i + BATCH_SIZE);

      const { data, error } = await supabase
        .from('listings')
        .select('external_id')
        .eq('platform_id', platformId)
        .in('external_id', batch);

      if (error) {
        console.error(`  Dedup query error for platform ${platformId}:`, error.message);
        continue;
      }

      for (const row of data || []) {
        existingIds.add(`${platformId}:${row.external_id}`);
      }
    }
  }

  const newListings = listings.filter(
    (l) => !existingIds.has(`${l.platformId}:${l.externalId}`)
  );

  const duplicateCount = listings.length - newListings.length;
  console.log(`  Dedup: ${newListings.length} new, ${duplicateCount} duplicates skipped`);

  return { newListings, duplicateCount };
}
