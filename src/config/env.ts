import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  // Required — core infrastructure
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  // Optional until their modules are used
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  ALERT_EMAIL: process.env.ALERT_EMAIL || '',
  NODE_ENV: process.env.NODE_ENV || 'development',
} as const;
