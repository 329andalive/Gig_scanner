import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { layout, scoreBadge, statusBadge, esc, fmtDate, fmtBudget } from './layout.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    // Fetch stats in parallel
    const [listingsRes, alertsRes, scansRes, recentRes, scoreDistRes] = await Promise.all([
      supabase.from('listings').select('id', { count: 'exact', head: true }),
      supabase.from('alert_history').select('id', { count: 'exact', head: true }),
      supabase.from('scan_logs').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('listings').select('*').order('scraped_at', { ascending: false }).limit(10),
      supabase.from('listings').select('fit_score, status'),
    ]);

    const totalListings = listingsRes.count || 0;
    const totalAlerts = alertsRes.count || 0;
    const totalScans = scansRes.count || 0;
    const recent = recentRes.data || [];
    const allScores = scoreDistRes.data || [];

    // Score distribution
    const excellent = allScores.filter((l) => (l.fit_score ?? 0) >= 90).length;
    const good = allScores.filter((l) => (l.fit_score ?? 0) >= 70 && (l.fit_score ?? 0) < 90).length;
    const low = allScores.filter((l) => (l.fit_score ?? 0) > 0 && (l.fit_score ?? 0) < 70).length;
    const unscored = allScores.filter((l) => l.fit_score === null).length;

    // Status counts
    const applied = allScores.filter((l) => l.status === 'applied').length;
    const won = allScores.filter((l) => l.status === 'won').length;
    const avgScore = allScores.length > 0
      ? Math.round(allScores.reduce((sum, l) => sum + (l.fit_score ?? 0), 0) / allScores.filter((l) => l.fit_score !== null).length) || 0
      : 0;

    // Recent listings table
    const recentRows = recent.map((l) => `
      <tr>
        <td>${scoreBadge(l.fit_score)}</td>
        <td><a href="/listing/${esc(l.id)}">${esc(l.title?.slice(0, 55))}${l.title?.length > 55 ? '...' : ''}</a></td>
        <td>${fmtBudget(l.budget_min, l.budget_max, l.budget_type)}</td>
        <td>${statusBadge(l.status)}</td>
        <td>${fmtDate(l.scraped_at)}</td>
      </tr>
    `).join('');

    const content = `
      <h1>Dashboard</h1>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="label">Total Listings</div>
          <div class="value">${totalListings}</div>
          <div class="sub">${unscored} unscored</div>
        </div>
        <div class="stat-card">
          <div class="label">Alerts Sent</div>
          <div class="value">${totalAlerts}</div>
          <div class="sub">${applied} applied</div>
        </div>
        <div class="stat-card">
          <div class="label">Avg Fit Score</div>
          <div class="value">${avgScore}</div>
          <div class="sub">${excellent} excellent, ${good} good</div>
        </div>
        <div class="stat-card">
          <div class="label">Scans Completed</div>
          <div class="value">${totalScans}</div>
          <div class="sub">${won} gigs won</div>
        </div>
      </div>

      <h1>Recent Listings</h1>
      ${recent.length > 0 ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Title</th>
              <th>Budget</th>
              <th>Status</th>
              <th>Scraped</th>
            </tr>
          </thead>
          <tbody>${recentRows}</tbody>
        </table>
      </div>` : `
      <div class="empty">
        <div class="icon">📡</div>
        <p>No listings yet. The scanner will populate this once it runs.</p>
      </div>`}
    `;

    res.send(layout('Dashboard', content, 'home'));
  } catch (err) {
    res.status(500).send(layout('Error', `<p>Failed to load dashboard: ${err instanceof Error ? err.message : err}</p>`, 'home'));
  }
});

export default router;
