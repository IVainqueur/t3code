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

import { useClientSettings } from "../hooks/useSettings";
import { useProjects, useThreadShells } from "../state/entities";
import { dispatchNotification } from "./notificationPlatform";
import { createNotificationTracker } from "./notificationTracker";

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

  return null;
}
