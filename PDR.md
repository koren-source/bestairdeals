# bestairdeals — Product Design Requirements

> Personal award flight intelligence system for Koren. Finds the lowest Amex Membership Rewards points + fees combinations for any trip — in seconds, not hours.

---

## Vision

A personal award flight intelligence system for Koren. Uses Seats.aero API + point.me to find the lowest Amex Membership Rewards points + fees combinations for any trip. First user = Koren.

---

## Problem

Finding the best award flight redemption requires:

- Checking 15+ loyalty programs manually
- Searching dozens of date combinations
- Calculating outbound + return combos separately (point.me shows one-way pricing)
- Factoring in fees (some programs like BA/Virgin have $400–600 surcharges)
- Knowing which programs accept Amex MR transfers

This takes hours manually. This system does it in seconds.

---

## Solution

Two-agent system that:

1. Queries Seats.aero API for ALL availability across all Amex MR transfer partners simultaneously
2. Browses point.me for exact pricing verification on top candidates
3. Runs combo math (outbound + return × 2 passengers)
4. Scores by: total points + fee penalty
5. Outputs ranked results to a personal Vercel dashboard

---

## Amex MR Transfer Partners (all included)

### Airlines

| Program | Transfer Ratio |
|---|---|
| Flying Blue (Air France/KLM) | 1:1 |
| Virgin Atlantic Flying Club | 1:1 |
| British Airways Avios | 1:1 |
| Iberia Avios | 1:1 |
| Aeroplan (Air Canada) | 1:1 |
| ANA Mileage Club | 1:1 |
| Singapore KrisFlyer | 1:1 |
| Delta SkyMiles | 1:1 |
| Etihad Guest | 1:1 |
| Emirates Skywards | 1:1 |
| Cathay Pacific Asia Miles | 1:1 |
| Avianca LifeMiles | 1:1 |
| Hawaiian Miles | 1:1 |
| JetBlue TrueBlue | 1:0.8 |
| Copa ConnectMiles | 1:1 |

### Hotels (for reference — not included in flight search)

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
  GET /availability?origin_airport=LAS&destination_airport=LHR&cabin=economy&start_date=2026-06-01&end_date=2026-06-30&source=flyingblue
  ```
- **Source param** maps to loyalty program slug (flyingblue, aeroplan, virgin, avios, etc.)
- **Response fields:** `date`, `YAvailable`, `YMileageCost`, `YTotalTaxes`, `YRemainingSeats`, `YAirlines`

### Program Source Slugs

| Program | Slug |
|---|---|
| Flying Blue | `flyingblue` |
| Aeroplan | `aeroplan` |
| Virgin Atlantic | `virgin` |
| British Airways | `avios` |
| Delta SkyMiles | `delta` |
| Emirates | `emirates` |
| Singapore KrisFlyer | `singapore` |
| Etihad | `etihad` |
| ANA | `ana` |
| LifeMiles | `lifemiles` |

---

## point.me Integration

- **URL:** https://amex.point.me (pre-filtered to Amex MR partners)
- **Results endpoint:**
  ```
  https://amex.point.me/results?departureIata=LAS&arrivalIata=LHR&departureDate=2026-06-01&classOfService=economy&legType=oneWay&passengers=1
  ```
- **Use for:** exact pricing verification, UI confirmation, booking instructions
- **Browser automation:** via OpenClaw browser tool (`profile="user"`)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    USER REQUEST                         │
│  "Find best flights LAS→London, June-July, 2 pax econ" │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │     Q (Orchestrator)    │
        │   Parses: origin, dest, │
        │   dates, pax, cabin     │
        └──────┬──────────┬───────┘
               │          │
    ┌──────────▼──┐   ┌───▼──────────┐
    │  Agent A    │   │   Agent B    │
    │ Seats.aero  │   │  point.me    │
    │ API sweep   │   │  browser     │
    │ (all progs) │   │  verify top  │
    └──────┬──────┘   └───┬──────────┘
           │              │
        ┌──▼──────────────▼──┐
        │   Combo Math Engine │
        │  (OB + RET) × pax  │
        │  Score = pts +      │
        │  (fees × 100)       │
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────┐
        │   Output Layer      │
        │  • Google Sheet     │
        │  • Vercel Dashboard │
        │  • Slack summary    │
        └─────────────────────┘
```

---

## Dual-Source Truth Architecture

This is a core design principle. Two independent sources of truth working in sequence — breadth first, then precision.

```
SEATS.AERO (Agent A)          AMEX.POINT.ME (Agent B)
━━━━━━━━━━━━━━━━━━━━          ━━━━━━━━━━━━━━━━━━━━━━━
• API — no browser needed     • Browser automation
• All dates in 1 call         • Real-time Amex pricing
• ~3 second response          • 6-8s per search
• ~30 programs at once        • Amex partners only
• May lag by hours            • Always current
• No booking instructions     • Has booking flow + URL
↓                             ↓
BROAD SWEEP (all options)     VERIFY + CONFIRM (top picks)
```

### What each source provides

**Seats.aero (Agent A):**
- Broad availability sweep across all Amex MR transfer partners simultaneously
- Fast: all programs × all dates in a single API call per program (~3s each)
- Returns: which dates have seats, approximate points cost, fees, seats remaining, operating airlines
- Limitation: data may lag by a few hours; fees can occasionally differ from live pricing

**amex.point.me (Agent B):**
- Exact, real-time pricing as Amex actually sees it — the authoritative source for transfer partner rates
- Browser-based: requires automation, 6–8s per search
- Returns: confirmed pts/fees for exact pax count, 2-pax availability check, actual booking URL and step-by-step booking instructions
- Limitation: too slow to sweep 60+ dates × 15 programs = 900 searches; must be targeted

### How they work together

```
Step 1 — Agent A (Seats.aero API)
  └─ Sweeps all programs × full date range
  └─ Scores all combos (outbound × return)
  └─ Returns: top 20 candidates ranked by score
         ↓
Step 2 — Agent B (amex.point.me browser)
  └─ Verifies top 5 from Agent A
  └─ Confirms exact pts + fees for 2 pax
  └─ Checks real-time seat availability
  └─ Captures booking URL + instructions
         ↓
Step 3 — Final Output
  └─ Seats.aero-sourced + point.me-verified
  └─ Confidence: 90%+
  └─ Each result tagged: [API] or [API + Verified]
```

### Why both matter

| | Seats.aero only | point.me only | Both |
|---|---|---|---|
| Speed | ✅ Fast | ❌ Slow (900+ searches) | ✅ Fast sweep + targeted verify |
| Accuracy | ⚠️ May lag | ✅ Always current | ✅ Confirmed on top picks |
| Coverage | ✅ All dates/programs | ✅ All Amex partners | ✅ Full coverage |
| Booking info | ❌ None | ✅ URL + instructions | ✅ On verified results |
| **Verdict** | Good for discovery | Good for confirmation | **Best of both** |

> **Rule of thumb:** Seats.aero finds the candidates. point.me confirms the winner.

---

## Scoring Formula

```
Score = (total_points_for_all_pax) + (total_fees_usd × 100)
```

**Lower score = better deal.** This weights points and fees roughly equally at ~1¢/point.

### Score Flags

| Flag | Condition |
|---|---|
| ⭐ SWEET SPOT | score < 150,000 |
| ✅ LOW FEES | total fees < $400 |
| ⚠️ HIGH FEES | any leg > $300/person |
| 🔴 AVOID | fees > $500 total (wipes out points value) |

### Example Calculation

> Flying Blue, 2 pax, round trip:
> - Outbound: 62,000 pts × 2 = 124,000 pts, $337 fees
> - Return: 62,000 pts × 2 = 124,000 pts, $337 fees
> - **Score = 248,000 + (674 × 100) = 315,400**
> - Flag: ⚠️ HIGH FEES (borderline)

---

## OpenClaw Skill — Phase 1 (immediate)

**Skill name:** `award-flight-finder`

**Triggers on:**
- "find best flights with points"
- "how many points to fly to X"
- "award flight search"
- "best Amex redemption for X to Y"

**Skill workflow:**
1. Extract: origin, destination, date range, pax count, cabin preference
2. Query Seats.aero for all Amex-compatible programs (parallel calls per source)
3. Build outbound list + return list
4. Run combo math + scoring for all (outbound × return) pairs
5. Sort by score ascending, apply flags
6. Return top 10 combos with booking instructions

**Output format (per combo):**
```
#1 ⭐ Flying Blue — Score: 248,000
  Outbound: Jun 12 LAS→LHR | 62,000 pts/pax | $168.50 fees | KLM | 6 seats
  Return:   Jul 3  LHR→LAS | 62,000 pts/pax | $168.50 fees | KLM | 8 seats
  Total (2 pax): 248,000 pts + $674 fees
  Book at: https://www.flyingblue.com
```

---

## Vercel Dashboard — Phase 2

**URL:** `bestairdeals.vercel.app` (or subdomain of existing q-dashboard)

### Pages

1. **Search** — Input: origin, destination, date range, pax, cabin → triggers agent sweep
2. **Results** — Ranked table of all combos, sortable by pts / fees / score
3. **Saved Searches** — History of previous searches with best results
4. **Points Balance** — Manual input of Amex MR balance + transfer tracking

### Stack

- **Framework:** Next.js (matches existing q-dashboard)
- **Deployment:** Vercel
- **API calls:** Seats.aero via server-side Next.js API routes (keeps API key secure)
- **Auth:** None needed (personal use)
- **Storage:** Vercel KV or simple JSON file for saved searches

---

## Current Trip — Koren's Mom & Sister

| Field | Value |
|---|---|
| Route | LAS → London (LHR/LGW), round trip |
| Cabin | Economy |
| Passengers | 2 |
| Outbound window | June 1 – July 31, 2026 |
| Return | +18–21 days after outbound |
| Goal | Lowest (points + fees) combined |
| Budget | 2M+ Amex MR available |

**Initial API test result:**
> Flying Blue · LAS→LHR · June 1 = **62,000 pts/person + $168.50 fees** · 8 seats available on KLM

---

## Development Phases

### Phase 1 — Now
- [ ] OpenClaw `award-flight-finder` skill
- [ ] Seats.aero API wrapper (`api/seats-aero.js`)
- [ ] Combo math engine
- [ ] Google Sheet output (via Sheets API)
- [ ] Slack summary post to #q

### Phase 2 — Next
- [ ] Vercel dashboard (Next.js)
- [ ] Search UI with agent trigger
- [ ] Results table with sorting/filtering
- [ ] Deploy to `bestairdeals.vercel.app`

### Phase 3 — Future
- [ ] Saved searches with history
- [ ] Price alerts (cron: check daily, ping Slack if score drops)
- [ ] Amex MR balance tracking
- [ ] Multi-trip planner (compare 3+ routes)

---

## Files in This Repo

```
bestairdeals/
├── PDR.md                  ← This document
├── skill/                  ← OpenClaw AgentSkill (award-flight-finder)
│   ├── SKILL.md
│   └── scripts/
│       ├── search.js       ← Main search orchestrator
│       └── score.js        ← Combo math + scoring engine
├── api/                    ← Seats.aero API wrapper scripts
│   ├── seats-aero.js       ← API client
│   └── programs.js         ← Amex MR partner config + slugs
└── dashboard/              ← Vercel Next.js app (Phase 2)
    ├── pages/
    │   ├── index.js        ← Search page
    │   └── results.js      ← Results page
    └── package.json
```

---

## Related Resources

- [Seats.aero Partner API docs](https://seats.aero/docs)
- [point.me (Amex-filtered)](https://amex.point.me)
- [Amex MR transfer partners official list](https://www.americanexpress.com/en-us/rewards/membership-rewards/partners/airline/)
- [Existing Q dashboard](https://github.com/koren-source/q-dashboard) — Next.js reference

---

*Last updated: 2026-04-03 · Author: Q*
