-- ============================================================
-- GIGSCANNER: Full Supabase Schema
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── PLATFORMS ────────────────────────────────────────────────
CREATE TABLE public.platforms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL UNIQUE,
  base_url          text NOT NULL,
  scraper_type      text NOT NULL,
  is_active         boolean DEFAULT true,
  scan_interval_min integer DEFAULT 30,
  config_json       jsonb DEFAULT '{}',
  last_scanned_at   timestamptz,
  created_at        timestamptz DEFAULT now()
);

-- ── SKILL PROFILES ──────────────────────────────────────────
CREATE TABLE public.skill_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  keywords          text[] NOT NULL DEFAULT '{}',
  anti_keywords     text[] DEFAULT '{}',
  min_budget        numeric(10,2) DEFAULT 0,
  max_budget        numeric(10,2),
  niche_description text NOT NULL,
  score_threshold   integer DEFAULT 70 CHECK (score_threshold BETWEEN 0 AND 100),
  is_default        boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

-- ── LISTINGS ────────────────────────────────────────────────
CREATE TABLE public.listings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id          uuid NOT NULL REFERENCES public.platforms(id),
  external_id          text NOT NULL,
  title                text NOT NULL,
  description          text,
  url                  text NOT NULL,
  budget_min           numeric(10,2),
  budget_max           numeric(10,2),
  budget_type          text CHECK (budget_type IN ('fixed','hourly','not_specified')),
  skills_required      text[] DEFAULT '{}',
  client_info          jsonb DEFAULT '{}',
  fit_score            integer CHECK (fit_score BETWEEN 0 AND 100),
  fit_reasoning        text,
  fit_keywords_matched text[] DEFAULT '{}',
  status               text DEFAULT 'new'
                       CHECK (status IN ('new','alerted','applied','skipped','won','lost')),
  notes                text,
  scraped_at           timestamptz DEFAULT now(),
  posted_at            timestamptz,
  updated_at           timestamptz DEFAULT now(),
  UNIQUE(platform_id, external_id)
);

-- ── ALERT HISTORY ───────────────────────────────────────────
CREATE TABLE public.alert_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  profile_id        uuid REFERENCES public.skill_profiles(id),
  sent_at           timestamptz DEFAULT now(),
  email_to          text NOT NULL,
  resend_message_id text,
  email_opened      boolean DEFAULT false,
  clicked_apply     boolean DEFAULT false
);

-- ── SCAN LOGS ───────────────────────────────────────────────
CREATE TABLE public.scan_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id     uuid NOT NULL REFERENCES public.platforms(id),
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz,
  status          text DEFAULT 'running'
                  CHECK (status IN ('running','completed','failed')),
  listings_found  integer DEFAULT 0,
  new_listings    integer DEFAULT 0,
  listings_scored integer DEFAULT 0,
  alerts_sent     integer DEFAULT 0,
  error_message   text,
  duration_ms     integer
);

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX idx_listings_platform ON public.listings(platform_id);
CREATE INDEX idx_listings_status ON public.listings(status);
CREATE INDEX idx_listings_fit_score ON public.listings(fit_score DESC);
CREATE INDEX idx_listings_scraped_at ON public.listings(scraped_at DESC);
CREATE INDEX idx_listings_dedup ON public.listings(platform_id, external_id);
CREATE INDEX idx_alerts_listing ON public.alert_history(listing_id);
CREATE INDEX idx_scan_logs_platform ON public.scan_logs(platform_id);
CREATE INDEX idx_skill_profiles_user ON public.skill_profiles(user_id);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────
ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;

-- Platforms: readable by all authenticated users
CREATE POLICY "platforms_read" ON public.platforms
  FOR SELECT TO authenticated USING (true);

-- Platforms: writable by service role (scrapers)
CREATE POLICY "platforms_service_write" ON public.platforms
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Skill profiles: users see only their own
CREATE POLICY "profiles_own" ON public.skill_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Listings: readable by all authenticated
CREATE POLICY "listings_read" ON public.listings
  FOR SELECT TO authenticated USING (true);

-- Listings: writable by service role (scrapers)
CREATE POLICY "listings_service_write" ON public.listings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Alert history: users see their own alerts
CREATE POLICY "alerts_read" ON public.alert_history
  FOR SELECT TO authenticated
  USING (email_to = auth.jwt()->>'email');

-- Alert history: writable by service role
CREATE POLICY "alerts_service_write" ON public.alert_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Scan logs: readable by authenticated
CREATE POLICY "scan_logs_read" ON public.scan_logs
  FOR SELECT TO authenticated USING (true);

-- Scan logs: writable by service role
CREATE POLICY "scan_logs_service_write" ON public.scan_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── SEED DATA: PLATFORMS ────────────────────────────────────
INSERT INTO public.platforms (name, base_url, scraper_type, scan_interval_min, config_json)
VALUES
  ('Upwork', 'https://www.upwork.com', 'upwork', 30, '{
    "search_queries": ["AI app contractor", "chatbot small business",
    "MVP developer trades", "vibe coder"],
    "category": "Web, Mobile & Software Dev"
  }'),
  ('Fiverr', 'https://www.fiverr.com', 'fiverr', 45, '{
    "search_queries": ["ai chatbot", "mvp app development",
    "landing page ai"],
    "max_pages": 3
  }'),
  ('VibeTalent', 'https://www.vibetalent.work', 'vibetalent', 60, '{
    "search_queries": ["AI", "contractor", "trades app"],
    "browse_mode": true
  }');

-- ── UPDATED_AT TRIGGER ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_listings_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
