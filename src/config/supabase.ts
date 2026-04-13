import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Service role client — bypasses RLS, used by scrapers and pipeline
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
