# Changelog

All notable changes to this project will be documented in this file.

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
