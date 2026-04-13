import cron from 'node-cron';
import express from 'express';
import { supabase } from '../config/supabase.js';
import { runPipeline, getDefaultProfile } from '../pipeline/index.js';
import { evaluateAndAlert } from '../alerts/engine.js';
import { scrapeUpwork } from '../scrapers/upwork.js';
import { scrapeFiverr } from '../scrapers/fiverr.js';
import { scrapeVibeTalent } from '../scrapers/vibetalent.js';
import type { Platform, RawListing } from '../types/index.js';
import homeRoutes from '../dashboard/home.js';
import listingsRoutes from '../dashboard/listings.js';
import detailRoutes from '../dashboard/detail.js';
import logsRoutes from '../dashboard/logs.js';

// ── State ───────────────────────────────────────────────────
let lastScanAt: string | null = null;
let lastScanStatus: string = 'idle';
let isRunning = false;

// ── Scraper dispatch ────────────────────────────────────────
async function scrapeForPlatform(platform: Platform): Promise<RawListing[]> {
  const config = platform.config_json as Record<string, unknown>;

  switch (platform.scraper_type) {
    case 'upwork':
      return scrapeUpwork(config as { search_queries: string[]; category?: string }, platform.id);
    case 'fiverr':
      return scrapeFiverr(config as { search_queries: string[]; max_pages?: number }, platform.id);
    case 'vibetalent':
      return scrapeVibeTalent(config as { search_queries: string[]; browse_mode?: boolean }, platform.id);
    default:
      console.error(`  Unknown scraper type: ${platform.scraper_type}`);
      return [];
  }
}

// ── Scan log helpers ────────────────────────────────────────
async function createScanLog(platformId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('scan_logs')
    .insert({ platform_id: platformId, status: 'running' })
    .select('id')
    .single();

  if (error) {
    console.error('  Failed to create scan log:', error.message);
    return null;
  }
  return data.id;
}

async function completeScanLog(
  logId: string,
  stats: { listingsFound: number; newListings: number; listingsScored: number; alertsSent: number; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number },
  startTime: number,
  error?: string
): Promise<void> {
  await supabase
    .from('scan_logs')
    .update({
      status: error ? 'failed' : 'completed',
      completed_at: new Date().toISOString(),
      listings_found: stats.listingsFound,
      new_listings: stats.newListings,
      listings_scored: stats.listingsScored,
      alerts_sent: stats.alertsSent,
      input_tokens: stats.inputTokens || 0,
      output_tokens: stats.outputTokens || 0,
      estimated_cost_usd: stats.estimatedCostUsd || 0,
      error_message: error || null,
      duration_ms: Date.now() - startTime,
    })
    .eq('id', logId);
}

// ── Single platform scan cycle ──────────────────────────────
async function scanPlatform(platform: Platform): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scanning: ${platform.name}`);
  console.log(`${'='.repeat(60)}`);

  const startTime = Date.now();
  const logId = await createScanLog(platform.id);

  const stats = { listingsFound: 0, newListings: 0, listingsScored: 0, alertsSent: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };

  try {
    // Get skill profile
    const profile = await getDefaultProfile();
    if (!profile) {
      const msg = 'No skill profile found — skipping scoring and alerts.';
      console.error(`  ${msg}`);
      if (logId) await completeScanLog(logId, stats, startTime, msg);
      return;
    }

    // Scrape
    console.log('\n  ── Scraping ──');
    const rawListings = await scrapeForPlatform(platform);
    stats.listingsFound = rawListings.length;

    if (rawListings.length === 0) {
      console.log('  No listings found.');
      if (logId) await completeScanLog(logId, stats, startTime);
      return;
    }

    // Pipeline: dedup → score → write
    const pipelineResult = await runPipeline(rawListings, profile);
    stats.newListings = pipelineResult.newListings;
    stats.listingsScored = pipelineResult.listingsScored;
    stats.inputTokens = pipelineResult.tokenUsage.inputTokens;
    stats.outputTokens = pipelineResult.tokenUsage.outputTokens;
    stats.estimatedCostUsd = pipelineResult.tokenUsage.estimatedCostUsd;

    // Alerts
    if (pipelineResult.alertCandidates.length > 0) {
      console.log('\n  ── Sending Alerts ──');
      stats.alertsSent = await evaluateAndAlert(pipelineResult.alertCandidates, profile.id);
    }

    // Update platform last_scanned_at
    await supabase
      .from('platforms')
      .update({ last_scanned_at: new Date().toISOString() })
      .eq('id', platform.id);

    if (logId) await completeScanLog(logId, stats, startTime);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  Done: ${stats.listingsFound} found, ${stats.newListings} new, ${stats.listingsScored} scored, ${stats.alertsSent} alerts (${duration}s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Scan failed: ${msg}`);
    if (logId) await completeScanLog(logId, stats, startTime, msg);
  }
}

// ── Full scan cycle (all active platforms, staggered) ───────
async function runFullScan(): Promise<void> {
  if (isRunning) {
    console.log('Scan already in progress, skipping.');
    return;
  }

  isRunning = true;
  lastScanStatus = 'running';
  console.log(`\n${'#'.repeat(60)}`);
  console.log(`GigScanner scan cycle starting at ${new Date().toISOString()}`);
  console.log(`${'#'.repeat(60)}`);

  try {
    const { data: platforms, error } = await supabase
      .from('platforms')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error || !platforms?.length) {
      console.error('No active platforms found:', error?.message);
      lastScanStatus = 'error';
      return;
    }

    console.log(`Active platforms: ${platforms.map((p) => p.name).join(', ')}`);

    // Stagger: scan each platform with a 5-minute gap
    for (let i = 0; i < platforms.length; i++) {
      const platform = platforms[i] as Platform;

      // Check if enough time has passed since last scan for this platform
      if (platform.last_scanned_at) {
        const lastScan = new Date(platform.last_scanned_at).getTime();
        const intervalMs = (platform.scan_interval_min || 30) * 60 * 1000;
        if (Date.now() - lastScan < intervalMs) {
          console.log(`\nSkipping ${platform.name}: scanned ${Math.round((Date.now() - lastScan) / 60000)}m ago (interval: ${platform.scan_interval_min}m)`);
          continue;
        }
      }

      await scanPlatform(platform);

      // Stagger: wait 5 minutes between platforms (skip after last one)
      if (i < platforms.length - 1) {
        const STAGGER_MS = 5 * 60 * 1000;
        console.log(`\n  Staggering: waiting 5 minutes before next platform...`);
        await new Promise((resolve) => setTimeout(resolve, STAGGER_MS));
      }
    }

    lastScanAt = new Date().toISOString();
    lastScanStatus = 'completed';
    console.log(`\nScan cycle complete at ${lastScanAt}`);
  } catch (err) {
    lastScanStatus = 'error';
    console.error('Scan cycle error:', err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

// ── Health check server ─────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// ── Dashboard routes ──────────────────────────────────────────
app.use(homeRoutes);
app.use(listingsRoutes);
app.use(detailRoutes);
app.use(logsRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    scanner: {
      lastScanAt,
      lastScanStatus,
      isRunning,
      uptime: process.uptime(),
    },
  });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Health check server running on 0.0.0.0:${PORT}`);
});

// ── Cron schedule ───────────────────────────────────────────
// Run every 15 minutes during business hours (8 AM - 10 PM EST)
// Cron: minute 0,15,30,45 of hours 8-22, Mon-Fri
const CRON_SCHEDULE = '0,15,30,45 8-22 * * 1-5';

console.log(`GigScanner starting up...`);
console.log(`Cron schedule: ${CRON_SCHEDULE} (every 15 min, 8AM-10PM Mon-Fri)`);
console.log(`Health check: http://localhost:${PORT}/health`);

// Schedule recurring scans
cron.schedule(CRON_SCHEDULE, () => {
  runFullScan().catch((err) => {
    console.error('Cron trigger error:', err);
  });
});

// Run an initial scan on startup
console.log('Running initial scan...');
runFullScan().catch((err) => {
  console.error('Initial scan error:', err);
});
