import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ElectronNotification from "../../electron/ElectronNotification.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

const ShowNotificationInput = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  silent: Schema.Boolean,
  /** Echoed back on click so the renderer can route to the thread. */
  environmentId: Schema.String,
  threadId: Schema.String,
});

export const showNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SHOW_NOTIFICATION_CHANNEL,
  payload: ShowNotificationInput,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.notifications.showNotification")(function* (input) {
    const notifications = yield* ElectronNotification.ElectronNotification;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;

    return yield* notifications.show(
      { title: input.title, body: input.body, silent: input.silent },
      () => {
        // Fire-and-forget: the click arrives long after the IPC call resolved,
        // and a failure to reveal must not surface as an unhandled rejection.
        Effect.runFork(
          Effect.gen(function* () {
            if (Option.isSome(window)) {
              yield* electronWindow.reveal(window.value);
            }
            yield* electronWindow.sendAll(IpcChannels.NOTIFICATION_ACTIVATED_CHANNEL, {
              environmentId: input.environmentId,
              threadId: input.threadId,
            });
          }),
        );
      },
    );
  }),
});
