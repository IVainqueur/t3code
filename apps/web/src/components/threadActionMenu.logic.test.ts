import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  branch: null,
  isPinned: false,
  isSettled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: { settlement: true, snooze: true, pinning: true, titleRegeneration: true },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

function allIds(state: ThreadActionMenuState): string[] {
  const flatten = (items: ReturnType<typeof buildThreadActionMenuItems>): string[] =>
    items.flatMap((item) => [item.id, ...(item.children ? flatten(item.children) : [])]);
  return flatten(buildThreadActionMenuItems(state));
}

describe("buildThreadActionMenuItems", () => {
  it("hides lifecycle items when the environment lacks the capabilities", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toEqual(["rename", "mark-unread", "copy", "project-settings", "archive", "delete"]);
  });

  it("groups project settings with utility actions before archive", () => {
    const items = buildThreadActionMenuItems(baseState);
    const copyIndex = items.findIndex((item) => item.id === "copy");
    expect(items[copyIndex + 1]).toMatchObject({
      id: "project-settings",
      label: "Project settings",
      icon: "settings",
    });
    expect(items[copyIndex + 2]?.id).toBe("archive");
  });

  it("includes branch items only for threads with a branch", () => {
    const withBranch = allIds({ ...baseState, branch: "feat/menu" });
    expect(withBranch).toContain("new-thread-on-branch");
    expect(withBranch).toContain("copy-branch");
    expect(allIds(baseState)).not.toContain("new-thread-on-branch");
    expect(allIds(baseState)).not.toContain("copy-branch");
  });

  it("flips lifecycle labels with thread state", () => {
    expect(ids({ ...baseState, isPinned: true, isSettled: true, isSnoozed: true })).toEqual(
      expect.arrayContaining(["unpin", "unsettle", "unsnooze"]),
    );
    expect(ids(baseState)).toEqual(expect.arrayContaining(["pin", "settle", "snooze"]));
  });

  it("disables snooze when the thread cannot snooze, keeping presets visible", () => {
    const snooze = buildThreadActionMenuItems({ ...baseState, canSnoozeNow: false }).find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour"]);
  });

  it("disables title regeneration while one is in flight", () => {
    const item = buildThreadActionMenuItems({ ...baseState, isRegeneratingTitle: true }).find(
      (candidate) => candidate.id === "regenerate-title",
    );
    expect(item).toMatchObject({ label: "Regenerating…", disabled: true });
  });

  it("marks delete as destructive and keeps it last", () => {
    const items = buildThreadActionMenuItems({ ...baseState, branch: "main" });
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });
  it("offers archive as a non-destructive action right before delete", () => {
    const items = buildThreadActionMenuItems(baseState);
    const archiveItem = items.at(-2);
    expect(archiveItem?.id).toBe("archive");
    expect(archiveItem?.icon).toBe("archive");
    expect(archiveItem?.separatorBefore).toBe(true);
    expect(archiveItem?.destructive).toBeFalsy();
    expect(items.at(-1)?.id).toBe("delete");
  });

  it("keeps archive available even when the environment lacks every other capability", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toContain("archive");
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});

describe("reminder menu items", () => {
  const reminderPresets = [
    {
      id: "5",
      minutes: 5,
      label: "In 5 minutes",
      whenLabel: "12:05",
      remindAt: "2026-09-10T12:05:00.000Z",
    },
    {
      id: "15",
      minutes: 15,
      label: "In 15 minutes",
      whenLabel: "12:15",
      remindAt: "2026-09-10T12:15:00.000Z",
    },
  ];

  it("offers a reminder submenu with one entry per preset plus a custom option", () => {
    const flat = allIds({ ...baseState, reminderPresets });
    expect(flat).toContain("remind");
    expect(flat).toContain("remind:5");
    expect(flat).toContain("remind:15");
    expect(flat).toContain("remind-custom");
  });

  it("offers clearing instead of setting once a reminder exists", () => {
    const flat = allIds({ ...baseState, reminderPresets, hasReminder: true });
    expect(flat).toContain("clear-reminder");
    expect(flat).not.toContain("remind:5");
  });

  it("omits the custom option for surfaces that cannot host the minutes field", () => {
    const flat = allIds({ ...baseState, reminderPresets, supportsCustomReminder: false });
    expect(flat).toContain("remind:5");
    expect(flat).not.toContain("remind-custom");
  });

  it("omits reminders entirely when no presets are supplied", () => {
    const flat = allIds({ ...baseState, reminderPresets: [] });
    expect(flat).not.toContain("remind");
    expect(flat).not.toContain("clear-reminder");
  });

  it("leaves the existing menu untouched for callers that never pass reminders", () => {
    expect(allIds(baseState)).not.toContain("remind");
  });
});

describe("window menu items", () => {
  const otherWindowIds = [
    { id: "window-2", label: "Window 2" },
    { id: "window-3", label: "Window 3" },
  ];

  it("offers 'Open in New Window' on desktop", () => {
    expect(allIds({ ...baseState, isDesktop: true })).toContain("open-in-new-window");
  });

  it("offers 'Add to Window' with one entry per other window when any exist", () => {
    const items = buildThreadActionMenuItems({ ...baseState, isDesktop: true, otherWindowIds });
    const addToWindow = items.find((item) => item.id === "add-to-window");
    expect(addToWindow?.children?.map((child) => child.id)).toEqual([
      "add-to-window:window-2",
      "add-to-window:window-3",
    ]);
  });

  it("omits 'Add to Window' when no other windows are open", () => {
    const flat = allIds({ ...baseState, isDesktop: true, otherWindowIds: [] });
    expect(flat).not.toContain("add-to-window");
  });

  it("hides both window items outside the desktop app", () => {
    const flat = allIds({ ...baseState, isDesktop: false, otherWindowIds });
    expect(flat).not.toContain("open-in-new-window");
    expect(flat).not.toContain("add-to-window");
  });

  it("hides both window items when isDesktop is unset, matching the web/chat-header caller", () => {
    const flat = allIds(baseState);
    expect(flat).not.toContain("open-in-new-window");
    expect(flat).not.toContain("add-to-window");
  });
});
