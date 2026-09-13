import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { WindowThreadRegistry } from "../../window/WindowThreadRegistry.ts";
import {
  addThreadToWindow,
  focusWindowForThread,
  getMyWindowState,
  getSnapshot,
  openThreadInNewWindow,
} from "./windowRegistry.ts";

describe("getMyWindowState", () => {
  it.effect("returns the calling window's id and owned threads", () => {
    const windowThreadRegistry = new WindowThreadRegistry();
    windowThreadRegistry.createWindow("secondary-1", ["env-1:thread-1"]);

    return Effect.gen(function* () {
      const result = yield* getMyWindowState.handler(undefined, { sender: { id: 42 } });
      assert.deepEqual(result, { windowId: "secondary-1", threadKeys: ["env-1:thread-1"] });
    }).pipe(
      Effect.provide(
        Layer.mock(DesktopWindow.DesktopWindow)({
          windowThreadRegistry,
          windowIdForWebContents: (webContentsId) =>
            webContentsId === 42 ? "secondary-1" : undefined,
        }),
      ),
    );
  });

  it.effect("falls back to the main window with no threads when the caller is unregistered", () => {
    const windowThreadRegistry = new WindowThreadRegistry();

    return Effect.gen(function* () {
      const result = yield* getMyWindowState.handler(undefined, { sender: { id: 7 } });
      assert.deepEqual(result, { windowId: DesktopWindow.MAIN_WINDOW_ID, threadKeys: [] });
    }).pipe(
      Effect.provide(
        Layer.mock(DesktopWindow.DesktopWindow)({
          windowThreadRegistry,
          windowIdForWebContents: () => undefined,
        }),
      ),
    );
  });
});

describe("getSnapshot", () => {
  it.effect("returns the registry's current snapshot", () => {
    const windowThreadRegistry = new WindowThreadRegistry();
    windowThreadRegistry.createWindow(DesktopWindow.MAIN_WINDOW_ID);
    windowThreadRegistry.createWindow("secondary-1", ["env-1:thread-1"]);

    return Effect.gen(function* () {
      const result = yield* getSnapshot.handler(undefined);
      assert.deepEqual(result, windowThreadRegistry.snapshot());
    }).pipe(
      Effect.provide(
        Layer.mock(DesktopWindow.DesktopWindow)({
          windowThreadRegistry,
          windowIdForWebContents: () => undefined,
        }),
      ),
    );
  });
});

describe("openThreadInNewWindow", () => {
  it.effect("opens the thread in a brand-new secondary window", () => {
    const createSecondaryWindow = vi.fn(() => Effect.succeed("secondary-1"));

    return Effect.gen(function* () {
      yield* openThreadInNewWindow.handler("env-1:thread-1");
      assert.deepEqual(createSecondaryWindow.mock.calls, [[["env-1:thread-1"]]]);
    }).pipe(
      Effect.provide(
        Layer.mock(DesktopWindow.DesktopWindow)({
          createSecondaryWindow,
          windowThreadRegistry: new WindowThreadRegistry(),
          windowIdForWebContents: () => undefined,
        }),
      ),
    );
  });
});

describe("addThreadToWindow", () => {
  it.effect("assigns the thread to the given window in the registry", () => {
    const windowThreadRegistry = new WindowThreadRegistry();
    windowThreadRegistry.createWindow("secondary-1");

    return Effect.gen(function* () {
      yield* addThreadToWindow.handler({ threadKey: "env-1:thread-1", windowId: "secondary-1" });
      assert.equal(windowThreadRegistry.ownerOf("env-1:thread-1"), "secondary-1");
    }).pipe(
      Effect.provide(
        Layer.mock(DesktopWindow.DesktopWindow)({
          windowThreadRegistry,
          windowIdForWebContents: () => undefined,
        }),
      ),
    );
  });
});

describe("focusWindowForThread", () => {
  it.effect("focuses the window owning the thread", () => {
    const windowThreadRegistry = new WindowThreadRegistry();
    windowThreadRegistry.createWindow("secondary-1", ["env-1:thread-1"]);
    const focusWindow = vi.fn(() => Effect.void);

    return Effect.gen(function* () {
      yield* focusWindowForThread.handler("env-1:thread-1");
      assert.deepEqual(focusWindow.mock.calls, [["secondary-1"]]);
    }).pipe(
      Effect.provide(
        Layer.mock(DesktopWindow.DesktopWindow)({
          windowThreadRegistry,
          focusWindow,
          windowIdForWebContents: () => undefined,
        }),
      ),
    );
  });

  it.effect("is a no-op when the thread has no owner", () => {
    const windowThreadRegistry = new WindowThreadRegistry();
    const focusWindow = vi.fn(() => Effect.void);

    return Effect.gen(function* () {
      yield* focusWindowForThread.handler("env-1:thread-1");
      assert.deepEqual(focusWindow.mock.calls, []);
    }).pipe(
      Effect.provide(
        Layer.mock(DesktopWindow.DesktopWindow)({
          windowThreadRegistry,
          focusWindow,
          windowIdForWebContents: () => undefined,
        }),
      ),
    );
  });
});
