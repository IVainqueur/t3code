import type { TimestampFormat } from "@t3tools/contracts/settings";

import { formatShortTimestamp, parseTimestampDate } from "../timestampFormat";

/** Preset ladder for the menu. Any other value comes from the custom field. */
export const REMINDER_PRESET_MINUTES = [5, 15, 30, 60] as const;

/**
 * A year of minutes. The cap exists so a fat-fingered paste cannot produce a
 * reminder centuries out that then sits in local storage forever.
 */
const MAX_REMINDER_MINUTES = 365 * 24 * 60;

export interface ReminderPreset {
  readonly id: string;
  readonly minutes: number;
  readonly label: string;
  /** Menu-row time column, like SnoozePreset.whenLabel. */
  readonly whenLabel: string;
  readonly remindAt: string;
}

/**
 * Minutes from the custom field. Deliberately strict: only a bare positive
 * integer, so "5m" or "2.5" are rejected rather than silently reinterpreted.
 */
export function parseReminderMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_REMINDER_MINUTES) return null;
  return minutes;
}

export function minutesLabel(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `In ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `In ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function remindAtFromMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function resolveReminderPresets(
  now: Date,
  timestampFormat: TimestampFormat,
): ReadonlyArray<ReminderPreset> {
  return REMINDER_PRESET_MINUTES.map((minutes) => {
    const remindAt = remindAtFromMinutes(now, minutes);
    const at = parseTimestampDate(remindAt);
    return {
      id: String(minutes),
      minutes,
      label: minutesLabel(minutes),
      whenLabel: at === null ? "" : formatShortTimestamp(at.toISOString(), timestampFormat),
      remindAt,
    };
  });
}

/** Human reminder time for menus and toasts, e.g. "17:30". */
export function reminderDescription(remindAt: string, timestampFormat: TimestampFormat): string {
  const at = parseTimestampDate(remindAt);
  return at === null ? "" : formatShortTimestamp(at.toISOString(), timestampFormat);
}
