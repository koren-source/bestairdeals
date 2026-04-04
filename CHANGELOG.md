# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0.0] - 2026-04-04

### Added
- Hono API server with SSE streaming: trigger searches from the web dashboard and watch results stream in live
- Flexible date search: pick a month and trip length, the system expands to full date windows automatically
- Search form in dashboard: origin, destinations, cabin, pax, exact/flex date mode, with URL param pre-fill
- Live "Best So Far" results update as point.me dates complete (partial results in ~30s, updates every ~60s)
- Search history: last 10 searches shown as cards with re-run buttons
- Status bar: shows Mac Mini online/offline, browse server ready/not running, last search time
- Abort button: cancel a running search mid-flight via DELETE /search
- Search mutex: prevents concurrent searches with 409 conflict response
- Browse daemon shared module: DRY extraction used by cron, API server, and point.me
- Config validation shared module: validates search params for both CLI and API paths
- 25 new tests (config validation, search layers, browse daemon exports)

### Changed
- Search pipeline decomposed into 3 composable layers: searchCore, mergeScoreAndSort, writeOutputs
- point.me cache key now includes cabin and pax to prevent stale cross-param contamination
- point.me passenger count uses config.pax instead of hardcoded 1
- Cron imports browse daemon from shared module instead of inline definitions

### Fixed
- XSS vulnerability in search history re-run buttons (switched from innerHTML to DOM APIs)

## [0.1.0.0] - 2026-04-03

### Added
- Award flight finder: two-agent pipeline (Seats.aero API + point.me browser) searches for award availability across 17 Amex MR transfer partners
- Combo math engine pairs outbound x return x pax, scores by total MR cost + fees, and ranks results
- Web dashboard (Vercel static site) with interactive sorting, filtering by tier/stops/airport, and date heatmap
- Split booking buttons: separate outbound and return links to point.me, plus Amex MR transfer link
- Cash price comparison via Google Flights scrape for top 3 deals (requires browse server)
- Award cost calculation for all combos using MR valuation ($0.02/point + fees)
- Google Sheets output with CSV fallback
- HTML report generator with embedded data and dark theme
- Cron scheduler, email/Slack notifications, and history tracking
- 35 tests covering combo math, scoring, merge, compare, history, and notifications

### Fixed
- Browse server preflight check at search start so you know immediately if cash prices will work
- Guarded against undefined HOME env var in browse server detection
- Initialized filePaths to prevent cascade crash when sheet write fails
- Extracted shared MR_VALUE_USD constant to eliminate duplicated magic number
