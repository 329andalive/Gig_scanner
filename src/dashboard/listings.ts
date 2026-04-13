import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { layout, scoreBadge, statusBadge, esc, fmtDate, fmtBudget } from './layout.js';

const router = Router();

const VALID_STATUSES = ['new', 'alerted', 'applied', 'skipped', 'won', 'lost'];
const PER_PAGE = 50;

router.get('/listings', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status)
      ? req.query.status : null;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const sort = req.query.sort === 'score' ? 'fit_score' : 'scraped_at';
    const dir = req.query.dir === 'asc';

    // Build query
    let query = supabase
      .from('listings')
      .select('*, platforms!inner(name)', { count: 'exact' });

    if (status) query = query.eq('status', status);
    query = query.order(sort, { ascending: dir }).range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

    const { data: listings, count, error } = await query;
    if (error) throw error;

    const totalPages = Math.ceil((count || 0) / PER_PAGE);

    // Filter tabs
    const filterLinks = [
      { label: 'All', value: '' },
      ...VALID_STATUSES.map((s) => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s })),
    ].map((f) => {
      const active = (status || '') === f.value;
      const href = f.value ? `/listings?status=${f.value}&sort=${req.query.sort || ''}&dir=${req.query.dir || ''}` : `/listings?sort=${req.query.sort || ''}&dir=${req.query.dir || ''}`;
      return `<a href="${href}" class="${active ? 'active' : ''}">${f.label}</a>`;
    }).join('');

    // Sort links
    const sortLink = (field: string, label: string) => {
      const isActive = (req.query.sort || '') === field || (!req.query.sort && field === '');
      const nextDir = isActive && !dir ? 'asc' : '';
      const href = `/listings?status=${status || ''}&sort=${field}&dir=${nextDir}`;
      return `<a href="${href}" style="color:inherit;text-decoration:none;">${label} ${isActive ? (dir ? '↑' : '↓') : ''}</a>`;
    };

    // Table rows
    const rows = (listings || []).map((l: Record<string, unknown>) => {
      const platform = (l.platforms as Record<string, string>)?.name || '?';
      return `
        <tr>
          <td>${scoreBadge(l.fit_score as number | null)}</td>
          <td>
            <a href="/listing/${esc(l.id as string)}">${esc((l.title as string)?.slice(0, 60))}${(l.title as string)?.length > 60 ? '...' : ''}</a>
            <br/><span style="font-size:12px;color:#94a3b8;">${esc(platform)}</span>
          </td>
          <td>${fmtBudget(l.budget_min as number | null, l.budget_max as number | null, l.budget_type as string | null)}</td>
          <td>${statusBadge(l.status as string)}</td>
          <td style="white-space:nowrap;">${fmtDate(l.scraped_at as string | null)}</td>
        </tr>`;
    }).join('');

    // Pagination
    const pagination = totalPages > 1 ? `
      <div style="display:flex;justify-content:center;gap:8px;margin-top:16px;">
        ${page > 1 ? `<a href="/listings?page=${page - 1}&status=${status || ''}&sort=${req.query.sort || ''}&dir=${req.query.dir || ''}" class="btn btn-outline">← Prev</a>` : ''}
        <span style="padding:10px;font-size:14px;color:#64748b;">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a href="/listings?page=${page + 1}&status=${status || ''}&sort=${req.query.sort || ''}&dir=${req.query.dir || ''}" class="btn btn-outline">Next →</a>` : ''}
      </div>` : '';

    const content = `
      <h1>Listings <span style="font-size:14px;color:#94a3b8;font-weight:400;">${count || 0} total</span></h1>

      <div class="filters">${filterLinks}</div>

      ${(listings?.length || 0) > 0 ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${sortLink('score', 'Score')}</th>
              <th>Title / Platform</th>
              <th>Budget</th>
              <th>Status</th>
              <th>${sortLink('', 'Scraped')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${pagination}` : `
      <div class="empty">
        <div class="icon">📋</div>
        <p>No listings ${status ? `with status "${status}"` : 'found yet'}.</p>
      </div>`}
    `;

    res.send(layout('Listings', content, 'listings'));
  } catch (err) {
    res.status(500).send(layout('Error', `<p>Failed to load listings: ${err instanceof Error ? err.message : err}</p>`, 'listings'));
  }
});

export default router;
