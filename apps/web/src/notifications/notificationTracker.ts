/**
 * Per-client memory for the notification bridge: which phase each thread was
 * last seen in, and which intents have already fired.
 *
 * Kept separate from the rules so the rules stay a pure function of their
 * inputs, and separate from the React bridge so replay and dedupe behaviour
 * can be tested without rendering anything.
 */
import type { AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

import {
  resolveNotificationIntent,
  type NotificationIntent,
  type NotificationRuleInput,
} from "./notificationRules";

export type NotificationObservation = Omit<NotificationRuleInput, "previousPhase">;

/**
 * Fired keys are capped so a long session cannot grow the set without bound.
 * Oldest entries drop first; re-firing a very old intent is harmless because
 * its turn has long since been superseded.
 */
const MAX_REMEMBERED_INTENTS = 500;

export interface NotificationTracker {
  readonly consider: (observation: NotificationObservation) => NotificationIntent | null;
}

export function createNotificationTracker(): NotificationTracker {
  const lastPhaseByThread = new Map<string, AgentAwarenessPhase>();
  const firedIntentKeys = new Set<string>();

  return {
    consider: (observation) => {
      const { awareness } = observation;
      const threadKey = `${awareness.environmentId}:${awareness.threadId}`;
      const previousPhase = lastPhaseByThread.get(threadKey) ?? null;
      lastPhaseByThread.set(threadKey, awareness.phase);

      const intent = resolveNotificationIntent({ ...observation, previousPhase });
      if (intent === null) return null;
      if (firedIntentKeys.has(intent.key)) return null;

      firedIntentKeys.add(intent.key);
      if (firedIntentKeys.size > MAX_REMEMBERED_INTENTS) {
        const oldest = firedIntentKeys.values().next();
        if (!oldest.done) firedIntentKeys.delete(oldest.value);
      }

      return intent;
    },
  };
}
