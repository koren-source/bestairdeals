# bestairdeals

Award flight finder using Amex MR points. Two parallel agents (Seats.aero API + point.me browser) feed a combo math engine that ranks round-trip options by total cost.

## How to run

```bash
node skill/scripts/search.js
```

## Testing

```bash
npx vitest
```

Test framework: vitest. Priority: combo math + score tests first (pure functions).

## Key files

- `skill/scripts/combo.js` — combo math engine (core value)
- `skill/scripts/score.js` — scoring formula + flags
- `skill/scripts/seats-aero.js` — Agent A: Seats.aero API client
- `skill/scripts/pointme.js` — Agent B: point.me browser automation
- `skill/scripts/search.js` — orchestrator (runs both agents, merges, outputs)
- `skill/scripts/programs.js` — Amex MR partner config (slugs, transfer ratios)
- `skill/scripts/sheets.js` — Google Sheets output (CSV fallback)

## Architecture

Two agents run in parallel via `Promise.all`. Agent A hits Seats.aero API (~30s). Agent B browses point.me (~16-20 min). Combo math pairs outbound x return x pax, scores, outputs to Google Sheet.

## Environment

- Runs on Koren's Mac Mini (has Sheets API via OpenClaw + point.me browser session)
- Seats.aero API key: `/Users/q/.openclaw/workspace/credentials/seats-aero-api-key.txt`
- Build code locally, push to git, pull on Mini to run

## Design doc

Full design doc with architecture, combo math detail, and eng review findings:
`~/.gstack/projects/koren-source-bestairdeals/koren-koren-source-review-pdr-design-20260403-142745.md`
