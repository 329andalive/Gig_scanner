// ── Raw listing from scrapers (before scoring) ─────────────
export interface RawListing {
  platformId: string;
  externalId: string;
  title: string;
  description: string;
  url: string;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetType: 'fixed' | 'hourly' | 'not_specified';
  skillsRequired: string[];
  clientInfo: Record<string, unknown>;
  postedAt: string | null;
}

// ── Scored listing (after Claude AI evaluation) ─────────────
export interface ScoredListing extends RawListing {
  fitScore: number;
  fitReasoning: string;
  fitKeywordsMatched: string[];
}

// ── Database row types ──────────────────────────────────────
export interface Platform {
  id: string;
  name: string;
  base_url: string;
  scraper_type: string;
  is_active: boolean;
  scan_interval_min: number;
  config_json: Record<string, unknown>;
  last_scanned_at: string | null;
  created_at: string;
}

export interface SkillProfile {
  id: string;
  user_id: string;
  title: string;
  keywords: string[];
  anti_keywords: string[];
  min_budget: number;
  max_budget: number | null;
  niche_description: string;
  score_threshold: number;
  is_default: boolean;
  created_at: string;
}

export interface Listing {
  id: string;
  platform_id: string;
  external_id: string;
  title: string;
  description: string | null;
  url: string;
  budget_min: number | null;
  budget_max: number | null;
  budget_type: 'fixed' | 'hourly' | 'not_specified';
  skills_required: string[];
  client_info: Record<string, unknown>;
  fit_score: number | null;
  fit_reasoning: string | null;
  fit_keywords_matched: string[];
  status: 'new' | 'alerted' | 'applied' | 'skipped' | 'won' | 'lost';
  notes: string | null;
  scraped_at: string;
  posted_at: string | null;
  updated_at: string;
}

export interface AlertRecord {
  id: string;
  listing_id: string;
  profile_id: string | null;
  sent_at: string;
  email_to: string;
  resend_message_id: string | null;
  email_opened: boolean;
  clicked_apply: boolean;
}

export interface ScanLog {
  id: string;
  platform_id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  listings_found: number;
  new_listings: number;
  listings_scored: number;
  alerts_sent: number;
  error_message: string | null;
  duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

// ── Scraper module interface ────────────────────────────────
export interface ScraperModule {
  scrape(config: Record<string, unknown>): Promise<RawListing[]>;
}

// ── AI Scorer result ────────────────────────────────────────
export interface ScoreResult {
  score: number;
  reasoning: string;
  matchedKeywords: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}
