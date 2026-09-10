/**
 * The whole notification decision, as one pure function.
 *
 * Nothing here touches the DOM, Electron, or the thread store, so the firing
 * matrix is testable without a browser. The bridge that feeds it is
 * deliberately thin for the same reason.
 */
import type { AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@t3tools/contracts/settings";

export { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings };

/** The phases a user can act on. Everything else is progress, not news. */
const PHASE_TOGGLES = {
  completed: "turnComplete",
  waiting_for_approval: "approvalRequired",
  waiting_for_input: "inputRequested",
  failed: "turnFailed",
} as const satisfies Partial<Record<AgentAwarenessPhase, keyof NotificationSettings>>;

type NotifiablePhase = keyof typeof PHASE_TOGGLES;

const PHASE_TITLES: Record<NotifiablePhase, string> = {
  completed: "Finished",
  waiting_for_approval: "Needs approval",
  waiting_for_input: "Waiting on you",
  failed: "Failed",
};

export interface NotificationAwareness {
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly headline: string;
  readonly detail?: string | undefined;
}

export interface NotificationRuleInput {
  readonly awareness: NotificationAwareness;
  /** Identifies the turn, so a later turn in the same thread notifies again. */
  readonly turnKey: string | null;
  /**
   * The phase last observed for this thread, or null when this is the first
   * time we have seen it. First observations never notify: on reconnect the
   * client re-reads every thread, and a naive match would fire once per
   * already-finished thread.
   */
  readonly previousPhase: AgentAwarenessPhase | null;
  readonly settings: NotificationSettings;
  readonly appFocused: boolean;
  /** Scoped key of the thread currently on screen, `environmentId:threadId`. */
  readonly activeThreadKey: string | null;
}

export interface NotificationIntent {
  /** Dedupe key; identical keys must never fire twice. */
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly silent: boolean;
}

function isNotifiable(phase: AgentAwarenessPhase): phase is NotifiablePhase {
  return phase in PHASE_TOGGLES;
}

export function resolveNotificationIntent(input: NotificationRuleInput): NotificationIntent | null {
  const { awareness, settings, previousPhase } = input;

  if (!settings.enabled) return null;
  if (!isNotifiable(awareness.phase)) return null;
  if (!settings[PHASE_TOGGLES[awareness.phase]]) return null;

  // Replay guard, then transition guard.
  if (previousPhase === null) return null;
  if (previousPhase === awareness.phase) return null;

  // Must match scopedThreadKey's `environmentId:threadId` format.
  const threadKey = `${awareness.environmentId}:${awareness.threadId}`;
  if (input.appFocused && input.activeThreadKey === threadKey) return null;

  return {
    key: `${threadKey}:${input.turnKey ?? "no-turn"}:${awareness.phase}`,
    title: `${PHASE_TITLES[awareness.phase]} · ${awareness.projectTitle}`,
    body: awareness.detail
      ? `${awareness.threadTitle} — ${awareness.detail}`
      : awareness.threadTitle,
    environmentId: awareness.environmentId,
    threadId: awareness.threadId,
    silent: !settings.sound,
  };
}
