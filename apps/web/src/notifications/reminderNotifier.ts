/**
 * Reminder notifications.
 *
 * Deliberately separate from notificationRules: that module suppresses a phase
 * it is seeing for the first time, to stop a reconnect from replaying every
 * settled thread. For a reminder that is exactly backwards — a reminder which
 * came due while the app was shut IS a first sighting, and firing it then is
 * the whole point.
 *
 * "Fired already" therefore lives in a small per-device ledger keyed on the
 * reminder time, which is immutable for the life of a reminder. The first
 * launch after the due moment is the first time that key is seen.
 */
import {
  resolveThreadReminder,
  type ThreadReminderInput,
} from "@t3tools/client-runtime/state/thread-reminder";
import type { NotificationSettings } from "@t3tools/contracts/settings";

import type { NotificationIntent } from "./notificationRules";

export interface ReminderThread extends ThreadReminderInput {
  readonly environmentId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly projectTitle: string;
}

export interface ReminderIntentInput {
  readonly thread: ReminderThread;
  readonly nowMs: number;
  readonly settings: NotificationSettings;
  readonly appFocused: boolean;
  /** Scoped key of the thread on screen, `environmentId:threadId`. */
  readonly activeThreadKey: string | null;
  readonly alreadyFired: (key: string) => boolean;
}

/** Must match scopedThreadKey's `environmentId:threadId` format. */
const threadKeyOf = (thread: ReminderThread) => `${thread.environmentId}:${thread.threadId}`;

export function reminderIntentKey(threadKey: string, remindAt: string): string {
  return `reminder:${threadKey}:${remindAt}`;
}

/** Plain-language lateness, so "3 days" beats a bare timestamp in a banner. */
function overdueLabel(remindAtMs: number, nowMs: number): string | null {
  const lateMs = nowMs - remindAtMs;
  const minutes = Math.floor(lateMs / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function resolveReminderIntent(input: ReminderIntentInput): NotificationIntent | null {
  const { thread, settings } = input;
  if (!settings.enabled || !settings.reminders) return null;
  if (resolveThreadReminder(thread, input.nowMs) !== "due") return null;

  const remindAt = thread.remindAt;
  if (!remindAt) return null;

  const threadKey = threadKeyOf(thread);
  const key = reminderIntentKey(threadKey, remindAt);
  if (input.alreadyFired(key)) return null;

  // Suppressed rather than consumed: the caller only records the key when an
  // intent comes back, so navigating away still delivers it.
  if (input.appFocused && input.activeThreadKey === threadKey) return null;

  const late = overdueLabel(Date.parse(remindAt), input.nowMs);
  return {
    key,
    title: `Reminder · ${thread.projectTitle}`,
    body: late ? `${thread.threadTitle} — ${late}` : thread.threadTitle,
    environmentId: thread.environmentId,
    threadId: thread.threadId,
    silent: !settings.sound,
  };
}

const LEDGER_STORAGE_KEY = "t3code:reminder-fired:v1";
/** Bounded so a long-lived profile cannot grow the ledger without limit. */
const MAX_REMEMBERED = 200;

export interface ReminderLedger {
  readonly has: (key: string) => boolean;
  readonly record: (key: string) => void;
}

export function createReminderLedger(storage: Storage | null): ReminderLedger {
  let keys: string[] = [];
  try {
    const raw = storage?.getItem(LEDGER_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) keys = parsed.filter((k): k is string => typeof k === "string");
  } catch {
    keys = [];
  }
  const seen = new Set(keys);

  const persist = () => {
    try {
      storage?.setItem(LEDGER_STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // A full or unavailable storage must not break notifications; the ledger
      // degrades to in-memory for this session.
    }
  };

  return {
    has: (key) => seen.has(key),
    record: (key) => {
      if (seen.has(key)) return;
      seen.add(key);
      keys.push(key);
      if (keys.length > MAX_REMEMBERED) {
        const dropped = keys.splice(0, keys.length - MAX_REMEMBERED);
        for (const stale of dropped) seen.delete(stale);
      }
      persist();
    },
  };
}
