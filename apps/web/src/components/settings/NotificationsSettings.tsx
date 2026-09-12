import { useCallback, useState } from "react";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@t3tools/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import {
  dispatchNotification,
  isWebNotificationSupported,
  requestWebNotificationPermission,
  resolveNotificationPlatform,
  webNotificationPermission,
} from "../../notifications/notificationPlatform";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const EVENT_ROWS: ReadonlyArray<{
  readonly key: keyof Pick<
    NotificationSettings,
    "turnComplete" | "approvalRequired" | "inputRequested" | "turnFailed" | "reminders"
  >;
  readonly title: string;
  readonly description: string;
}> = [
  {
    key: "turnComplete",
    title: "Finished a turn",
    description: "The agent stopped working and is waiting on you.",
  },
  {
    key: "approvalRequired",
    title: "Needs approval",
    description: "A tool call is blocked until you allow or deny it.",
  },
  {
    key: "inputRequested",
    title: "Asked a question",
    description: "The agent is waiting on an answer before it can continue.",
  },
  {
    key: "turnFailed",
    title: "Failed",
    description: "A turn ended in an error.",
  },
  {
    key: "reminders",
    title: "Reminder came due",
    description: "A reminder you set on a thread has come due.",
  },
];

export function NotificationsSettingsPanel() {
  const notifications = useClientSettings((s) => s.notifications);
  const updateClientSettings = useUpdateClientSettings();
  const [permission, setPermission] = useState(() => webNotificationPermission());

  const platform = resolveNotificationPlatform({
    desktopBridge: window.desktopBridge ?? null,
    webNotificationSupported: isWebNotificationSupported(),
  });

  const patch = useCallback(
    (next: Partial<NotificationSettings>) => {
      updateClientSettings({ notifications: { ...notifications, ...next } });
    },
    [notifications, updateClientSettings],
  );

  const handleEnable = useCallback(
    async (checked: boolean) => {
      // Ask the browser only when switching on, and only where it applies:
      // a permission prompt on the way *out* of the feature is nonsense.
      if (checked && platform === "web") {
        const result = await requestWebNotificationPermission();
        setPermission(result);
        if (result !== "granted") {
          patch({ enabled: false });
          return;
        }
      }
      patch({ enabled: checked });
    },
    [patch, platform],
  );

  const sendTest = useCallback(() => {
    void dispatchNotification({
      intent: {
        key: `test:${Date.now()}`,
        title: "T3 Code",
        body: "Notifications are working.",
        environmentId: "",
        threadId: "",
        silent: !notifications.sound,
      },
      desktopBridge: window.desktopBridge ?? null,
      onActivate: () => {},
    });
  }, [notifications.sound]);

  const isUnsupported = platform === "unsupported";
  const isBlocked = platform === "web" && permission === "denied";
  const controlsDisabled = !notifications.enabled || isUnsupported || isBlocked;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Notifications">
        <SettingsRow
          {...searchableSetting("notifications-enabled")}
          description={
            isUnsupported
              ? "This client cannot show system notifications."
              : isBlocked
                ? "Your browser has blocked notifications for this site. Allow them in your browser's site settings, then switch this back on — T3 Code cannot re-prompt once they are denied."
                : "Notify me when a thread needs attention. Nothing fires while you are looking at that thread in a focused window."
          }
          resetAction={
            notifications.enabled !== DEFAULT_NOTIFICATION_SETTINGS.enabled ? (
              <SettingResetButton
                label="notifications"
                onClick={() => patch({ enabled: DEFAULT_NOTIFICATION_SETTINGS.enabled })}
              />
            ) : null
          }
          control={
            <Switch
              checked={notifications.enabled && !isBlocked}
              disabled={isUnsupported || isBlocked}
              onCheckedChange={(checked) => {
                void handleEnable(checked);
              }}
              aria-label="System notifications"
            />
          }
        />

        {EVENT_ROWS.map((row) => (
          <SettingsRow
            key={row.key}
            {...(row.key === "turnComplete" ? searchableSetting("notification-events") : {})}
            title={row.title}
            description={row.description}
            control={
              <Switch
                checked={notifications[row.key]}
                disabled={controlsDisabled}
                onCheckedChange={(checked) => patch({ [row.key]: checked })}
                aria-label={row.title}
              />
            }
          />
        ))}

        <SettingsRow
          {...searchableSetting("notification-sound")}
          description="Play the system notification sound."
          control={
            <Switch
              checked={notifications.sound}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => patch({ sound: checked })}
              aria-label="Notification sound"
            />
          }
        />

        <SettingsRow
          title="Test notification"
          description="Send one now. The only reliable way to catch an OS-level Do Not Disturb or a muted app."
          control={
            <Button variant="outline" size="sm" disabled={controlsDisabled} onClick={sendTest}>
              Send test
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
