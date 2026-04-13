import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { RawListing, SkillProfile, ScoreResult, TokenUsage } from '../types/index.js';

// Claude Haiku pricing (per token)
const HAIKU_INPUT_PRICE = 0.80 / 1_000_000;   // $0.80 per 1M input tokens
const HAIKU_OUTPUT_PRICE = 4.00 / 1_000_000;   // $4.00 per 1M output tokens

const SCORING_DELAY_MS = 500;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required for AI scoring');
    }
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

/** Build the scoring prompt for a single listing */
function buildPrompt(listing: RawListing, profile: SkillProfile): string {
  return `You are a freelance gig evaluator. Score how well this listing matches the freelancer's profile. Respond in JSON only — no markdown, no code fences, just the raw JSON object.

SCORING GUIDE:
- 90-100: Perfect niche match. Apply immediately.
- 70-89: Strong match worth reviewing. Core skills align.
- 50-69: Adjacent but not ideal. Some relevance.
- 30-49: Weak match. Mostly irrelevant.
- 0-29: No match. Skip entirely.

FREELANCER PROFILE:
- Niche: ${profile.niche_description}
- Keywords (positive signals): ${profile.keywords.join(', ')}
- Anti-keywords (red flags to score DOWN): ${profile.anti_keywords.join(', ')}
- Budget range: $${profile.min_budget} - $${profile.max_budget || 'no max'}

LISTING:
- Title: ${listing.title}
- Description: ${listing.description || 'No description provided'}
- Budget: ${listing.budgetMin ? `$${listing.budgetMin}` : '?'} - ${listing.budgetMax ? `$${listing.budgetMax}` : '?'} (${listing.budgetType})
- Skills: ${listing.skillsRequired.join(', ') || 'none listed'}

Respond with: {"score": <0-100>, "reasoning": "<1-2 sentences>", "matched_keywords": ["keyword1", "keyword2"]}`;
}

/** Score a single listing against a skill profile using Claude Haiku */
export async function scoreListing(
  listing: RawListing,
  profile: SkillProfile
): Promise<ScoreResult> {
  const anthropic = getClient();
  const prompt = buildPrompt(listing, profile);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;

    // Parse JSON from response — handle potential wrapping
    const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(jsonStr);

    return {
      score: Math.max(0, Math.min(100, Number(result.score) || 0)),
      reasoning: String(result.reasoning || ''),
      matchedKeywords: Array.isArray(result.matched_keywords)
        ? result.matched_keywords.map(String)
        : [],
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    console.error(`    Scoring failed for "${listing.title}":`, err instanceof Error ? err.message : err);
    return {
      score: 0,
      reasoning: 'Scoring failed — could not parse AI response',
      matchedKeywords: [],
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

export interface ScoringBatchResult {
  scores: Map<RawListing, ScoreResult>;
  tokenUsage: TokenUsage;
}

/** Score a batch of listings sequentially with rate limiting */
export async function scoreListings(
  listings: RawListing[],
  profile: SkillProfile
): Promise<ScoringBatchResult> {
  const scores = new Map<RawListing, ScoreResult>();
  let totalInput = 0;
  let totalOutput = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    console.log(`    Scoring ${i + 1}/${listings.length}: ${listing.title.slice(0, 60)}`);

    const result = await scoreListing(listing, profile);
    scores.set(listing, result);
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;

    console.log(`      → ${result.score}/100 (${result.inputTokens}+${result.outputTokens} tokens): ${result.reasoning.slice(0, 80)}`);

    // Rate limit between calls
    if (i < listings.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SCORING_DELAY_MS));
    }
  }

  const estimatedCostUsd = (totalInput * HAIKU_INPUT_PRICE) + (totalOutput * HAIKU_OUTPUT_PRICE);

  console.log(`    Tokens: ${totalInput} in + ${totalOutput} out = ~$${estimatedCostUsd.toFixed(4)}`);

  return {
    scores,
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput, estimatedCostUsd },
  };
}
