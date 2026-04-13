-- ============================================================
-- Migration 001: Add token tracking to scan_logs
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS input_tokens integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(10,6) DEFAULT 0;
