import { describe, it, expect, vi, beforeEach } from 'vitest';

// We can't easily test the real daemon without the binary, so we test the logic.
// Import the module to verify it exports correctly.
describe('browse-daemon exports', () => {
  it('exports all expected functions and constants', async () => {
    const mod = await import('../skill/scripts/browse-daemon.js');
    expect(typeof mod.startBrowseDaemon).toBe('function');
    expect(typeof mod.waitForBrowseServer).toBe('function');
    expect(typeof mod.stopBrowseDaemon).toBe('function');
    expect(typeof mod.BROWSE_BIN).toBe('string');
    expect(typeof mod.BROWSE_STARTUP_TIMEOUT_MS).toBe('number');
    expect(typeof mod.BROWSE_POLL_INTERVAL_MS).toBe('number');
  });

  it('BROWSE_BIN contains expected path fragment', async () => {
    const mod = await import('../skill/scripts/browse-daemon.js');
    expect(mod.BROWSE_BIN).toContain('browse');
  });

  it('stopBrowseDaemon is no-op with null', async () => {
    const mod = await import('../skill/scripts/browse-daemon.js');
    // Should not throw
    expect(() => mod.stopBrowseDaemon(null)).not.toThrow();
  });

  it('BROWSE_STARTUP_TIMEOUT_MS is 30 seconds', async () => {
    const mod = await import('../skill/scripts/browse-daemon.js');
    expect(mod.BROWSE_STARTUP_TIMEOUT_MS).toBe(30_000);
  });
});
