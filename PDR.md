# bestairdeals — Product Design Requirements

> Personal award flight intelligence system for Koren. Finds the lowest Amex Membership Rewards points + fees combinations for any trip using two parallel data sources and combo math.

---

## Vision

Find the best award flight redemptions using Amex MR points. Two agents sweep independent data sources in parallel, a combo math engine pairs every outbound with every valid return, scores them, and outputs ranked results to a Google Sheet. First user = Koren. First trip = mom and sister to London.

---

## Problem

Finding the best award flight redemption requires:

- Checking 15+ loyalty programs manually
- Searching dozens of date combinations
- Calculating outbound + return combos separately (point.me shows one-way pricing only)
- Factoring in fees (some programs like BA/Virgin have $400-600 surcharges)
- Knowing which programs accept Amex MR transfers and at what ratio

This takes hours manually. This system does it in minutes.

---

## Solution

Two-agent system that:

1. **Agent A (Seats.aero API):** Sweeps ALL availability across all Amex MR transfer partners simultaneously
2. **Agent B (point.me browser):** Independently sweeps all dates for real-time Amex pricing
3. **Combo math engine:** Pairs every valid outbound + return combination for N passengers
4. **Scoring:** Ranks by total points + fee penalty
5. **Output:** Google Sheet (CSV fallback) with ranked results

---

## Amex MR Transfer Partners (all included)

### Airlines

| Program | Transfer Ratio | Seats.aero Slug | Notes |
|---|---|---|---|
| Flying Blue (Air France/KLM) | 1:1 | `flyingblue` | |
| Virgin Atlantic Flying Club | 1:1 | `virgin` | |
| British Airways Avios | 1:1 | `avios` | High fees on some routes |
| Iberia Avios | 1:1 | — | Shares Avios with BA |
| Aeroplan (Air Canada) | 1:1 | `aeroplan` | |
| ANA Mileage Club | 1:1 | `ana` | |
| Singapore KrisFlyer | 1:1 | `singapore` | |
| Delta SkyMiles | 1:1 | `delta` | Often high point costs |
| Etihad Guest | 1:1 | `etihad` | |
| Emirates Skywards | 1:1 | `emirates` | |
| Cathay Pacific Asia Miles | 1:1 | — | No Seats.aero slug |
| Avianca LifeMiles | 1:1 | `lifemiles` | |
| Hawaiian Miles | 1:1 | — | No Seats.aero slug |
| JetBlue TrueBlue | 1:0.8 | — | **Non-1:1 ratio: needs MR normalization** |
| Copa ConnectMiles | 1:1 | — | No Seats.aero slug |

> **INVESTIGATE:** Programs with non-1:1 transfer ratios (JetBlue 1:0.8) need MR-equivalent normalization in scoring. If Seats.aero returns 80,000 JetBlue points, the actual MR cost is 100,000 (80,000 / 0.8). The `programs.js` config must include the ratio and normalize before scoring.

### Hotels (for reference, not included in flight search)

| Program | Transfer Ratio |
|---|---|
| Hilton Honors | 1:2 |
| Marriott Bonvoy | 1:1 |

---

## Seats.aero API Integration

- **API key:** stored at `/Users/q/.openclaw/workspace/credentials/seats-aero-api-key.txt`
- **Base URL:** `https://seats.aero/partnerapi`
- **Key endpoint:**
  ```
  GET /availability?origin_airport=LAS&destination_airport=LHR&cabin=economy&start_date=2026-06-01&end_date=2026-07-14&source=flyingblue
  ```
- **Source param** maps to loyalty program slug
- **Response fields:** `date`, `YAvailable`, `YMileageCost`, `YTotalTaxes`, `YRemainingSeats`, `YAirlines`
- **Field mapping to internal schema:**
  - `YMileageCost` → `pts_per_pax`
  - `YTotalTaxes` → `fees_per_pax`
  - `YRemainingSeats` → `seats`
  - `YAirlines` → `airline`

---

## point.me Integration

- **URL:** https://amex.point.me (pre-filtered to Amex MR partners)
- **Results endpoint:**
  ```
  https://amex.point.me/results?departureIata=LAS&arrivalIata=LHR&departureDate=2026-06-01&classOfService=economy&legType=oneWay&passengers=1
  ```
- **Use for:** independent pricing sweep across all dates, booking URLs
- **Browser automation:** via OpenClaw browser tool (`profile="user"`) on Mac Mini
- **One search shows all Amex MR partner results for that date**
- **Throttling:** 2-second delay between requests, retry with 10s backoff on rate limit

> **INVESTIGATE:** point.me may detect and block automation after many sequential searches. Test with a small batch (5-10 searches) first before running the full 91-date sweep. No CAPTCHA handling in v1.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    USER REQUEST                          │
│  "Find best flights LAS→London, Jun-Jul, 2 pax econ"   │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │     Orchestrator        │
        │   (search.js)           │
        │   Parse: origin, dest,  │
        │   dates, pax, cabin     │
        └──────┬──────────┬───────┘
               │          │
               │  Promise.all (parallel)
               │          │
    ┌──────────▼──┐   ┌───▼──────────┐
    │  Agent A    │   │   Agent B    │
    │ Seats.aero  │   │  point.me    │
    │ API sweep   │   │  browser     │
    │ ~30 seconds │   │  ~16-20 min  │
    │ All programs│   │  All dates   │
    │ All dates   │   │  One-way     │
    └──────┬──────┘   └───┬──────────┘
           │              │
        ┌──▼──────────────▼──┐
        │   Merge + Dedup    │
        │ point.me wins on   │
        │ duplicates         │
        │ [API] [Verified]   │
        │ [Both] [PARTIAL]   │
        └──────────┬─────────┘
                   │
        ┌──────────▼──────────┐
        │   COMBO MATH        │
        │                     │
        │  For each outbound: │
        │   For each return   │
        │    where trip =     │
        │    18-21 days AND   │
        │    seats >= pax:    │
        │    total_pts =      │
        │    (O+R) × pax     │
        │    total_fees =     │
        │    (O+R) × pax     │
        │    score = pts +    │
        │    (fees × 100)     │
        │                     │
        │  Sort by score ASC  │
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────┐
        │   Google Sheet      │
        │   (CSV fallback)    │
        │   Top combos ranked │
        │   Shareable link    │
        └─────────────────────┘
```

---

## Dual-Source Architecture

Both agents run independently in parallel. This is NOT sequential (Agent A then Agent B). Both sweep their full date ranges simultaneously.

```
SEATS.AERO (Agent A)          AMEX.POINT.ME (Agent B)
━━━━━━━━━━━━━━━━━━━━          ━━━━━━━━━━━━━━━━━━━━━━━
• API, no browser needed      • Browser automation
• 1 call per program          • 1 search per date (all programs)
• ~3 second response          • 6-8s per search + 2s throttle
• 10 programs queried         • Shows all Amex partners per search
• May lag by hours            • Always current
• No booking instructions     • Has booking flow + URL
↓                             ↓
BROAD SWEEP                   INDEPENDENT SWEEP
(all programs × all dates)    (all dates × all programs)
```

### Merge rules

When both agents find the same flight (same route, date, program):
- **point.me price wins** (real-time, authoritative for Amex pricing)
- Result tagged `[Both]`
- Seats.aero-only results tagged `[API]`
- point.me-only results tagged `[Verified]`
- Partial agent failure results tagged `[PARTIAL]`

### Error handling

- Agent A fails: run combo math on Agent B data only
- Agent B fails or partial: run combo math on whatever data exists, flag `[PARTIAL]`
- Both fail: error, no output written

---

## Scoring Formula

```
Score = (total_points_for_all_pax) + (total_fees_usd × 100)
```

**Lower score = better deal.**

The multiplier (100) approximates a ~1 cent-per-point valuation. At 1 cpp, $1 of fees = 100 points of cost. This weights points and fees roughly equally. Adjust multiplier to taste (e.g., 70 for a 0.7 cpp valuation).

### Score Flags (v1)

| Flag | Condition |
|---|---|
| HIGH FEES | total_fees > $800 (2 pax round trip) |

v1 keeps flags minimal. Expand with SWEET SPOT, LOW FEES, AVOID flags later.

### Seat Availability Guard

Combos are only generated when `seats >= pax` on BOTH legs. A flight with 1 seat available is excluded when searching for 2 passengers.

### Example Calculation

> Flying Blue, 2 pax, round trip:
> - Outbound: 62,000 pts × 2 = 124,000 pts, $168 fees × 2 = $336
> - Return: 62,000 pts × 2 = 124,000 pts, $168 fees × 2 = $336
> - **Total: 248,000 pts + $672 fees**
> - **Score = 248,000 + (672 × 100) = 315,200**

---

## Current Trip — Koren's Mom & Sister

| Field | Value |
|---|---|
| Route | LAS → London (**LHR and LGW**), round trip |
| Cabin | Economy |
| Passengers | 2 |
| Outbound sweep | June 1 - July 14, 2026 |
| Return sweep | June 19 - August 4, 2026 |
| Trip length | 18-21 days |
| Goal | Lowest (points + fees) combined |
| Budget | 2M+ Amex MR available |

> **Both LHR and LGW must be searched.** Some programs (Norwegian, certain BA routes) operate from Gatwick. Hardcoding LHR only misses potentially better options.

**Initial API test result:**
> Flying Blue, LAS→LHR, June 1 = **62,000 pts/person + $168.50 fees**, 8 seats available on KLM

---

## Development Phases

### Phase 1 — Now (3-day build)

Build a runnable Node.js script first. OpenClaw skill wrapper comes after it works.

- [ ] `combo.js` — combo math engine (core value, build + test first)
- [ ] `score.js` — scoring + flag logic
- [ ] `seats-aero.js` — Agent A: Seats.aero API client
- [ ] `pointme.js` — Agent B: point.me browser automation
- [ ] `search.js` — orchestrator: parse input, run both agents via `Promise.all`, merge/dedup
- [ ] `programs.js` — Amex MR partner config (slugs, transfer ratios)
- [ ] `sheets.js` — Google Sheet output (CSV fallback)
- [ ] Tests: vitest, combo math + score tests day 1, API/browser tests day 2-3
- [ ] Smoke test day 1: 1 API call, 1 browser nav, 1 output write

### Phase 2 — Later (deferred)
- [ ] OpenClaw skill wrapper (`SKILL.md`)
- [ ] Vercel dashboard (Next.js)
- [ ] Slack summary

### Phase 3 — Future (deferred)
- [ ] Price alerts (cron: check daily)
- [ ] Saved searches with history
- [ ] Amex MR balance tracking
- [ ] Multi-trip planner

---

## Files in This Repo

```
bestairdeals/
├── PDR.md                    ← This document
├── CLAUDE.md                 ← Project context for AI agents
├── skill/
│   └── scripts/
│       ├── search.js         ← Orchestrator: parse input, dispatch agents, merge/dedup
│       ├── seats-aero.js     ← Agent A: Seats.aero API client
│       ├── pointme.js        ← Agent B: point.me browser automation
│       ├── combo.js          ← Combo math: builds all valid (outbound × return) pairs
│       ├── score.js          ← Scoring: computes score + applies flags
│       ├── sheets.js         ← Google Sheets output writer (CSV fallback)
│       └── programs.js       ← Amex MR partner config (slugs, ratios, names)
├── test/                     ← vitest tests
│   ├── combo.test.js
│   └── score.test.js
└── output/                   ← CSV fallback output directory
```

---

## Related Resources

- [Seats.aero Partner API docs](https://seats.aero/docs)
- [point.me (Amex-filtered)](https://amex.point.me)
- [Amex MR transfer partners official list](https://www.americanexpress.com/en-us/rewards/membership-rewards/partners/airline/)

---

*Last updated: 2026-04-03 · Author: Q + gstack /plan-eng-review*
