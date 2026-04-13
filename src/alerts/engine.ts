import { Resend } from 'resend';
import { env } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { buildSingleAlertEmail, buildDigestEmail } from './templates/gig-alert.js';
import type { ScoredListing } from '../types/index.js';

const DIGEST_THRESHOLD = 3; // Send digest instead of individual emails when >= this many

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required for email alerts');
    }
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

/** Check if an alert was already sent for a listing */
async function alreadyAlerted(listingId: string): Promise<boolean> {
  const { data } = await supabase
    .from('alert_history')
    .select('id')
    .eq('listing_id', listingId)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/** Record an alert in alert_history and update listing status */
async function recordAlert(
  listingId: string,
  profileId: string | null,
  resendMessageId: string | null
): Promise<void> {
  // Insert alert history row
  await supabase.from('alert_history').insert({
    listing_id: listingId,
    profile_id: profileId,
    email_to: env.ALERT_EMAIL,
    resend_message_id: resendMessageId,
  });

  // Update listing status to 'alerted'
  await supabase
    .from('listings')
    .update({ status: 'alerted' })
    .eq('id', listingId);
}

/** Look up listing IDs from Supabase by platform_id + external_id */
async function getListingIds(
  listings: ScoredListing[]
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (listings.length === 0) return ids;

  const externalIds = listings.map((l) => l.externalId);

  const { data } = await supabase
    .from('listings')
    .select('id, external_id, platform_id')
    .in('external_id', externalIds);

  for (const row of data || []) {
    // Key by platformId:externalId for uniqueness
    ids.set(`${row.platform_id}:${row.external_id}`, row.id);
  }

  return ids;
}

/** Get platform names for display in emails */
async function getPlatformNames(): Promise<Map<string, string>> {
  const { data } = await supabase.from('platforms').select('id, name');
  const map = new Map<string, string>();
  for (const row of data || []) {
    map.set(row.id, row.name);
  }
  return map;
}

/**
 * Evaluate scored listings and send email alerts for those above threshold.
 * Sends individual emails for 1-2 alerts, digest for 3+.
 */
export async function evaluateAndAlert(
  candidates: ScoredListing[],
  profileId: string | null
): Promise<number> {
  if (candidates.length === 0) return 0;
  if (!env.ALERT_EMAIL) {
    console.log('  Alerts: no ALERT_EMAIL configured, skipping.');
    return 0;
  }

  const resend = getResend();
  const listingIds = await getListingIds(candidates);
  const platformNames = await getPlatformNames();

  // Filter out already-alerted listings
  const toAlert: ScoredListing[] = [];
  for (const listing of candidates) {
    const key = `${listing.platformId}:${listing.externalId}`;
    const dbId = listingIds.get(key);
    if (!dbId) continue;

    if (await alreadyAlerted(dbId)) {
      console.log(`    Skipping already-alerted: ${listing.title.slice(0, 50)}`);
      continue;
    }
    toAlert.push(listing);
  }

  if (toAlert.length === 0) {
    console.log('  Alerts: all candidates already alerted, nothing to send.');
    return 0;
  }

  let alertsSent = 0;

  // Digest mode for 3+ alerts
  if (toAlert.length >= DIGEST_THRESHOLD) {
    console.log(`  Sending digest email with ${toAlert.length} listings...`);
    const { subject, html } = buildDigestEmail(toAlert, platformNames);

    try {
      const { data, error } = await resend.emails.send({
        from: 'GigScanner <onboarding@resend.dev>',
        to: env.ALERT_EMAIL,
        subject,
        html,
      });

      if (error) {
        console.error('  Digest email failed:', error.message);
        return 0;
      }

      // Record all listings as alerted
      for (const listing of toAlert) {
        const key = `${listing.platformId}:${listing.externalId}`;
        const dbId = listingIds.get(key);
        if (dbId) {
          await recordAlert(dbId, profileId, data?.id || null);
          alertsSent++;
        }
      }

      console.log(`  Digest sent: ${toAlert.length} listings in one email.`);
    } catch (err) {
      console.error('  Digest send error:', err instanceof Error ? err.message : err);
    }
  } else {
    // Individual emails for 1-2 alerts
    for (const listing of toAlert) {
      const platformName = platformNames.get(listing.platformId) || 'Unknown';
      const { subject, html } = buildSingleAlertEmail(listing, platformName);

      console.log(`  Sending alert: ${listing.fitScore}/100 — ${listing.title.slice(0, 50)}`);

      try {
        const { data, error } = await resend.emails.send({
          from: 'GigScanner <onboarding@resend.dev>',
          to: env.ALERT_EMAIL,
          subject,
          html,
        });

        if (error) {
          console.error(`    Email failed: ${error.message}`);
          continue;
        }

        const key = `${listing.platformId}:${listing.externalId}`;
        const dbId = listingIds.get(key);
        if (dbId) {
          await recordAlert(dbId, profileId, data?.id || null);
          alertsSent++;
        }
      } catch (err) {
        console.error(`    Send error:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`  Alerts complete: ${alertsSent} sent`);
  return alertsSent;
}
