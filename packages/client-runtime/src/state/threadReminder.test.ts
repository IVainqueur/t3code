import { describe, expect, it } from "vite-plus/test";

import { nextPendingReminderAtMs, resolveThreadReminder } from "./threadReminder.ts";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const at = (iso: string) => Date.parse(iso);

describe("resolveThreadReminder", () => {
  it("is null when no reminder is set", () => {
    expect(resolveThreadReminder({}, NOW)).toBeNull();
    expect(resolveThreadReminder({ remindAt: null }, NOW)).toBeNull();
  });

  it("is pending before the reminder time", () => {
    expect(resolveThreadReminder({ remindAt: "2026-09-10T12:05:00.000Z" }, NOW)).toBe("pending");
  });

  it("is due once the reminder time has passed and the thread was never visited", () => {
    expect(resolveThreadReminder({ remindAt: "2026-09-10T11:59:00.000Z" }, NOW)).toBe("due");
  });

  it("is due when the last visit predates the reminder", () => {
    expect(
      resolveThreadReminder(
        { remindAt: "2026-09-10T11:59:00.000Z", lastVisitedAt: "2026-09-10T11:00:00.000Z" },
        NOW,
      ),
    ).toBe("due");
  });

  it("is dismissed by a visit after the reminder came due", () => {
    expect(
      resolveThreadReminder(
        { remindAt: "2026-09-10T11:00:00.000Z", lastVisitedAt: "2026-09-10T11:30:00.000Z" },
        NOW,
      ),
    ).toBeNull();
  });

  it("treats a visit exactly at the reminder time as having seen it", () => {
    expect(
      resolveThreadReminder(
        { remindAt: "2026-09-10T11:00:00.000Z", lastVisitedAt: "2026-09-10T11:00:00.000Z" },
        NOW,
      ),
    ).toBeNull();
  });

  it("stays pending regardless of an earlier visit", () => {
    expect(
      resolveThreadReminder(
        { remindAt: "2026-09-10T12:30:00.000Z", lastVisitedAt: "2026-09-10T11:00:00.000Z" },
        NOW,
      ),
    ).toBe("pending");
  });

  it("ignores an unparseable reminder rather than pinning it as due forever", () => {
    expect(resolveThreadReminder({ remindAt: "not-a-date" }, NOW)).toBeNull();
  });

  it("treats an unparseable last visit as never visited, matching unseen-completion", () => {
    expect(
      resolveThreadReminder(
        { remindAt: "2026-09-10T11:00:00.000Z", lastVisitedAt: "nonsense" },
        NOW,
      ),
    ).toBe("due");
  });

  it("fires however overdue it is", () => {
    expect(resolveThreadReminder({ remindAt: "2026-09-07T12:00:00.000Z" }, NOW)).toBe("due");
    expect(at("2026-09-07T12:00:00.000Z") < NOW).toBe(true);
  });
});

describe("nextPendingReminderAtMs", () => {
  it("is null when nothing is pending", () => {
    expect(nextPendingReminderAtMs([], NOW)).toBeNull();
    expect(nextPendingReminderAtMs([{ remindAt: "2026-09-10T11:00:00.000Z" }], NOW)).toBeNull();
  });

  it("returns the soonest future reminder, ignoring past and unparseable ones", () => {
    expect(
      nextPendingReminderAtMs(
        [
          { remindAt: "2026-09-10T13:00:00.000Z" },
          { remindAt: "not-a-date" },
          { remindAt: "2026-09-10T11:00:00.000Z" },
          { remindAt: "2026-09-10T12:20:00.000Z" },
        ],
        NOW,
      ),
    ).toBe(at("2026-09-10T12:20:00.000Z"));
  });
});
