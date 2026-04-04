/**
 * report.js — Self-contained HTML dashboard report generator.
 *
 * Generates a dark-themed, Bloomberg-terminal-style HTML report from
 * scored combos. All CSS is inline, data is embedded as JSON, and
 * interactive sorting/filtering is handled by inline JavaScript.
 *
 * @example
 *   import { writeReport } from './report.js';
 *   const path = writeReport(scored, nearMisses, config, programs);
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const AMEX_TRANSFER_URL =
  "https://global.americanexpress.com/rewards/transfer";

/**
 * Build a point.me search URL for a one-way leg.
 */
function pointMeUrl(origin, dest, date, cabin, pax) {
  const cabinMap = {
    economy: "economy",
    premium: "premium",
    business: "business",
    first: "first",
  };
  const cls = cabinMap[cabin] || "economy";
  return `https://amex.point.me/results?departureIata=${origin}&arrivalIata=${dest}&departureDate=${date}&classOfService=${cls}&legType=oneWay&passengers=${pax}`;
}

/**
 * Escape a string for safe embedding inside an HTML <script> tag.
 */
function escapeForScript(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/</g, "\\x3c")
    .replace(/>/g, "\\x3e")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

/**
 * Generate a self-contained HTML dashboard report.
 *
 * @param {object[]} scored - Scored combos sorted by score ASC (lower = better)
 * @param {object[]} nearMisses - Near-miss combos
 * @param {object} config - Trip config from trip.json
 * @param {object} programs - PROGRAMS config object from programs.js
 * @returns {string} File path of the written report
 */
export function writeReport(scored, nearMisses, config, programs) {
  mkdirSync("output", { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const tsDisplay = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const filePath = join("output", `report-${ts}.html`);

  const confirmed = scored.filter((c) => c.confirmed);
  const likely = scored.filter((c) => !c.confirmed);
  const totalRecords = scored.length;
  const top3 = scored.slice(0, 3);

  // Prepare serializable data
  const dataPayload = {
    scored: scored.map((c, i) => ({
      rank: i + 1,
      confirmed: c.confirmed,
      outbound: c.outbound,
      return: c.return,
      stay_days: c.stay_days,
      total_pts: c.total_pts,
      total_fees: c.total_fees,
      score: c.score,
      flags: c.flags || [],
      source_tag: c.source_tag || "",
      award_cost_usd: c.award_cost_usd ?? null,
      cash_price_usd: c.cash_price_usd ?? null,
      value_ratio: c.value_ratio ?? null,
      verdict: c.verdict ?? null,
      summary: c.summary ?? null,
    })),
    nearMisses: (nearMisses || []).map((nm) => ({
      reason: nm.reason,
      outbound: nm.outbound,
      return: nm.return,
      stay_days: nm.stay_days,
      total_pts: nm.total_pts,
      total_fees: nm.total_fees,
      pts_delta: nm.pts_delta ?? null,
      no_baseline: nm.no_baseline || false,
    })),
    config: {
      origin: config.origin,
      destinations: config.destinations,
      cabin: config.cabin,
      pax: config.pax,
      outbound: config.outbound,
      return: config.return,
      trip_length: config.trip_length,
    },
    programs: Object.fromEntries(
      Object.entries(programs).map(([k, v]) => [k, { name: v.name }])
    ),
    timestamp: tsDisplay,
  };

  const dataJSON = JSON.stringify(dataPayload);

  // Build top 3 cards HTML
  const top3Cards = top3
    .map((combo, i) => {
      const progOut =
        programs[combo.outbound.program]?.name ?? combo.outbound.program;
      const progRet =
        programs[combo.return.program]?.name ?? combo.return.program;
      const totalStops =
        (combo.outbound.stops ?? 0) + (combo.return.stops ?? 0);
      const nonstop = totalStops === 0;

      const verdictColor = getVerdictColor(combo.verdict);
      const verdictBadge = combo.verdict
        ? `<span class="verdict-badge" style="background:${verdictColor}20;color:${verdictColor};border:1px solid ${verdictColor}40">${combo.value_ratio != null ? combo.value_ratio + "x " : ""}${formatVerdict(combo.verdict)}</span>`
        : `<span class="verdict-badge" style="background:#71717A20;color:#71717A;border:1px solid #71717A40">NO DATA</span>`;

      const outUrl = pointMeUrl(
        combo.outbound.origin,
        combo.outbound.destination,
        combo.outbound.date,
        config.cabin,
        config.pax
      );
      const retUrl = pointMeUrl(
        combo.return.origin,
        combo.return.destination,
        combo.return.date,
        config.cabin,
        config.pax
      );

      return `
      <div class="deal-card">
        <div class="deal-card-header">
          <span class="deal-rank">#${i + 1}</span>
          ${verdictBadge}
        </div>
        <div class="deal-route">${combo.outbound.origin} &rarr; ${combo.outbound.destination} &rarr; ${combo.return.destination}</div>
        <div class="deal-meta">
          <span>${combo.stay_days} days</span>
          <span class="meta-sep">&middot;</span>
          <span>${totalStops} stop${totalStops !== 1 ? "s" : ""}</span>
          ${nonstop ? '<span class="nonstop-badge">NONSTOP</span>' : ""}
        </div>
        <div class="deal-programs">
          <span>Out: ${progOut}</span>
          <span>Ret: ${progRet}</span>
        </div>
        <div class="deal-numbers">
          <div class="deal-number-block">
            <div class="deal-number-label">MR Points</div>
            <div class="deal-number-value">${combo.total_pts.toLocaleString("en-US")}</div>
          </div>
          <div class="deal-number-block">
            <div class="deal-number-label">Fees</div>
            <div class="deal-number-value">$${combo.total_fees.toFixed(2)}</div>
          </div>
        </div>
        <div class="deal-numbers">
          <div class="deal-number-block">
            <div class="deal-number-label">Award Cost</div>
            <div class="deal-number-value">${combo.award_cost_usd != null ? "$" + combo.award_cost_usd.toFixed(2) : "N/A"}</div>
          </div>
          <div class="deal-number-block">
            <div class="deal-number-label">Cash Price</div>
            <div class="deal-number-value">${combo.cash_price_usd != null ? "$" + Number(combo.cash_price_usd).toLocaleString("en-US") : "N/A"}</div>
          </div>
        </div>
        <div class="deal-dates">
          <span>${combo.outbound.date} &rarr; ${combo.return.date}</span>
        </div>
        <div class="deal-actions">
          <a class="btn btn-blue" href="${outUrl}" target="_blank" rel="noopener">Book on point.me</a>
          <a class="btn btn-green" href="${AMEX_TRANSFER_URL}" target="_blank" rel="noopener">Transfer MR</a>
        </div>
      </div>`;
    })
    .join("\n");

  // Build unique destinations for airport filter
  const allDests = [
    ...new Set(scored.map((c) => c.outbound.destination)),
  ].sort();

  // Sources
  const sources = [
    ...new Set(scored.map((c) => c.source_tag).filter(Boolean)),
  ].sort();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>bestairdeals report — ${tsDisplay}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0F1117;
    color: #E4E4E7;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }

  .container { max-width: 1400px; margin: 0 auto; padding: 16px 24px; }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    background: #1A1D27;
    border-bottom: 1px solid #2A2D37;
  }
  .header-logo {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: #E4E4E7;
  }
  .header-logo span { color: #3B82F6; }
  .header-stats {
    font-size: 13px;
    color: #71717A;
    font-family: ui-monospace, monospace;
  }

  /* Config bar */
  .config-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 32px;
    padding: 12px 24px;
    background: #161820;
    border-bottom: 1px solid #2A2D37;
    font-size: 12px;
    font-family: ui-monospace, monospace;
  }
  .config-item { display: flex; gap: 6px; }
  .config-label { color: #71717A; text-transform: uppercase; letter-spacing: 0.5px; }
  .config-value { color: #E4E4E7; }

  /* Top deal cards */
  .section-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #71717A;
    margin: 32px 0 16px;
  }

  .deals-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 16px;
  }

  .deal-card {
    background: #1A1D27;
    border: 1px solid #2A2D37;
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: border-color 0.15s;
  }
  .deal-card:hover { border-color: #3B82F6; }

  .deal-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .deal-rank {
    font-size: 24px;
    font-weight: 700;
    color: #3B82F6;
    font-family: ui-monospace, monospace;
  }
  .verdict-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 6px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  .deal-route {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .deal-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #71717A;
  }
  .meta-sep { color: #2A2D37; }
  .nonstop-badge {
    background: #22C55E20;
    color: #22C55E;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.5px;
  }

  .deal-programs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: #71717A;
  }
  .deal-numbers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .deal-number-block {
    background: #0F1117;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .deal-number-label {
    font-size: 11px;
    color: #71717A;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .deal-number-value {
    font-size: 18px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
  }
  .deal-dates {
    font-size: 13px;
    color: #71717A;
    font-family: ui-monospace, monospace;
  }
  .deal-actions { display: flex; gap: 8px; margin-top: 4px; }

  .btn {
    flex: 1;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-blue { background: #3B82F6; color: #fff; }
  .btn-green { background: #22C55E; color: #fff; }

  /* Filter bar */
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 24px 0 16px;
    padding: 12px 16px;
    background: #1A1D27;
    border: 1px solid #2A2D37;
    border-radius: 10px;
  }
  .filter-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .filter-label {
    font-size: 11px;
    color: #71717A;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 4px;
  }
  .filter-btn {
    background: #0F1117;
    color: #71717A;
    border: 1px solid #2A2D37;
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
    font-family: inherit;
  }
  .filter-btn:hover { border-color: #3B82F6; color: #E4E4E7; }
  .filter-btn.active { background: #3B82F620; border-color: #3B82F6; color: #3B82F6; }
  .filter-sep {
    width: 1px;
    height: 24px;
    background: #2A2D37;
    margin: 0 8px;
  }

  /* Table */
  .table-wrap {
    overflow-x: auto;
    border: 1px solid #2A2D37;
    border-radius: 10px;
    background: #1A1D27;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  thead th {
    position: sticky;
    top: 0;
    background: #161820;
    color: #71717A;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid #2A2D37;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }
  thead th:hover { color: #E4E4E7; }
  thead th.sort-asc::after { content: " \\2191"; color: #3B82F6; }
  thead th.sort-desc::after { content: " \\2193"; color: #3B82F6; }

  tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid #1F2230;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
  tbody tr:hover { background: #1F2230; }
  tbody tr.hidden { display: none; }

  .section-header-row td {
    background: #161820;
    color: #71717A;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 10px 12px;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .tier-confirmed {
    background: #22C55E20;
    color: #22C55E;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .tier-likely {
    background: #F59E0B20;
    color: #F59E0B;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .combo-count {
    font-size: 12px;
    color: #71717A;
    margin: 8px 0 4px;
    font-family: ui-monospace, monospace;
  }

  /* Heatmap */
  .heatmap-container {
    overflow-x: auto;
    margin-top: 16px;
  }
  .heatmap-table {
    border-collapse: collapse;
    font-size: 11px;
    font-family: ui-monospace, monospace;
  }
  .heatmap-table th {
    background: #161820;
    color: #71717A;
    padding: 6px 10px;
    font-weight: 500;
    border: 1px solid #2A2D37;
    font-size: 11px;
    white-space: nowrap;
  }
  .heatmap-table td {
    padding: 6px 10px;
    border: 1px solid #2A2D37;
    text-align: center;
    min-width: 56px;
    font-size: 11px;
    position: relative;
    cursor: default;
  }
  .heatmap-table td.empty { background: #0F1117; }

  .heatmap-tooltip {
    display: none;
    position: fixed;
    background: #1A1D27;
    border: 1px solid #3B82F6;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    color: #E4E4E7;
    font-family: ui-monospace, monospace;
    pointer-events: none;
    z-index: 1000;
    white-space: nowrap;
  }

  /* Near misses */
  .nm-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .nm-table th {
    background: #161820;
    color: #71717A;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid #2A2D37;
  }
  .nm-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #1F2230;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
  .nm-table tr:hover { background: #1F2230; }

  .reason-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .reason-date { background: #F59E0B20; color: #F59E0B; }
  .reason-seats { background: #EF444420; color: #EF4444; }

  /* Footer */
  .footer {
    text-align: center;
    padding: 32px 0;
    font-size: 12px;
    color: #71717A40;
  }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-logo">best<span>air</span>deals</div>
  <div class="header-stats">Last sweep: ${tsDisplay} &nbsp;|&nbsp; ${totalRecords} combos &nbsp;|&nbsp; ${scored.length} unique flights</div>
</div>

<!-- Config bar -->
<div class="config-bar">
  <div class="config-item">
    <span class="config-label">Route</span>
    <span class="config-value">${config.origin} &rarr; ${config.destinations.join(", ")}</span>
  </div>
  <div class="config-item">
    <span class="config-label">Cabin</span>
    <span class="config-value">${config.cabin.toUpperCase()}</span>
  </div>
  <div class="config-item">
    <span class="config-label">Pax</span>
    <span class="config-value">${config.pax}</span>
  </div>
  <div class="config-item">
    <span class="config-label">Outbound</span>
    <span class="config-value">${config.outbound.start} to ${config.outbound.end}</span>
  </div>
  <div class="config-item">
    <span class="config-label">Return</span>
    <span class="config-value">${config.return.start} to ${config.return.end}</span>
  </div>
  <div class="config-item">
    <span class="config-label">Stay</span>
    <span class="config-value">${config.trip_length.min}-${config.trip_length.max} days</span>
  </div>
  <div class="config-item">
    <span class="config-label">Sources</span>
    <span class="config-value">${sources.length > 0 ? sources.join(", ") : "seats.aero, point.me"}</span>
  </div>
</div>

<div class="container">

  ${
    top3.length > 0
      ? `
  <!-- Top 3 Deals -->
  <div class="section-title">Top Deals</div>
  <div class="deals-grid">
    ${top3Cards}
  </div>`
      : ""
  }

  <!-- Filter bar -->
  <div class="filter-bar" id="filterBar">
    <div class="filter-group">
      <span class="filter-label">Sort</span>
      <button class="filter-btn active" data-sort="score">Score</button>
      <button class="filter-btn" data-sort="points">Points</button>
      <button class="filter-btn" data-sort="fees">Fees</button>
      <button class="filter-btn" data-sort="value">Value Ratio</button>
    </div>
    <div class="filter-sep"></div>
    <div class="filter-group">
      <span class="filter-label">Tier</span>
      <button class="filter-btn active" data-tier="all">All</button>
      <button class="filter-btn" data-tier="confirmed">Confirmed</button>
      <button class="filter-btn" data-tier="likely">Likely</button>
    </div>
    <div class="filter-sep"></div>
    <div class="filter-group">
      <span class="filter-label">Stops</span>
      <button class="filter-btn active" data-stops="any">Any</button>
      <button class="filter-btn" data-stops="0">Nonstop</button>
      <button class="filter-btn" data-stops="1">1 stop</button>
    </div>
    <div class="filter-sep"></div>
    <div class="filter-group">
      <span class="filter-label">Airport</span>
      <button class="filter-btn active" data-airport="all">All</button>
      ${allDests.map((d) => `<button class="filter-btn" data-airport="${d}">${d}</button>`).join("\n      ")}
    </div>
  </div>

  <!-- Results table -->
  <div class="combo-count" id="comboCount">ALL RESULTS: ${totalRecords} COMBOS</div>
  <div class="table-wrap">
    <table id="resultsTable">
      <thead>
        <tr>
          <th data-col="rank">#</th>
          <th data-col="tier">Tier</th>
          <th data-col="outDate">Out Date</th>
          <th data-col="retDate">Ret Date</th>
          <th data-col="days">Days</th>
          <th data-col="progOut">Program Out</th>
          <th data-col="progRet">Program Ret</th>
          <th data-col="pts">MR Points</th>
          <th data-col="fees">Fees</th>
          <th data-col="awardCost">Award Cost</th>
          <th data-col="cashPrice">Cash Price</th>
          <th data-col="value">Value</th>
          <th data-col="verdict">Verdict</th>
          <th data-col="stops">Stops</th>
        </tr>
      </thead>
      <tbody id="resultsBody">
      </tbody>
    </table>
  </div>

  <!-- Date Heatmap -->
  <div class="section-title">Date Heatmap (Score by Date Pair)</div>
  <div class="heatmap-container" id="heatmapContainer"></div>
  <div class="heatmap-tooltip" id="heatmapTooltip"></div>

  ${
    nearMisses && nearMisses.length > 0
      ? `
  <!-- Near Misses -->
  <div class="section-title">Near Misses</div>
  <div class="table-wrap">
    <table class="nm-table" id="nearMissTable">
      <thead>
        <tr>
          <th>Type</th>
          <th>Out Date</th>
          <th>Ret Date</th>
          <th>Stay</th>
          <th>Programs</th>
          <th>Points</th>
          <th>Fees</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody id="nearMissBody"></tbody>
    </table>
  </div>`
      : ""
  }

  <div class="footer">bestairdeals &mdash; generated ${tsDisplay}</div>
</div>

<script>
const DATA = ${dataJSON};

// --- Helpers ---
function fmt(n) { return n != null ? n.toLocaleString('en-US') : ''; }
function fmtUsd(n) { return n != null ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; }
function progName(key) { return DATA.programs[key] ? DATA.programs[key].name : key; }

function verdictColor(v) {
  if (!v) return '#71717A';
  if (v === 'GREAT_USE') return '#22C55E';
  if (v === 'GOOD_USE') return '#3B82F6';
  if (v === 'BARELY_WORTH_IT') return '#F59E0B';
  if (v === 'JUST_BUY_CASH') return '#EF4444';
  return '#71717A';
}

function verdictLabel(v) {
  if (!v) return '';
  return v.replace(/_/g, ' ');
}

function tierBadge(confirmed) {
  return confirmed
    ? '<span class="tier-confirmed">CONFIRMED</span>'
    : '<span class="tier-likely">LIKELY</span>';
}

function verdictBadge(v) {
  if (!v) return '';
  var c = verdictColor(v);
  return '<span class="verdict-badge" style="background:' + c + '20;color:' + c + ';border:1px solid ' + c + '40">' + verdictLabel(v) + '</span>';
}

// --- State ---
var currentSort = 'score';
var currentDir = 'asc';
var filterTier = 'all';
var filterStops = 'any';
var filterAirport = 'all';

// --- Render table ---
function renderTable() {
  var items = DATA.scored.slice();

  // Sort
  items.sort(function(a, b) {
    var va, vb;
    if (currentSort === 'score') { va = a.score; vb = b.score; }
    else if (currentSort === 'points') { va = a.total_pts; vb = b.total_pts; }
    else if (currentSort === 'fees') { va = a.total_fees; vb = b.total_fees; }
    else if (currentSort === 'value') { va = a.value_ratio || 999; vb = b.value_ratio || 999; }
    else if (currentSort === 'rank') { va = a.rank; vb = b.rank; }
    else if (currentSort === 'outDate') { va = a.outbound.date; vb = b.outbound.date; }
    else if (currentSort === 'retDate') { va = a['return'].date; vb = b['return'].date; }
    else if (currentSort === 'days') { va = a.stay_days; vb = b.stay_days; }
    else if (currentSort === 'pts') { va = a.total_pts; vb = b.total_pts; }
    else if (currentSort === 'stops') {
      va = (a.outbound.stops || 0) + (a['return'].stops || 0);
      vb = (b.outbound.stops || 0) + (b['return'].stops || 0);
    }
    else if (currentSort === 'awardCost') { va = a.award_cost_usd || 999999; vb = b.award_cost_usd || 999999; }
    else if (currentSort === 'cashPrice') { va = a.cash_price_usd || 999999; vb = b.cash_price_usd || 999999; }
    else { va = a.score; vb = b.score; }

    if (va < vb) return currentDir === 'asc' ? -1 : 1;
    if (va > vb) return currentDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Separate confirmed/likely for section headers
  var confirmed = items.filter(function(c) { return c.confirmed; });
  var likely = items.filter(function(c) { return !c.confirmed; });

  var html = '';
  var visibleCount = 0;

  function isVisible(c) {
    if (filterTier === 'confirmed' && !c.confirmed) return false;
    if (filterTier === 'likely' && c.confirmed) return false;
    var stops = (c.outbound.stops || 0) + (c['return'].stops || 0);
    if (filterStops === '0' && stops !== 0) return false;
    if (filterStops === '1' && stops > 1) return false;
    if (filterAirport !== 'all' && c.outbound.destination !== filterAirport) return false;
    return true;
  }

  function renderRow(c) {
    var vis = isVisible(c);
    if (vis) visibleCount++;
    var stops = (c.outbound.stops || 0) + (c['return'].stops || 0);
    var vc = verdictColor(c.verdict);
    return '<tr class="' + (vis ? '' : 'hidden') + '" data-confirmed="' + c.confirmed + '" data-dest="' + c.outbound.destination + '" data-stops="' + stops + '">'
      + '<td>' + c.rank + '</td>'
      + '<td>' + tierBadge(c.confirmed) + '</td>'
      + '<td>' + c.outbound.date + '</td>'
      + '<td>' + c['return'].date + '</td>'
      + '<td>' + c.stay_days + '</td>'
      + '<td style="font-family:system-ui,sans-serif;font-size:12px">' + progName(c.outbound.program) + '</td>'
      + '<td style="font-family:system-ui,sans-serif;font-size:12px">' + progName(c['return'].program) + '</td>'
      + '<td>' + fmt(c.total_pts) + '</td>'
      + '<td>' + fmtUsd(c.total_fees) + '</td>'
      + '<td>' + fmtUsd(c.award_cost_usd) + '</td>'
      + '<td>' + fmtUsd(c.cash_price_usd) + '</td>'
      + '<td>' + (c.value_ratio != null ? c.value_ratio + 'x' : '') + '</td>'
      + '<td>' + verdictBadge(c.verdict) + '</td>'
      + '<td>' + stops + '</td>'
      + '</tr>';
  }

  if (filterTier !== 'likely' && confirmed.length > 0) {
    html += '<tr class="section-header-row"><td colspan="14">CONFIRMED AVAILABLE (' + confirmed.length + ')</td></tr>';
    confirmed.forEach(function(c) { html += renderRow(c); });
  }

  if (filterTier !== 'confirmed' && likely.length > 0) {
    html += '<tr class="section-header-row"><td colspan="14">LIKELY AVAILABLE (' + likely.length + ')</td></tr>';
    likely.forEach(function(c) { html += renderRow(c); });
  }

  document.getElementById('resultsBody').innerHTML = html;
  document.getElementById('comboCount').textContent = 'ALL RESULTS: ' + visibleCount + ' of ' + DATA.scored.length + ' COMBOS';

  // Update sort indicators
  var ths = document.querySelectorAll('#resultsTable thead th');
  ths.forEach(function(th) {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('data-col') === currentSort) {
      th.classList.add(currentDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// --- Render heatmap ---
function renderHeatmap() {
  var lookup = {};
  var outDatesSet = {};
  var retDatesSet = {};
  var minScore = Infinity;
  var maxScore = -Infinity;

  DATA.scored.forEach(function(c) {
    var key = c.outbound.date + '|' + c['return'].date;
    if (!lookup[key] || c.score < lookup[key]) {
      lookup[key] = c.score;
    }
    outDatesSet[c.outbound.date] = true;
    retDatesSet[c['return'].date] = true;
    if (c.score < minScore) minScore = c.score;
    if (c.score > maxScore) maxScore = c.score;
  });

  var outDates = Object.keys(outDatesSet).sort();
  var retDates = Object.keys(retDatesSet).sort();

  if (outDates.length === 0 || retDates.length === 0) {
    document.getElementById('heatmapContainer').innerHTML = '<p style="color:#71717A;font-size:13px">No data for heatmap.</p>';
    return;
  }

  function scoreColor(score) {
    if (minScore === maxScore) return '#22C55E';
    var t = (score - minScore) / (maxScore - minScore);
    // green (good/low) to red (bad/high)
    var r = Math.round(34 + t * (239 - 34));
    var g = Math.round(197 - t * (197 - 68));
    var b = Math.round(94 - t * (94 - 68));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  var html = '<table class="heatmap-table"><thead><tr><th>Out \\\\ Ret</th>';
  retDates.forEach(function(d) {
    html += '<th>' + d.slice(5) + '</th>';
  });
  html += '</tr></thead><tbody>';

  outDates.forEach(function(od) {
    html += '<tr><th>' + od.slice(5) + '</th>';
    retDates.forEach(function(rd) {
      var key = od + '|' + rd;
      var val = lookup[key];
      if (val !== undefined) {
        var bg = scoreColor(val);
        html += '<td style="background:' + bg + ';color:#fff" data-out="' + od + '" data-ret="' + rd + '" data-score="' + val + '">' + Math.round(val) + '</td>';
      } else {
        html += '<td class="empty"></td>';
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('heatmapContainer').innerHTML = html;

  // Tooltip
  var tooltip = document.getElementById('heatmapTooltip');
  document.getElementById('heatmapContainer').addEventListener('mouseover', function(e) {
    var td = e.target.closest('td[data-score]');
    if (td) {
      tooltip.style.display = 'block';
      tooltip.textContent = td.getAttribute('data-out') + ' \\u2192 ' + td.getAttribute('data-ret') + ' | Score: ' + td.getAttribute('data-score');
    }
  });
  document.getElementById('heatmapContainer').addEventListener('mousemove', function(e) {
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 8) + 'px';
  });
  document.getElementById('heatmapContainer').addEventListener('mouseout', function(e) {
    if (!e.target.closest('td[data-score]')) {
      tooltip.style.display = 'none';
    }
  });
}

// --- Render near misses ---
function renderNearMisses() {
  var body = document.getElementById('nearMissBody');
  if (!body || DATA.nearMisses.length === 0) return;

  var html = '';
  DATA.nearMisses.forEach(function(nm) {
    var reasonClass = nm.reason === 'date' ? 'reason-date' : 'reason-seats';
    var reasonLabel = nm.reason === 'date' ? 'DATE' : 'SEATS';
    var reasonText = nm.reason === 'date'
      ? 'Stay ' + nm.stay_days + 'd (range ' + DATA.config.trip_length.min + '-' + DATA.config.trip_length.max + 'd)'
      : 'Seats below ' + DATA.config.pax + ' pax';

    html += '<tr>'
      + '<td><span class="reason-badge ' + reasonClass + '">' + reasonLabel + '</span></td>'
      + '<td>' + nm.outbound.date + '</td>'
      + '<td>' + nm['return'].date + '</td>'
      + '<td>' + nm.stay_days + '</td>'
      + '<td style="font-family:system-ui,sans-serif;font-size:12px">' + progName(nm.outbound.program) + ' / ' + progName(nm['return'].program) + '</td>'
      + '<td>' + fmt(nm.total_pts) + '</td>'
      + '<td>' + fmtUsd(nm.total_fees) + '</td>'
      + '<td style="font-family:system-ui,sans-serif;font-size:12px">' + reasonText + '</td>'
      + '</tr>';
  });
  body.innerHTML = html;
}

// --- Event handlers ---

// Sort buttons in filter bar
document.querySelectorAll('[data-sort]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('[data-sort]').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var newSort = btn.getAttribute('data-sort');
    if (currentSort === newSort) {
      currentDir = currentDir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort = newSort;
      currentDir = 'asc';
    }
    renderTable();
  });
});

// Column header sorting
document.querySelectorAll('#resultsTable thead th[data-col]').forEach(function(th) {
  th.addEventListener('click', function() {
    var col = th.getAttribute('data-col');
    if (currentSort === col) {
      currentDir = currentDir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort = col;
      currentDir = 'asc';
    }
    // Deactivate filter bar sort buttons
    document.querySelectorAll('[data-sort]').forEach(function(b) { b.classList.remove('active'); });
    renderTable();
  });
});

// Tier filter
document.querySelectorAll('[data-tier]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('[data-tier]').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    filterTier = btn.getAttribute('data-tier');
    renderTable();
  });
});

// Stops filter
document.querySelectorAll('[data-stops]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('[data-stops]').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    filterStops = btn.getAttribute('data-stops');
    renderTable();
  });
});

// Airport filter
document.querySelectorAll('[data-airport]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('[data-airport]').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    filterAirport = btn.getAttribute('data-airport');
    renderTable();
  });
});

// --- Init ---
renderTable();
renderHeatmap();
renderNearMisses();
</script>
</body>
</html>`;

  writeFileSync(filePath, html, "utf-8");
  console.log(`[report] HTML report written to: ${filePath}`);
  return filePath;
}

// --- Internal helpers ---

function getVerdictColor(verdict) {
  if (!verdict) return "#71717A";
  if (verdict === "GREAT_USE") return "#22C55E";
  if (verdict === "GOOD_USE") return "#3B82F6";
  if (verdict === "BARELY_WORTH_IT") return "#F59E0B";
  if (verdict === "JUST_BUY_CASH") return "#EF4444";
  if (verdict === "NO_CASH_DATA") return "#71717A";
  return "#71717A";
}

function formatVerdict(verdict) {
  if (!verdict) return "";
  return verdict.replace(/_/g, " ");
}
