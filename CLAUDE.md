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

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
