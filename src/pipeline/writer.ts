import { supabase } from '../config/supabase.js';
import type { RawListing, ScoreResult, ScoredListing } from '../types/index.js';

/** Insert scored listings into Supabase. Returns the inserted rows with IDs. */
export async function writeListings(
  listings: RawListing[],
  scores: Map<RawListing, ScoreResult>
): Promise<ScoredListing[]> {
  if (listings.length === 0) return [];

  const rows = listings.map((listing) => {
    const score = scores.get(listing);
    return {
      platform_id: listing.platformId,
      external_id: listing.externalId,
      title: listing.title,
      description: listing.description || null,
      url: listing.url,
      budget_min: listing.budgetMin,
      budget_max: listing.budgetMax,
      budget_type: listing.budgetType,
      skills_required: listing.skillsRequired,
      client_info: listing.clientInfo,
      fit_score: score?.score ?? null,
      fit_reasoning: score?.reasoning ?? null,
      fit_keywords_matched: score?.matchedKeywords ?? [],
      status: 'new',
      posted_at: listing.postedAt,
    };
  });

  // Insert in batches to avoid payload size limits
  const BATCH_SIZE = 50;
  const inserted: ScoredListing[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('listings')
      .upsert(batch, { onConflict: 'platform_id,external_id', ignoreDuplicates: true })
      .select();

    if (error) {
      console.error(`  Write error (batch ${i / BATCH_SIZE + 1}):`, error.message);
      continue;
    }

    if (data) {
      for (const row of data) {
        inserted.push({
          platformId: row.platform_id,
          externalId: row.external_id,
          title: row.title,
          description: row.description || '',
          url: row.url,
          budgetMin: row.budget_min,
          budgetMax: row.budget_max,
          budgetType: row.budget_type || 'not_specified',
          skillsRequired: row.skills_required || [],
          clientInfo: row.client_info || {},
          postedAt: row.posted_at,
          fitScore: row.fit_score ?? 0,
          fitReasoning: row.fit_reasoning || '',
          fitKeywordsMatched: row.fit_keywords_matched || [],
        });
      }
    }
  }

  console.log(`  Writer: ${inserted.length}/${listings.length} listings saved to Supabase`);
  return inserted;
}
