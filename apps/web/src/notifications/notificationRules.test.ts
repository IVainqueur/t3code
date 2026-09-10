import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  resolveNotificationIntent,
  type NotificationRuleInput,
} from "./notificationRules";

const baseInput = (overrides: Partial<NotificationRuleInput> = {}): NotificationRuleInput => ({
  awareness: {
    environmentId: "env-1",
    threadId: "thread-1",
    projectTitle: "acme-web",
    threadTitle: "fix the flaky auth test",
    phase: "completed",
    headline: "Finished",
    detail: "2 files changed",
  },
  turnKey: "turn-7",
  previousPhase: "running",
  settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
  appFocused: false,
  activeThreadKey: null,
  ...overrides,
});

describe("resolveNotificationIntent", () => {
  it("notifies when a turn completes while the app is in the background", () => {
    const intent = resolveNotificationIntent(baseInput());

    expect(intent).not.toBeNull();
    expect(intent?.threadId).toBe("thread-1");
    expect(intent?.title).toContain("acme-web");
  });

  it("stays silent when the completed thread is already on screen and focused", () => {
    const intent = resolveNotificationIntent(
      baseInput({ appFocused: true, activeThreadKey: "env-1:thread-1" }),
    );

    expect(intent).toBeNull();
  });

  it("notifies when focused on a different thread", () => {
    const intent = resolveNotificationIntent(
      baseInput({ appFocused: true, activeThreadKey: "env-1:thread-other" }),
    );

    expect(intent).not.toBeNull();
  });

  it("notifies when the thread is on screen but the window is not focused", () => {
    const intent = resolveNotificationIntent(
      baseInput({ appFocused: false, activeThreadKey: "env-1:thread-1" }),
    );

    expect(intent).not.toBeNull();
  });

  it("stays silent when notifications are switched off entirely", () => {
    const intent = resolveNotificationIntent(
      baseInput({ settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false } }),
    );

    expect(intent).toBeNull();
  });

  it("stays silent when the event's own toggle is off", () => {
    const intent = resolveNotificationIntent(
      baseInput({
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, turnComplete: false },
      }),
    );

    expect(intent).toBeNull();
  });

  it("suppresses a completed phase seen for the first time, so reconnects do not storm", () => {
    const intent = resolveNotificationIntent(baseInput({ previousPhase: null }));

    expect(intent).toBeNull();
  });

  it("stays silent when the phase has not actually changed", () => {
    const intent = resolveNotificationIntent(baseInput({ previousPhase: "completed" }));

    expect(intent).toBeNull();
  });

  it("ignores phases that are not user-actionable", () => {
    for (const phase of ["starting", "running", "stale"] as const) {
      expect(
        resolveNotificationIntent(baseInput({ awareness: { ...baseInput().awareness, phase } })),
      ).toBeNull();
    }
  });

  it("maps each actionable phase to its own toggle", () => {
    const cases = [
      { phase: "waiting_for_approval", toggle: "approvalRequired" },
      { phase: "waiting_for_input", toggle: "inputRequested" },
      { phase: "failed", toggle: "turnFailed" },
    ] as const;

    for (const { phase, toggle } of cases) {
      const awareness = { ...baseInput().awareness, phase };
      expect(resolveNotificationIntent(baseInput({ awareness }))).not.toBeNull();
      expect(
        resolveNotificationIntent(
          baseInput({
            awareness,
            settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, [toggle]: false },
          }),
        ),
      ).toBeNull();
    }
  });

  it("carries the sound preference through as the silent flag", () => {
    expect(resolveNotificationIntent(baseInput())?.silent).toBe(false);
    expect(
      resolveNotificationIntent(
        baseInput({ settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, sound: false } }),
      )?.silent,
    ).toBe(true);
  });

  it("keys on the turn so a later turn in the same thread can notify again", () => {
    const first = resolveNotificationIntent(baseInput({ turnKey: "turn-7" }));
    const second = resolveNotificationIntent(baseInput({ turnKey: "turn-8" }));

    expect(first?.key).not.toBe(second?.key);
    expect(first?.key).toContain("thread-1");
  });
});

describe("DEFAULT_NOTIFICATION_SETTINGS", () => {
  it("ships switched off so an update never starts notifying unprompted", () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.enabled).toBe(false);
  });
});
