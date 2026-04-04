/**
 * api-server.js — Hono API server for dashboard-driven searches.
 *
 * Endpoints:
 *   POST   /search   — Start a search, returns SSE stream
 *   DELETE /search   — Abort the active search
 *   GET    /status   — Health check + search state
 *   GET    /history  — Recent search history
 *
 * Runs on Mac Mini, port 3001.
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { startBrowseDaemon, waitForBrowseServer, stopBrowseDaemon } from './browse-daemon.js';
import { validateSearchParams } from './config.js';
import { getBrowseServer } from './cash-price.js';
import { PROGRAMS } from './programs.js';
import { detectBonuses } from './bonus-detect.js';
import { runSearchStreaming, writeOutputs } from './search.js';

const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const API_TOKEN = process.env.API_TOKEN;
const VERCEL_ORIGIN = process.env.VERCEL_ORIGIN || '*';
const HISTORY_FILE = 'output/search-history.jsonl';

const app = new Hono();

// CORS — allow Vercel production + preview deploys
app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return VERCEL_ORIGIN; // non-browser requests
    if (VERCEL_ORIGIN === '*') return '*';
    if (origin === VERCEL_ORIGIN) return origin;
    if (origin.endsWith('.vercel.app')) return origin;
    return VERCEL_ORIGIN;
  },
}));

// Auth middleware
app.use('/*', async (c, next) => {
  // Skip auth check if no token configured (local dev)
  if (!API_TOKEN) return next();

  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${API_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// ─── Search Mutex ───────────────────────────────────────────────────────

let activeSearch = null; // { id, startedAt, abortFlag, params }

// ─── POST /search ───────────────────────────────────────────────────────

app.post('/search', async (c) => {
  if (activeSearch) {
    return c.json(
      { error: 'Search already running', started_at: activeSearch.startedAt },
      409
    );
  }

  let params;
  try {
    params = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  let config;
  try {
    config = validateSearchParams(params);
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }

  const searchId = randomUUID();
  activeSearch = {
    id: searchId,
    startedAt: new Date().toISOString(),
    abortFlag: false,
    params,
  };

  // Detect bonuses
  let programs = { ...PROGRAMS };
  for (const key of Object.keys(programs)) {
    programs[key] = { ...programs[key] };
  }
  try {
    const bonuses = await detectBonuses();
    if (bonuses && bonuses.length > 0) {
      for (const bonus of bonuses) {
        if (programs[bonus.program] && typeof bonus.bonus_ratio === 'number' &&
            bonus.bonus_ratio >= 1.0 && bonus.bonus_ratio <= 2.0) {
          programs[bonus.program].bonus_ratio = bonus.bonus_ratio;
        }
      }
    }
  } catch {
    // Continue without bonuses
  }

  return streamSSE(c, async (stream) => {
    let eventId = 0;

    const sendEvent = async (event, data) => {
      eventId++;
      await stream.writeSSE({ event, data: JSON.stringify(data), id: String(eventId) });
    };

    // Detect client disconnect
    const abortSignal = c.req.raw.signal;
    abortSignal?.addEventListener('abort', () => {
      if (activeSearch?.id === searchId) {
        activeSearch.abortFlag = true;
        console.log(`[api] Client disconnected, aborting search ${searchId}`);
      }
    });

    // Heartbeat every 30s
    const heartbeat = setInterval(async () => {
      try {
        await sendEvent('heartbeat', {});
      } catch {
        // Stream closed
        clearInterval(heartbeat);
      }
    }, 30_000);

    const startTime = Date.now();

    try {
      const callbacks = {
        onProgress: async (data) => {
          try { await sendEvent('progress', data); } catch { /* stream closed */ }
        },
        onPartial: async (scored, seatsCount) => {
          try {
            await sendEvent('partial', {
              phase: 'seats_complete',
              combos: scored.slice(0, 20),
              total_combos: scored.length,
              seats_records: seatsCount,
            });
          } catch { /* stream closed */ }
        },
        onUpdate: async (scored, pointmeCount) => {
          try {
            await sendEvent('update', {
              combos: scored.slice(0, 20),
              total_combos: scored.length,
              pointme_records: pointmeCount,
            });
          } catch { /* stream closed */ }
        },
        onError: async (data) => {
          try { await sendEvent('error', { message: data.error, agent: data.agent, recoverable: true }); } catch { /* stream closed */ }
        },
        shouldAbort: () => activeSearch?.abortFlag === true,
      };

      const { scored, nearMisses, totalRecords } = await runSearchStreaming(config, programs, callbacks);

      // Write outputs (sheets, report, web data, history, notify)
      await writeOutputs(scored, nearMisses, config, programs, totalRecords);

      const durationS = ((Date.now() - startTime) / 1000).toFixed(1);

      // Send done event
      await sendEvent('done', {
        combos: scored.slice(0, 50),
        total_combos: scored.length,
        total_records: totalRecords,
        duration_s: parseFloat(durationS),
      });

      // Write search history
      writeSearchHistory({
        id: searchId,
        params,
        started_at: activeSearch.startedAt,
        completed_at: new Date().toISOString(),
        duration_s: parseFloat(durationS),
        combo_count: scored.length,
        top_result: scored[0] ? {
          score: scored[0].score,
          total_pts: scored[0].total_pts,
          total_fees: scored[0].total_fees,
          programs: `${scored[0].outbound.program}+${scored[0].return.program}`,
        } : null,
      });

    } catch (err) {
      console.error(`[api] Search ${searchId} failed: ${err.message}`);
      try {
        await sendEvent('error', { message: err.message, recoverable: false });
      } catch { /* stream closed */ }
    } finally {
      clearInterval(heartbeat);
      activeSearch = null;
    }
  });
});

// ─── DELETE /search ─────────────────────────────────────────────────────

app.delete('/search', (c) => {
  if (!activeSearch) {
    return c.json({ error: 'No active search' }, 404);
  }
  activeSearch.abortFlag = true;
  return c.json({ message: 'Abort requested', search_id: activeSearch.id });
});

// ─── GET /status ────────────────────────────────────────────────────────

app.get('/status', (c) => {
  return c.json({
    online: true,
    browse_server: getBrowseServer() ? 'ready' : 'not_running',
    search: activeSearch
      ? { active: true, started_at: activeSearch.startedAt, id: activeSearch.id }
      : { active: false },
    last_search: readLastSearch(),
  });
});

// ─── GET /history ───────────────────────────────────────────────────────

app.get('/history', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '10', 10), 50);
  return c.json(readHistory(limit));
});

// ─── Search History Helpers ─────────────────────────────────────────────

function writeSearchHistory(entry) {
  try {
    if (!existsSync('output')) mkdirSync('output', { recursive: true });
    appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error(`[api] Failed to write search history: ${err.message}`);
  }
}

function readHistory(limit = 10) {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const lines = readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean);
    return lines
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

function readLastSearch() {
  const history = readHistory(1);
  return history[0] || null;
}

// ─── Server Startup ─────────────────────────────────────────────────────

async function main() {
  // Auto-start browse daemon
  let browseChild = null;
  try {
    browseChild = startBrowseDaemon();
    if (browseChild) await waitForBrowseServer();
  } catch (err) {
    console.warn(`[api] Browse daemon failed to start: ${err.message}`);
    console.warn('[api] Cash prices and point.me searches will not work until browse daemon is running');
  }

  serve({ fetch: app.fetch, port: API_PORT }, (info) => {
    console.log(`[api] bestairdeals API server running on port ${info.port}`);
    console.log(`[api] Browse server: ${getBrowseServer() ? 'ready' : 'not running'}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[api] Shutting down...');
    stopBrowseDaemon(browseChild);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
