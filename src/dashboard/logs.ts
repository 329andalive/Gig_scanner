import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { layout, statusBadge, esc, fmtDate } from './layout.js';

const router = Router();

router.get('/logs', async (_req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('scan_logs')
      .select('*, platforms!inner(name)')
      .order('started_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Summary stats
    const completed = (logs || []).filter((l) => l.status === 'completed');
    const failed = (logs || []).filter((l) => l.status === 'failed');
    const avgDuration = completed.length > 0
      ? Math.round(completed.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / completed.length / 1000)
      : 0;
    const totalFound = completed.reduce((sum, l) => sum + (l.listings_found || 0), 0);
    const totalNew = completed.reduce((sum, l) => sum + (l.new_listings || 0), 0);

    const rows = (logs || []).map((l: Record<string, unknown>) => {
      const platform = (l.platforms as Record<string, string>)?.name || '?';
      const duration = l.duration_ms ? `${((l.duration_ms as number) / 1000).toFixed(1)}s` : '—';
      return `
        <tr>
          <td>${statusBadge(l.status as string)}</td>
          <td>${esc(platform)}</td>
          <td>${fmtDate(l.started_at as string | null)}</td>
          <td>${duration}</td>
          <td>${l.listings_found ?? 0}</td>
          <td>${l.new_listings ?? 0}</td>
          <td>${l.listings_scored ?? 0}</td>
          <td>${l.alerts_sent ?? 0}</td>
          <td style="white-space:nowrap;">${(Number(l.input_tokens || 0) + Number(l.output_tokens || 0)).toLocaleString()}</td>
          <td style="white-space:nowrap;">$${(parseFloat(String(l.estimated_cost_usd ?? 0))).toFixed(4)}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#ef4444;">
            ${esc(l.error_message as string | null) || ''}
          </td>
        </tr>`;
    }).join('');

    const content = `
      <h1>Scan Logs</h1>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="label">Total Scans</div>
          <div class="value">${(logs || []).length}</div>
          <div class="sub">${failed.length} failed</div>
        </div>
        <div class="stat-card">
          <div class="label">Avg Duration</div>
          <div class="value">${avgDuration}s</div>
          <div class="sub">per scan</div>
        </div>
        <div class="stat-card">
          <div class="label">Listings Found</div>
          <div class="value">${totalFound}</div>
          <div class="sub">${totalNew} new</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Tokens</div>
          <div class="value">${(() => { const t = completed.reduce((s, l) => s + (l.input_tokens || 0) + (l.output_tokens || 0), 0); return t > 1000 ? (t / 1000).toFixed(1) + 'k' : t; })()}</div>
          <div class="sub">across all scans</div>
        </div>
        <div class="stat-card">
          <div class="label">Total API Cost</div>
          <div class="value">$${completed.reduce((s, l) => s + (parseFloat(l.estimated_cost_usd) || 0), 0).toFixed(4)}</div>
          <div class="sub">Claude Haiku</div>
        </div>
      </div>

      ${(logs?.length || 0) > 0 ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Platform</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Found</th>
              <th>New</th>
              <th>Scored</th>
              <th>Alerts</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : `
      <div class="empty">
        <div class="icon">📊</div>
        <p>No scans have run yet.</p>
      </div>`}
    `;

    res.send(layout('Scan Logs', content, 'logs'));
  } catch (err) {
    res.status(500).send(layout('Error', `<p>Failed to load logs: ${err instanceof Error ? err.message : err}</p>`, 'logs'));
  }
});

export default router;
