/**
 * Where a notification is actually delivered.
 *
 * Desktop wins when available because Electron notifications survive the
 * renderer losing focus and can reveal the window on click. A browser tab
 * falls back to the Web Notification API. Anything else is a no-op: dispatch
 * must never throw, because an unsupported host is a normal state, not a bug.
 */
import type { NotificationIntent } from "./notificationRules";

export type NotificationPlatform = "desktop" | "web" | "unsupported";

export interface DesktopNotificationBridge {
  readonly showNotification?: (input: {
    title: string;
    body: string;
    silent: boolean;
    environmentId: string;
    threadId: string;
  }) => Promise<boolean>;
}

export function resolveNotificationPlatform(input: {
  readonly desktopBridge: DesktopNotificationBridge | null;
  readonly webNotificationSupported: boolean;
}): NotificationPlatform {
  // Feature-detect rather than trust the bridge's presence: older desktop
  // builds expose a bridge without this method.
  if (typeof input.desktopBridge?.showNotification === "function") return "desktop";
  if (input.webNotificationSupported) return "web";
  return "unsupported";
}

export function isWebNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function webNotificationPermission(): NotificationPermission | "unsupported" {
  return isWebNotificationSupported() ? Notification.permission : "unsupported";
}

export async function requestWebNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!isWebNotificationSupported()) return "unsupported";
  return Notification.requestPermission();
}

export async function dispatchNotification(input: {
  readonly intent: NotificationIntent;
  readonly desktopBridge: DesktopNotificationBridge | null;
  readonly onActivate: (target: { environmentId: string; threadId: string }) => void;
}): Promise<boolean> {
  const { intent, desktopBridge } = input;
  const platform = resolveNotificationPlatform({
    desktopBridge,
    webNotificationSupported: isWebNotificationSupported(),
  });

  if (platform === "desktop") {
    try {
      return await desktopBridge!.showNotification!({
        title: intent.title,
        body: intent.body,
        silent: intent.silent,
        environmentId: intent.environmentId,
        threadId: intent.threadId,
      });
    } catch {
      return false;
    }
  }

  if (platform === "web") {
    if (Notification.permission !== "granted") return false;
    try {
      const notification = new Notification(intent.title, {
        body: intent.body,
        silent: intent.silent,
        tag: intent.key,
      });
      notification.addEventListener("click", () => {
        window.focus();
        input.onActivate({ environmentId: intent.environmentId, threadId: intent.threadId });
        notification.close();
      });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
