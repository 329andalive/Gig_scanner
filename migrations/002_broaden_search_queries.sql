-- ============================================================
-- Migration 002: Broaden search queries to match real job listings
-- Run in Supabase SQL Editor
-- ============================================================

-- Upwork: the goldmine — buyers post jobs, broadest query set
UPDATE public.platforms
SET config_json = '{
  "search_queries": [
    "AI app",
    "MVP build",
    "chatbot",
    "build me an app",
    "no-code app",
    "automation tool",
    "small business app",
    "internal tool",
    "Bolt.new",
    "Lovable",
    "landing page with AI",
    "Next.js developer",
    "Supabase developer",
    "AI integration",
    "workflow automation"
  ],
  "category": "Web, Mobile & Software Dev"
}'
WHERE name = 'Upwork';

-- Fiverr: scanning what's selling well in the niche (competitor intel)
-- These are seller gig searches, not buyer requests
UPDATE public.platforms
SET config_json = '{
  "search_queries": [
    "ai chatbot developer",
    "mvp app development",
    "build web app",
    "no code app",
    "ai automation",
    "saas mvp",
    "nextjs developer"
  ],
  "max_pages": 2
}',
scan_interval_min = 120
WHERE name = 'Fiverr';

-- VibeTalent: low volume platform, scan less frequently
UPDATE public.platforms
SET config_json = '{
  "search_queries": [
    "AI",
    "MVP",
    "chatbot",
    "automation"
  ],
  "browse_mode": true
}',
scan_interval_min = 180
WHERE name = 'VibeTalent';
