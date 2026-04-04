import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notify, buildNotifyMessage } from "../skill/scripts/notify.js";
import { PROGRAMS } from "../skill/scripts/programs.js";

describe("notify", () => {
  beforeEach(() => {
    // Clear env vars
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.NOTIFY_EMAIL;
    delete process.env.AGENTMAIL_API_KEY;
  });

  it("skips silently when no webhook or email configured", async () => {
    const config = { notifications: { slack_webhook: null, email: null } };

    // Should not throw
    await expect(notify("test message", config)).resolves.toBeUndefined();
  });

  it("logs warning on Slack webhook failure but does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Mock fetch to simulate webhook failure
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const config = { notifications: { slack_webhook: "https://hooks.slack.com/test", email: null } };

    // Should not throw
    await expect(notify("test message", config)).resolves.toBeUndefined();

    // Should have logged a warning
    expect(warnSpy).toHaveBeenCalled();
    const warned = warnSpy.mock.calls.some((call) =>
      call[0].includes("notify/slack") || call[0].includes("Failed")
    );
    expect(warned).toBe(true);

    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });
});

describe("buildNotifyMessage", () => {
  it("includes required fields: combo count and top deal", () => {
    const confirmed = [{ id: 1 }, { id: 2 }];
    const likely = [{ id: 3 }];
    const topDeal = {
      outbound: { date: "2026-06-05", program: "flyingblue", seats_available: 8 },
      return: { date: "2026-06-23", program: "virgin" },
      total_pts: 118000,
      total_fees: 337,
      score: 151700,
    };

    const msg = buildNotifyMessage(confirmed, likely, 500, topDeal, "output/results.csv", PROGRAMS);

    // Combo counts
    expect(msg).toContain("2 confirmed");
    expect(msg).toContain("1 likely");
    expect(msg).toContain("500 flight records");

    // Top deal info
    expect(msg).toContain("Flying Blue");
    expect(msg).toContain("Virgin Atlantic");
    expect(msg).toContain("2026-06-05");
    expect(msg).toContain("2026-06-23");
    expect(msg).toContain("118000 MR");
    expect(msg).toContain("$337");

    // File path
    expect(msg).toContain("output/results.csv");
  });
});
