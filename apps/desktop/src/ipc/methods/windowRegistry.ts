import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const WindowRegistrySnapshotSchema = Schema.Struct({
  ownerByThreadKey: Schema.Record(Schema.String, Schema.String),
  windowThreadKeys: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

const AddThreadToWindowInput = Schema.Struct({
  threadKey: Schema.String,
  windowId: Schema.String,
});

const ThreadDroppedOutsideWindowInput = Schema.Struct({
  threadKey: Schema.String,
  screenPoint: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
});

interface ScreenRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Half-open on the right and bottom edges, so two windows sharing an edge
// cannot both claim the same point.
function boundsContain(bounds: ScreenRectangle, point: { x: number; y: number }): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

/**
 * Forwards every `windowThreadRegistry` change to all renderer windows, so
 * each window (main and secondary) can render "owned elsewhere" indicators
 * from the full ownership map. Subscribes once at IPC-install time and lives
 * for the app's lifetime — unsubscribed only when the installing scope closes.
 */
export const installWindowRegistryEventForwarding = Effect.fn(
  "desktop.ipc.windowRegistry.installEventForwarding",
)(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
  const runFork = Effect.runForkWith(context);

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      desktopWindow.windowThreadRegistry.subscribe((snapshot) => {
        runFork(electronWindow.sendAll(IpcChannels.WINDOW_REGISTRY_CHANGED_CHANNEL, snapshot));
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
});

export const getMyWindowState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_WINDOW_REGISTRY_STATE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Struct({
    windowId: Schema.String,
    threadKeys: Schema.Array(Schema.String),
  }),
  handler: Effect.fn("desktop.ipc.windowRegistry.getMyWindowState")(function* (_input, event) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const windowId =
      event === undefined ? undefined : desktopWindow.windowIdForWebContents(event.sender.id);
    if (windowId === undefined) {
      return { windowId: DesktopWindow.MAIN_WINDOW_ID, threadKeys: [] };
    }
    const snapshot = desktopWindow.windowThreadRegistry.snapshot();
    return { windowId, threadKeys: snapshot.windowThreadKeys[windowId] ?? [] };
  }),
});

export const getSnapshot = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_WINDOW_REGISTRY_SNAPSHOT_CHANNEL,
  payload: Schema.Void,
  result: WindowRegistrySnapshotSchema,
  handler: Effect.fn("desktop.ipc.windowRegistry.getSnapshot")(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    return desktopWindow.windowThreadRegistry.snapshot();
  }),
});

export const openThreadInNewWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_THREAD_IN_NEW_WINDOW_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.windowRegistry.openThreadInNewWindow")(function* (threadKey) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.createSecondaryWindow([threadKey]);
  }),
});

export const addThreadToWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ADD_THREAD_TO_WINDOW_CHANNEL,
  payload: AddThreadToWindowInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.windowRegistry.addThreadToWindow")(function* ({
    threadKey,
    windowId,
  }) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    desktopWindow.windowThreadRegistry.assignThread(threadKey, windowId);
  }),
});

/**
 * Completes a native cross-window thread drag that no drop target accepted.
 * The renderer reports where the pointer was released in screen space; only
 * the main process knows the window layout, so the "was that empty desktop?"
 * question is answered here. Over a window, the thread moves to it; over
 * nothing, it detaches into a brand-new window at that spot.
 */
export const handleThreadDroppedOutsideWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.THREAD_DROPPED_OUTSIDE_WINDOW_CHANNEL,
  payload: ThreadDroppedOutsideWindowInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.windowRegistry.handleThreadDroppedOutsideWindow")(function* ({
    threadKey,
    screenPoint,
  }) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const windows = desktopWindow.listWindowBounds();
    // Newest window wins an overlap: Electron exposes no z-order, and a
    // secondary window opened over main is the one the user can see at that
    // point. `listWindowBounds` is in creation order, so search it backwards.
    let target: (typeof windows)[number] | undefined;
    for (let index = windows.length - 1; index >= 0; index -= 1) {
      const candidate = windows[index];
      if (candidate !== undefined && boundsContain(candidate.bounds, screenPoint)) {
        target = candidate;
        break;
      }
    }
    if (target === undefined) {
      yield* desktopWindow.createSecondaryWindow([threadKey]);
      return;
    }
    desktopWindow.windowThreadRegistry.assignThread(threadKey, target.windowId);
  }),
});

/**
 * Focuses a window the renderer can already name, without going through a
 * thread first — the "back to the main window" affordance a secondary window
 * shows has no thread to resolve through.
 */
export const focusWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FOCUS_WINDOW_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.windowRegistry.focusWindow")(function* (windowId) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.focusWindow(windowId);
  }),
});

export const focusWindowForThread = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FOCUS_WINDOW_FOR_THREAD_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.windowRegistry.focusWindowForThread")(function* (threadKey) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const ownerId = desktopWindow.windowThreadRegistry.ownerOf(threadKey);
    if (ownerId === undefined) return;
    yield* desktopWindow.focusWindow(ownerId);
  }),
});
