/**
 * Watches thread awareness and turns transitions into OS notifications.
 *
 * Intentionally thin: every decision lives in notificationRules (pure) and
 * notificationTracker (replay/dedupe), both unit-tested. This component only
 * supplies inputs and performs the side effect.
 */
import { projectThreadAwareness } from "@t3tools/shared/agentAwareness";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";

import { nextPendingReminderAtMs } from "@t3tools/client-runtime/state/thread-reminder";

import { useClientSettings } from "../hooks/useSettings";
import { useProjects, useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { dispatchNotification } from "./notificationPlatform";
import { createNotificationTracker } from "./notificationTracker";
import { createReminderLedger, resolveReminderIntent } from "./reminderNotifier";

/**
 * Focus has to be state, not a ref: the firing rule reads it, so a ref would
 * let the bridge decide against whatever focus happened to be at the last
 * unrelated render. Focus changes are rare, so the extra render is cheap.
 */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(
    () => typeof document === "undefined" || document.hasFocus(),
  );
  useEffect(() => {
    const update = () => {
      setFocused(document.hasFocus() && document.visibilityState === "visible");
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return focused;
}

export function NotificationBridge() {
  const notifications = useClientSettings((s) => s.notifications);
  const threads = useThreadShells();
  const projects = useProjects();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as {
    environmentId?: string;
    threadId?: string;
  };
  const trackerRef = useRef(createNotificationTracker());
  const focused = useWindowFocused();

  const activeThreadKey =
    params.environmentId && params.threadId ? `${params.environmentId}:${params.threadId}` : null;

  const goToThread = useCallback(
    (target: { environmentId: string; threadId: string }) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.threadId },
      });
    },
    [navigate],
  );

  // Desktop click handling: the main process reveals the window, the renderer
  // routes. Registered once, independent of the settings toggle, so a click on
  // an already-visible notification still navigates.
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (typeof bridge?.onNotificationActivated !== "function") return;
    return bridge.onNotificationActivated((target) => {
      goToThread(target);
    });
  }, [goToThread]);

  useEffect(() => {
    // The tracker still needs to observe phases while notifications are off,
    // otherwise switching them on mid-session would treat every settled thread
    // as brand new and fire a burst.
    const tracker = trackerRef.current;
    const projectTitleById = new Map(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
    );

    for (const thread of threads) {
      const awareness = projectThreadAwareness({
        environmentId: thread.environmentId,
        project: {
          title: projectTitleById.get(`${thread.environmentId}:${thread.projectId}`) ?? "",
        },
        thread,
      });
      if (awareness === null) continue;

      const intent = tracker.consider({
        awareness: {
          environmentId: String(thread.environmentId),
          threadId: String(thread.id),
          projectTitle: awareness.projectTitle,
          threadTitle: awareness.threadTitle,
          phase: awareness.phase,
          headline: awareness.headline,
          detail: awareness.detail,
        },
        turnKey: thread.latestTurn?.turnId ? String(thread.latestTurn.turnId) : null,
        settings: notifications,
        appFocused: focused,
        activeThreadKey,
      });

      if (intent === null) continue;

      void dispatchNotification({
        intent,
        desktopBridge: window.desktopBridge ?? null,
        onActivate: (target) => goToThread(target),
      });
    }
  }, [threads, projects, notifications, focused, activeThreadKey, goToThread]);

  // Reminders ride along here for the focus, route and navigation this
  // component already owns, but they go through resolveReminderIntent rather
  // than the tracker above: the tracker suppresses a first observation to
  // stop reconnect storms, and a reminder that came due while the app was
  // shut IS a first observation. Firing it then is the whole feature.
  const threadRemindAtById = useUiStateStore((s) => s.threadRemindAtById);
  const [reminderLedger] = useState(() =>
    createReminderLedger(typeof window === "undefined" ? null : window.localStorage),
  );
  const [reminderTick, bumpReminderTick] = useState(0);
  useEffect(() => {
    // A reminder coming due is not accompanied by any other state change, so
    // the boundary timer armed below is what re-runs this.
    void reminderTick;
    const entries = Object.entries(threadRemindAtById);
    if (entries.length === 0) return;
    const nowMs = new Date().getTime();
    const projectTitleById = new Map(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
    );
    const threadByKey = new Map(
      threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread]),
    );
    for (const [threadKey, remindAt] of entries) {
      const thread = threadByKey.get(threadKey);
      if (!thread) continue;
      const intent = resolveReminderIntent({
        thread: {
          environmentId: String(thread.environmentId),
          threadId: String(thread.id),
          threadTitle: thread.title,
          projectTitle: projectTitleById.get(`${thread.environmentId}:${thread.projectId}`) ?? "",
          // No lastVisitedAt: opening a thread clears the stored reminder
          // outright, so its absence already carries the dismissal — and
          // subscribing to the visit record here would re-run this effect on
          // every completion.
          remindAt,
        },
        nowMs,
        settings: notifications,
        appFocused: focused,
        activeThreadKey,
        alreadyFired: reminderLedger.has,
      });
      if (intent === null) continue;
      // Recorded only when an intent came back, so a fire suppressed because
      // you are looking at that thread arrives when you navigate away.
      reminderLedger.record(intent.key);
      void dispatchNotification({
        intent,
        desktopBridge: window.desktopBridge ?? null,
        onActivate: (target) => goToThread(target),
      });
    }
    const nextAtMs = nextPendingReminderAtMs(
      entries.map(([, remindAt]) => ({ remindAt })),
      nowMs,
    );
    if (nextAtMs === null) return;
    // Same clamp as the sidebar's wake timer: setTimeout delays are signed
    // 32-bit, so a far-future reminder would otherwise fire immediately and
    // spin. Clamped, it just re-arms until the due time is in range.
    const id = window.setTimeout(
      () => bumpReminderTick((tick) => tick + 1),
      Math.min(Math.max(0, nextAtMs - nowMs) + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(id);
  }, [
    activeThreadKey,
    focused,
    goToThread,
    notifications,
    projects,
    reminderLedger,
    reminderTick,
    threadRemindAtById,
    threads,
  ]);

  return null;
}
