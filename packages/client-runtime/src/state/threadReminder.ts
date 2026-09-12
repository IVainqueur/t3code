/**
 * Thread reminders, resolved from two durable timestamps and the clock.
 *
 * There is no scheduler and no acknowledgement event, by design. Snooze
 * established that a timer wake needs neither — clients derive state by
 * comparing a persisted timestamp to now — and dismissal reuses the
 * `lastVisitedAt` comparison that unseen-completion already relies on. That is
 * what makes a reminder survive the app closing: the only state is the
 * timestamp the user set.
 */

export type ThreadReminderState = "pending" | "due" | null;

export interface ThreadReminderInput {
  readonly remindAt?: string | null | undefined;
  readonly lastVisitedAt?: string | null | undefined;
}

function parsed(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * `null` means there is nothing to show: no reminder, an unparseable one, or
 * one the user has already seen. An unparseable `remindAt` resolves to `null`
 * rather than due-at-epoch, which would otherwise pin a corrupt row to the top
 * of the list forever.
 */
export function resolveThreadReminder(
  thread: ThreadReminderInput,
  nowMs: number,
): ThreadReminderState {
  const remindAt = parsed(thread.remindAt);
  if (remindAt === null) return null;
  if (remindAt > nowMs) return "pending";

  // A visit at or after the due moment is the dismissal. An unparseable visit
  // counts as never visited, matching hasUnseenCompletion.
  const lastVisitedAt = parsed(thread.lastVisitedAt);
  if (lastVisitedAt !== null && lastVisitedAt >= remindAt) return null;

  return "due";
}

/**
 * Soonest pending reminder, for folding into the sidebar's existing wake tick
 * so an open app notices a reminder coming due without polling.
 */
export function nextPendingReminderAtMs(
  threads: ReadonlyArray<ThreadReminderInput>,
  nowMs: number,
): number | null {
  let soonest: number | null = null;
  for (const thread of threads) {
    const remindAt = parsed(thread.remindAt);
    if (remindAt === null || remindAt <= nowMs) continue;
    if (soonest === null || remindAt < soonest) soonest = remindAt;
  }
  return soonest;
}
