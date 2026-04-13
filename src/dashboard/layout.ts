/** Shared HTML layout wrapper for all dashboard pages */
export function layout(title: string, content: string, activePage: string = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title} — GigScanner</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f1f5f9;
      color: #1e293b;
      line-height: 1.5;
    }

    /* ── Nav ──────────────────────────────── */
    nav {
      background: #0f172a;
      color: #f8fafc;
      padding: 0 24px;
      display: flex;
      align-items: center;
      height: 56px;
      gap: 32px;
    }
    nav .logo {
      font-weight: 700;
      font-size: 18px;
      color: #38bdf8;
      text-decoration: none;
    }
    nav .links { display: flex; gap: 4px; }
    nav .links a {
      color: #94a3b8;
      text-decoration: none;
      font-size: 14px;
      padding: 8px 14px;
      border-radius: 6px;
      transition: background 0.15s, color 0.15s;
    }
    nav .links a:hover { background: #1e293b; color: #e2e8f0; }
    nav .links a.active { background: #1e293b; color: #38bdf8; }
    nav .status {
      margin-left: auto;
      font-size: 12px;
      color: #64748b;
    }
    nav .status .dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
      margin-right: 6px;
      vertical-align: middle;
    }

    /* ── Main ─────────────────────────────── */
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }

    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 20px;
      color: #0f172a;
    }

    /* ── Cards ────────────────────────────── */
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: #fff;
      border-radius: 10px;
      padding: 20px;
      border: 1px solid #e2e8f0;
    }
    .stat-card .label {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-card .value {
      font-size: 28px;
      font-weight: 700;
      color: #0f172a;
    }
    .stat-card .sub {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 2px;
    }

    /* ── Table ────────────────────────────── */
    .table-wrap {
      background: #fff;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th {
      text-align: left;
      padding: 12px 16px;
      background: #f8fafc;
      color: #475569;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e2e8f0;
      white-space: nowrap;
    }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }
    tr:hover td { background: #f8fafc; }
    tr:last-child td { border-bottom: none; }

    td a {
      color: #2563eb;
      text-decoration: none;
    }
    td a:hover { text-decoration: underline; }

    /* ── Badges ───────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-yellow { background: #fef9c3; color: #854d0e; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-gray { background: #f1f5f9; color: #475569; }
    .badge-purple { background: #f3e8ff; color: #7c3aed; }

    .score-bar {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .score-bar .bar {
      width: 60px; height: 6px;
      background: #e2e8f0;
      border-radius: 3px;
      overflow: hidden;
    }
    .score-bar .bar .fill {
      height: 100%;
      border-radius: 3px;
    }

    /* ── Filters ──────────────────────────── */
    .filters {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .filters a {
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      text-decoration: none;
      color: #475569;
      background: #fff;
      border: 1px solid #e2e8f0;
      transition: all 0.15s;
    }
    .filters a:hover { border-color: #94a3b8; }
    .filters a.active { background: #0f172a; color: #f8fafc; border-color: #0f172a; }

    /* ── Detail page ─────────────────────── */
    .detail-card {
      background: #fff;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      padding: 24px;
      margin-bottom: 16px;
    }
    .detail-card h2 {
      font-size: 20px;
      margin-bottom: 12px;
    }
    .detail-row {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .detail-row .label {
      color: #64748b;
      min-width: 140px;
      font-weight: 500;
    }
    .reasoning-box {
      background: #f8fafc;
      border-left: 3px solid #2563eb;
      padding: 14px 18px;
      border-radius: 0 8px 8px 0;
      margin: 12px 0;
      font-size: 14px;
      color: #334155;
    }
    .tag {
      display: inline-block;
      background: #f1f5f9;
      color: #475569;
      padding: 2px 10px;
      border-radius: 4px;
      font-size: 12px;
      margin: 2px;
    }
    .tag-blue { background: #dbeafe; color: #1e40af; }
    .btn {
      display: inline-block;
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s;
    }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-outline { background: #fff; color: #475569; border: 1px solid #e2e8f0; }
    .btn-outline:hover { border-color: #94a3b8; }

    /* ── Empty state ─────────────────────── */
    .empty {
      text-align: center;
      padding: 48px 24px;
      color: #94a3b8;
    }
    .empty .icon { font-size: 48px; margin-bottom: 12px; }
    .empty p { font-size: 15px; }

    /* ── Responsive ──────────────────────── */
    @media (max-width: 768px) {
      nav { padding: 0 12px; gap: 12px; }
      nav .links a { padding: 6px 10px; font-size: 13px; }
      main { padding: 16px; }
      .stat-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="logo">GigScanner</a>
    <div class="links">
      <a href="/" class="${activePage === 'home' ? 'active' : ''}">Dashboard</a>
      <a href="/listings" class="${activePage === 'listings' ? 'active' : ''}">Listings</a>
      <a href="/logs" class="${activePage === 'logs' ? 'active' : ''}">Scan Logs</a>
    </div>
    <div class="status"><span class="dot"></span>Scanner Active</div>
  </nav>
  <main>
    ${content}
  </main>
</body>
</html>`;
}

/** Score badge HTML */
export function scoreBadge(score: number | null): string {
  if (score === null) return '<span class="badge badge-gray">—</span>';
  if (score >= 90) return `<span class="badge badge-green">${score}</span>`;
  if (score >= 70) return `<span class="badge badge-yellow">${score}</span>`;
  if (score >= 50) return `<span class="badge badge-blue">${score}</span>`;
  return `<span class="badge badge-red">${score}</span>`;
}

/** Status badge HTML */
export function statusBadge(status: string): string {
  const map: Record<string, string> = {
    new: 'badge-blue',
    alerted: 'badge-yellow',
    applied: 'badge-purple',
    skipped: 'badge-gray',
    won: 'badge-green',
    lost: 'badge-red',
    running: 'badge-blue',
    completed: 'badge-green',
    failed: 'badge-red',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status}</span>`;
}

/** Escape HTML */
export function esc(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Format date for display */
export function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Format budget */
export function fmtBudget(min: number | null, max: number | null, type: string | null): string {
  if (!min && !max) return '—';
  const fmt = (n: number) => '$' + n.toLocaleString();
  if (min && max && min !== max) return `${fmt(min)} – ${fmt(max)} (${type || '?'})`;
  return `${fmt(min || max!)} (${type || '?'})`;
}
