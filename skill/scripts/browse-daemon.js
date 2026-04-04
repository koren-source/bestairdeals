/**
 * browse-daemon.js — Shared browse server lifecycle management.
 * Used by cron.js, api-server.js, and pointme.js.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { getBrowseServer } from './cash-price.js';

export const BROWSE_BIN = join(process.env.HOME ?? '', '.claude/skills/gstack/browse/dist/browse');
export const BROWSE_STARTUP_TIMEOUT_MS = 30_000;
export const BROWSE_POLL_INTERVAL_MS = 500;

/**
 * Start the browse daemon if it isn't already running.
 * Returns the child process (or null if it was already up).
 */
export function startBrowseDaemon() {
  if (getBrowseServer()) {
    console.log('[browse-daemon] Browse server already running');
    return null;
  }

  if (!existsSync(BROWSE_BIN)) {
    throw new Error(
      `Browse binary not found at ${BROWSE_BIN}. Install gstack or start the daemon manually.`
    );
  }

  console.log('[browse-daemon] Starting browse daemon...');
  const child = spawn(BROWSE_BIN, ['--headless'], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  return child;
}

/**
 * Wait for browse.json to appear (daemon ready).
 */
export async function waitForBrowseServer() {
  const deadline = Date.now() + BROWSE_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (getBrowseServer()) {
      console.log('[browse-daemon] Browse server is ready');
      return;
    }
    await new Promise((r) => setTimeout(r, BROWSE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Browse daemon did not start within ${BROWSE_STARTUP_TIMEOUT_MS / 1000}s`
  );
}

/**
 * Kill the browse daemon we started.
 */
export function stopBrowseDaemon(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
    console.log('[browse-daemon] Browse daemon stopped');
  } catch {
    // already exited
  }
}
