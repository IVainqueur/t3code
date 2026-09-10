import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export interface ShowNotificationInput {
  readonly title: string;
  readonly body: string;
  readonly silent: boolean;
}

/**
 * Thin wrapper over Electron's Notification so IPC handlers stay testable
 * without an Electron runtime, matching ElectronShell.
 */
export class ElectronNotification extends Context.Service<
  ElectronNotification,
  {
    readonly isSupported: () => Effect.Effect<boolean>;
    /**
     * Resolves false when the OS cannot show notifications, so callers can
     * report that rather than pretending a notification was delivered.
     */
    readonly show: (input: ShowNotificationInput, onActivate: () => void) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/electron/ElectronNotification") {}

export const make = ElectronNotification.of({
  isSupported: () => Effect.sync(() => Electron.Notification.isSupported()),
  show: (input, onActivate) =>
    Effect.sync(() => {
      if (!Electron.Notification.isSupported()) {
        return false;
      }
      const notification = new Electron.Notification({
        title: input.title,
        body: input.body,
        silent: input.silent,
      });
      notification.on("click", onActivate);
      notification.show();
      return true;
    }),
});

export const layer = Layer.succeed(ElectronNotification, make);
