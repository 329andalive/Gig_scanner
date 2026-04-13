import { supabase } from '../config/supabase.js';
import { deduplicate } from './dedup.js';
import { scoreListings } from './scorer.js';
import { writeListings } from './writer.js';
import type { RawListing, SkillProfile, ScoredListing, TokenUsage } from '../types/index.js';

export interface PipelineResult {
  listingsFound: number;
  newListings: number;
  listingsScored: number;
  alertCandidates: ScoredListing[];
  tokenUsage: TokenUsage;
}

/** Get the default skill profile (or first available) */
export async function getDefaultProfile(): Promise<SkillProfile | null> {
  const { data, error } = await supabase
    .from('skill_profiles')
    .select('*')
    .eq('is_default', true)
    .limit(1)
    .single();

  if (error || !data) {
    // Fall back to any profile
    const { data: any, error: anyErr } = await supabase
      .from('skill_profiles')
      .select('*')
      .limit(1)
      .single();

    if (anyErr || !any) {
      console.error('  No skill profile found. Create one in Supabase.');
      return null;
    }
    return any as SkillProfile;
  }

  return data as SkillProfile;
}

/**
 * Run the full pipeline: dedup → score → write.
 * Returns stats and alert candidates (listings above threshold).
 */
export async function runPipeline(
  rawListings: RawListing[],
  profile: SkillProfile
): Promise<PipelineResult> {
  const result: PipelineResult = {
    listingsFound: rawListings.length,
    newListings: 0,
    listingsScored: 0,
    alertCandidates: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  };

  if (rawListings.length === 0) {
    console.log('  Pipeline: no listings to process');
    return result;
  }

  // Step 1: Dedup
  console.log('\n  ── Deduplication ──');
  const { newListings } = await deduplicate(rawListings);
  result.newListings = newListings.length;

  if (newListings.length === 0) {
    console.log('  Pipeline: all listings are duplicates, nothing to score');
    return result;
  }

  // Step 2: Score with Claude AI
  console.log('\n  ── AI Scoring ──');
  const { scores, tokenUsage } = await scoreListings(newListings, profile);
  result.listingsScored = scores.size;
  result.tokenUsage = tokenUsage;

  // Step 3: Write to Supabase
  console.log('\n  ── Writing to Supabase ──');
  const savedListings = await writeListings(newListings, scores);

  // Step 4: Identify alert candidates (score >= threshold)
  const threshold = profile.score_threshold || 70;
  result.alertCandidates = savedListings.filter((l) => l.fitScore >= threshold);

  console.log(`\n  Pipeline complete: ${result.newListings} new → ${result.listingsScored} scored → ${result.alertCandidates.length} above threshold (${threshold})`);

  return result;
}
