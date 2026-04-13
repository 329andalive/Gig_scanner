import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { layout, scoreBadge, statusBadge, esc, fmtDate, fmtBudget } from './layout.js';

const router = Router();

router.get('/listing/:id', async (req, res) => {
  try {
    const { data: listing, error } = await supabase
      .from('listings')
      .select('*, platforms!inner(name)')
      .eq('id', req.params.id)
      .single();

    if (error || !listing) {
      res.status(404).send(layout('Not Found', '<div class="empty"><p>Listing not found.</p></div>'));
      return;
    }

    const platform = (listing.platforms as Record<string, string>)?.name || 'Unknown';
    const skills = (listing.skills_required || []) as string[];
    const matchedKw = (listing.fit_keywords_matched || []) as string[];
    const clientInfo = listing.client_info as Record<string, unknown> || {};

    const clientRows = Object.entries(clientInfo)
      .map(([k, v]) => `<div class="detail-row"><span class="label">${esc(k)}</span><span>${esc(String(v))}</span></div>`)
      .join('');

    const content = `
      <div style="margin-bottom:16px;">
        <a href="/listings" style="font-size:13px;color:#64748b;text-decoration:none;">← Back to Listings</a>
      </div>

      <div class="detail-card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          ${scoreBadge(listing.fit_score)}
          ${statusBadge(listing.status)}
          <span class="badge badge-gray">${esc(platform)}</span>
        </div>

        <h2>${esc(listing.title)}</h2>

        <div style="margin-top:16px;">
          <div class="detail-row">
            <span class="label">Budget</span>
            <span>${fmtBudget(listing.budget_min, listing.budget_max, listing.budget_type)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Scraped</span>
            <span>${fmtDate(listing.scraped_at)}</span>
          </div>
          <div class="detail-row">
            <span class="label">Posted</span>
            <span>${fmtDate(listing.posted_at)}</span>
          </div>
          <div class="detail-row">
            <span class="label">External URL</span>
            <span><a href="${esc(listing.url)}" target="_blank" rel="noopener">${esc(listing.url?.slice(0, 70))}${listing.url?.length > 70 ? '...' : ''}</a></span>
          </div>
        </div>
      </div>

      ${listing.fit_reasoning ? `
      <div class="detail-card">
        <h2>AI Analysis</h2>
        <div class="reasoning-box">${esc(listing.fit_reasoning)}</div>
        ${matchedKw.length > 0 ? `
        <div style="margin-top:12px;">
          <span style="font-size:13px;color:#64748b;font-weight:500;">Matched Keywords:</span><br/>
          ${matchedKw.map((k) => `<span class="tag tag-blue">${esc(k)}</span>`).join(' ')}
        </div>` : ''}
      </div>` : ''}

      <div class="detail-card">
        <h2>Description</h2>
        <p style="font-size:14px;color:#334155;white-space:pre-wrap;line-height:1.7;">${esc(listing.description) || 'No description available.'}</p>
      </div>

      ${skills.length > 0 ? `
      <div class="detail-card">
        <h2>Required Skills</h2>
        <div>${skills.map((s) => `<span class="tag">${esc(s)}</span>`).join(' ')}</div>
      </div>` : ''}

      ${clientRows ? `
      <div class="detail-card">
        <h2>Client Info</h2>
        ${clientRows}
      </div>` : ''}

      ${listing.notes ? `
      <div class="detail-card">
        <h2>Notes</h2>
        <p style="font-size:14px;color:#334155;">${esc(listing.notes)}</p>
      </div>` : ''}

      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
        <a href="${esc(listing.url)}" target="_blank" rel="noopener" class="btn btn-primary">Apply Now →</a>
        <a href="/listing/${esc(listing.id)}/status/applied" class="btn btn-outline">Mark Applied</a>
        <a href="/listing/${esc(listing.id)}/status/skipped" class="btn btn-outline">Skip</a>
        <a href="/listing/${esc(listing.id)}/status/won" class="btn btn-outline">Won</a>
        <a href="/listing/${esc(listing.id)}/status/lost" class="btn btn-outline">Lost</a>
      </div>
    `;

    res.send(layout(listing.title, content));
  } catch (err) {
    res.status(500).send(layout('Error', `<p>Failed to load listing: ${err instanceof Error ? err.message : err}</p>`));
  }
});

// Status update endpoint
router.get('/listing/:id/status/:status', async (req, res) => {
  const validStatuses = ['new', 'alerted', 'applied', 'skipped', 'won', 'lost'];
  const newStatus = req.params.status;

  if (!validStatuses.includes(newStatus)) {
    res.redirect(`/listing/${req.params.id}`);
    return;
  }

  await supabase
    .from('listings')
    .update({ status: newStatus })
    .eq('id', req.params.id);

  res.redirect(`/listing/${req.params.id}`);
});

export default router;
