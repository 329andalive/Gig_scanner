-- ============================================================
-- GIGSCANNER: Seed Skill Profile for Jeremy Holt
-- Run in Supabase SQL Editor AFTER schema.sql
--
-- NOTE: skill_profiles requires a user_id (FK to auth.users).
-- Option A: If you've created a Supabase Auth user, replace
--           the user_id below with your actual auth.users UUID.
-- Option B: If running without auth for now, use the service
--           role insert below which bypasses RLS.
-- ============================================================

-- First, create a placeholder user if you don't have one yet.
-- (Skip this if you already have an auth user set up.)
-- You can find your user_id in Supabase Dashboard > Authentication > Users

-- Insert your skill profile via service role (bypasses RLS)
-- Replace 'YOUR_USER_ID_HERE' with your actual auth.users UUID
INSERT INTO public.skill_profiles (
  user_id,
  title,
  keywords,
  anti_keywords,
  min_budget,
  max_budget,
  niche_description,
  score_threshold,
  is_default
) VALUES (
  '00000000-0000-0000-0000-000000000000',  -- ← Replace with your auth.users UUID
  'Vibe Coder — AI Apps for Trades & Contractors',
  ARRAY[
    'AI', 'artificial intelligence', 'chatbot', 'AI chatbot',
    'MVP', 'minimum viable product', 'prototype',
    'landing page', 'web app', 'mobile app',
    'trades', 'contractor', 'plumbing', 'HVAC', 'electrical',
    'construction', 'roofing', 'landscaping', 'home services',
    'small business', 'local business',
    'automation', 'workflow', 'scheduling',
    'Claude', 'GPT', 'LLM', 'Anthropic', 'OpenAI',
    'Next.js', 'React', 'Node.js', 'Supabase', 'TypeScript',
    'vibe coding', 'vibe coder', 'bolt', 'cursor', 'v0'
  ],
  ARRAY[
    'blockchain', 'crypto', 'NFT', 'Web3', 'Solidity',
    'machine learning engineer', 'PhD required',
    'enterprise', 'Fortune 500', 'SAP', 'Salesforce',
    'senior architect', '10+ years experience',
    'unpaid', 'equity only', 'exposure',
    'Wordpress theme', 'Shopify theme',
    'data entry', 'virtual assistant',
    'game development', 'Unity', 'Unreal Engine'
  ],
  500,     -- min_budget: $500
  25000,   -- max_budget: $25,000
  'I am a vibe coder specializing in AI-powered apps for trades and contractors. '
  'I build MVPs, landing pages, chatbots, and workflow automation tools for '
  'small businesses in home services — plumbing, HVAC, electrical, construction, '
  'landscaping, and roofing. My stack is Claude AI + Next.js + Supabase + Railway. '
  'I ship fast using AI-assisted development (Claude Code, Bolt, Cursor). '
  'Ideal gigs: AI chatbots for service businesses, MVP builds for trade industry '
  'startups, landing pages with AI features, scheduling/automation tools.',
  70,      -- score_threshold: alert me for 70+ scores
  true     -- is_default: use this profile for scoring
);
