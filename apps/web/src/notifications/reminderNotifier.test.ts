import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_NOTIFICATION_SETTINGS } from "./notificationRules";
import { reminderIntentKey, resolveReminderIntent } from "./reminderNotifier";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true };

const input = (overrides: Record<string, unknown> = {}) => ({
  thread: {
    environmentId: "env-1",
    threadId: "thread-1",
    threadTitle: "fix the flaky auth test",
    projectTitle: "acme-web",
    remindAt: "2026-09-10T11:59:00.000Z",
    lastVisitedAt: null,
  },
  nowMs: NOW,
  settings,
  appFocused: false,
  activeThreadKey: null,
  alreadyFired: () => false,
  ...overrides,
});

describe("resolveReminderIntent", () => {
  it("fires for a due reminder", () => {
    const intent = resolveReminderIntent(input() as never);
    expect(intent).not.toBeNull();
    expect(intent?.threadId).toBe("thread-1");
    expect(intent?.title).toContain("acme-web");
  });

  it("stays silent for a pending reminder", () => {
    const thread = { ...input().thread, remindAt: "2026-09-10T12:30:00.000Z" };
    expect(resolveReminderIntent(input({ thread }) as never)).toBeNull();
  });

  it("stays silent once the thread has been visited", () => {
    const thread = { ...input().thread, lastVisitedAt: "2026-09-10T11:59:30.000Z" };
    expect(resolveReminderIntent(input({ thread }) as never)).toBeNull();
  });

  it("respects the master switch and its own toggle", () => {
    expect(
      resolveReminderIntent(input({ settings: { ...settings, enabled: false } }) as never),
    ).toBeNull();
    expect(
      resolveReminderIntent(input({ settings: { ...settings, reminders: false } }) as never),
    ).toBeNull();
  });

  it("does not fire twice for the same reminder", () => {
    expect(resolveReminderIntent(input({ alreadyFired: () => true }) as never)).toBeNull();
  });

  it("stays silent while that very thread is focused, so it can fire later", () => {
    expect(
      resolveReminderIntent(
        input({ appFocused: true, activeThreadKey: "env-1:thread-1" }) as never,
      ),
    ).toBeNull();
  });

  it("fires when focused on a different thread", () => {
    expect(
      resolveReminderIntent(input({ appFocused: true, activeThreadKey: "env-1:other" }) as never),
    ).not.toBeNull();
  });

  it("keys on the reminder time so a later reminder on the same thread fires again", () => {
    const first = resolveReminderIntent(input() as never);
    const thread = { ...input().thread, remindAt: "2026-09-10T11:30:00.000Z" };
    const second = resolveReminderIntent(input({ thread }) as never);
    expect(first?.key).not.toBe(second?.key);
  });

  it("says how overdue it is once it is more than a minute late", () => {
    const thread = { ...input().thread, remindAt: "2026-09-07T12:00:00.000Z" };
    expect(resolveReminderIntent(input({ thread }) as never)?.body).toContain("3 days");
  });

  it("builds a stable ledger key", () => {
    expect(reminderIntentKey("env-1:thread-1", "2026-09-10T11:59:00.000Z")).toBe(
      "reminder:env-1:thread-1:2026-09-10T11:59:00.000Z",
    );
  });
});
