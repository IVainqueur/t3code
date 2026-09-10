import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_NOTIFICATION_SETTINGS } from "./notificationRules";
import { createNotificationTracker } from "./notificationTracker";

const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true };

const observation = (phase: string, turnKey = "turn-1") => ({
  awareness: {
    environmentId: "env-1",
    threadId: "thread-1",
    projectTitle: "acme-web",
    threadTitle: "fix the flaky auth test",
    phase: phase as "running" | "completed",
    headline: "Finished",
  },
  turnKey,
  settings,
  appFocused: false,
  activeThreadKey: null,
});

describe("createNotificationTracker", () => {
  it("does not notify on the first sighting of a thread, then notifies on a real transition", () => {
    const tracker = createNotificationTracker();

    expect(tracker.consider(observation("completed"))).toBeNull();

    const second = createNotificationTracker();
    expect(second.consider(observation("running"))).toBeNull();
    expect(second.consider(observation("completed"))).not.toBeNull();
  });

  it("never fires the same intent twice", () => {
    const tracker = createNotificationTracker();
    tracker.consider(observation("running"));

    expect(tracker.consider(observation("completed"))).not.toBeNull();
    // A repeated projection of the same settled turn must stay quiet.
    tracker.consider(observation("running"));
    expect(tracker.consider(observation("completed"))).toBeNull();
  });

  it("notifies again when a later turn completes in the same thread", () => {
    const tracker = createNotificationTracker();
    tracker.consider(observation("running", "turn-1"));
    expect(tracker.consider(observation("completed", "turn-1"))).not.toBeNull();

    tracker.consider(observation("running", "turn-2"));
    expect(tracker.consider(observation("completed", "turn-2"))).not.toBeNull();
  });

  it("tracks threads independently", () => {
    const tracker = createNotificationTracker();
    tracker.consider(observation("running"));

    const other = {
      ...observation("completed"),
      awareness: { ...observation("completed").awareness, threadId: "thread-2" },
    };
    // thread-2 has never been seen, so its completion is a replay, not news.
    expect(tracker.consider(other)).toBeNull();
    expect(tracker.consider(observation("completed"))).not.toBeNull();
  });
});
