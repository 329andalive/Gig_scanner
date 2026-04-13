import type { ScoredListing } from '../../types/index.js';

/** Get the score badge color based on fit score */
function scoreBadge(score: number): { color: string; bg: string; label: string } {
  if (score >= 90) return { color: '#065f46', bg: '#d1fae5', label: 'Excellent Match' };
  if (score >= 80) return { color: '#065f46', bg: '#d1fae5', label: 'Strong Match' };
  if (score >= 70) return { color: '#92400e', bg: '#fef3c7', label: 'Good Match' };
  return { color: '#991b1b', bg: '#fee2e2', label: 'Weak Match' };
}

/** Format budget display */
function formatBudget(listing: ScoredListing): string {
  if (!listing.budgetMin && !listing.budgetMax) return 'Not specified';
  if (listing.budgetMin && listing.budgetMax && listing.budgetMin !== listing.budgetMax) {
    return `$${listing.budgetMin.toLocaleString()} – $${listing.budgetMax.toLocaleString()} (${listing.budgetType})`;
  }
  const amount = listing.budgetMin || listing.budgetMax;
  return `$${amount?.toLocaleString()} (${listing.budgetType})`;
}

/** Escape HTML entities */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build a single gig card HTML block (used in both single and digest emails) */
function gigCard(listing: ScoredListing, platformName: string): string {
  const badge = scoreBadge(listing.fitScore);
  const budget = formatBudget(listing);
  const skills = listing.skillsRequired.length > 0
    ? listing.skillsRequired.map((s) => `<span style="display:inline-block;background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:12px;margin:2px;">${esc(s)}</span>`).join(' ')
    : '<span style="color:#9ca3af;font-size:13px;">None listed</span>';
  const keywords = listing.fitKeywordsMatched.length > 0
    ? listing.fitKeywordsMatched.map((k) => `<span style="display:inline-block;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:12px;margin:2px;">${esc(k)}</span>`).join(' ')
    : '';

  return `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;margin-bottom:16px;">
      <!-- Score Badge -->
      <div style="margin-bottom:12px;">
        <span style="display:inline-block;background:${badge.bg};color:${badge.color};padding:4px 12px;border-radius:16px;font-weight:600;font-size:14px;">
          ${listing.fitScore}/100 — ${badge.label}
        </span>
        <span style="display:inline-block;background:#f3f4f6;color:#6b7280;padding:4px 10px;border-radius:16px;font-size:12px;margin-left:8px;">
          ${esc(platformName)}
        </span>
      </div>

      <!-- Title -->
      <h2 style="margin:0 0 8px;font-size:18px;color:#111827;">
        <a href="${esc(listing.url)}" style="color:#2563eb;text-decoration:none;">${esc(listing.title)}</a>
      </h2>

      <!-- Budget -->
      <p style="margin:0 0 8px;font-size:14px;color:#374151;">
        <strong>Budget:</strong> ${budget}
      </p>

      <!-- AI Reasoning -->
      <p style="margin:0 0 12px;font-size:14px;color:#4b5563;background:#f9fafb;padding:10px 14px;border-radius:6px;border-left:3px solid #2563eb;">
        ${esc(listing.fitReasoning)}
      </p>

      <!-- Skills -->
      <div style="margin-bottom:8px;">
        <strong style="font-size:13px;color:#374151;">Skills:</strong><br/>
        ${skills}
      </div>

      <!-- Matched Keywords -->
      ${keywords ? `
      <div style="margin-bottom:12px;">
        <strong style="font-size:13px;color:#374151;">Matched Keywords:</strong><br/>
        ${keywords}
      </div>` : ''}

      <!-- Apply Button -->
      <div style="margin-top:16px;">
        <a href="${esc(listing.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
          Apply Now →
        </a>
      </div>
    </div>`;
}

/** Build a single-listing alert email */
export function buildSingleAlertEmail(
  listing: ScoredListing,
  platformName: string
): { subject: string; html: string } {
  const subject = `[GigScanner] ${listing.fitScore}/100 match on ${platformName}: ${listing.title.slice(0, 60)}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <!-- Header -->
    <div style="text-align:center;padding:20px 0 16px;">
      <h1 style="margin:0;font-size:22px;color:#111827;">GigScanner Alert</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">New gig matching your profile</p>
    </div>

    ${gigCard(listing, platformName)}

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0;font-size:12px;color:#9ca3af;">
      GigScanner — Automated Freelance Gig Radar<br/>
      You're receiving this because a listing scored above your threshold.
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

/** Build a digest email for multiple listings */
export function buildDigestEmail(
  listings: ScoredListing[],
  platformNames: Map<string, string>
): { subject: string; html: string } {
  // Sort by score descending
  const sorted = [...listings].sort((a, b) => b.fitScore - a.fitScore);
  const topScore = sorted[0].fitScore;

  const subject = `[GigScanner] ${sorted.length} new matches (top: ${topScore}/100)`;

  const cards = sorted
    .map((l) => gigCard(l, platformNames.get(l.platformId) || 'Unknown'))
    .join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <!-- Header -->
    <div style="text-align:center;padding:20px 0 16px;">
      <h1 style="margin:0;font-size:22px;color:#111827;">GigScanner Digest</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${sorted.length} new gigs matching your profile</p>
    </div>

    <!-- Summary -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 18px;margin-bottom:16px;font-size:14px;color:#1e40af;">
      <strong>${sorted.length} matches found</strong> — Top score: ${topScore}/100.
      ${sorted.filter((l) => l.fitScore >= 90).length} excellent,
      ${sorted.filter((l) => l.fitScore >= 70 && l.fitScore < 90).length} good.
    </div>

    ${cards}

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0;font-size:12px;color:#9ca3af;">
      GigScanner — Automated Freelance Gig Radar<br/>
      You're receiving this because ${sorted.length} listings scored above your threshold.
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}
