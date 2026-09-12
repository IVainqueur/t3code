import { describe, expect, it } from "vite-plus/test";

import {
  parseReminderMinutes,
  REMINDER_PRESET_MINUTES,
  resolveReminderPresets,
} from "./Sidebar.reminder";

const NOW = new Date("2026-09-10T12:00:00.000Z");

describe("parseReminderMinutes", () => {
  it("accepts a plain positive integer", () => {
    expect(parseReminderMinutes("7")).toBe(7);
    expect(parseReminderMinutes("  90 ")).toBe(90);
  });

  it("accepts any number of minutes, not just the presets", () => {
    expect(parseReminderMinutes("1")).toBe(1);
    expect(parseReminderMinutes("523")).toBe(523);
  });

  it("rejects zero, negatives and fractions", () => {
    expect(parseReminderMinutes("0")).toBeNull();
    expect(parseReminderMinutes("-5")).toBeNull();
    expect(parseReminderMinutes("2.5")).toBeNull();
  });

  it("rejects nonsense and empty input", () => {
    expect(parseReminderMinutes("")).toBeNull();
    expect(parseReminderMinutes("soon")).toBeNull();
    expect(parseReminderMinutes("5m")).toBeNull();
  });

  it("rejects absurd values rather than producing a date centuries out", () => {
    expect(parseReminderMinutes("100000000")).toBeNull();
  });
});

describe("resolveReminderPresets", () => {
  it("offers the preset ladder as future times", () => {
    const presets = resolveReminderPresets(NOW, "24-hour");
    expect(presets.map((p) => p.minutes)).toEqual([...REMINDER_PRESET_MINUTES]);
    for (const preset of presets) {
      expect(Date.parse(preset.remindAt)).toBeGreaterThan(NOW.getTime());
    }
  });

  it("offsets each preset by exactly its minutes", () => {
    const presets = resolveReminderPresets(NOW, "24-hour");
    const fifteen = presets.find((p) => p.minutes === 15);
    expect(Date.parse(fifteen!.remindAt) - NOW.getTime()).toBe(15 * 60_000);
  });

  it("labels each preset in plain language", () => {
    const presets = resolveReminderPresets(NOW, "24-hour");
    expect(presets.find((p) => p.minutes === 60)?.label).toBe("In 1 hour");
    expect(presets.find((p) => p.minutes === 5)?.label).toBe("In 5 minutes");
  });
});
