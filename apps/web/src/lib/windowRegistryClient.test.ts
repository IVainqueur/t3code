import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  useWindowRegistry,
  openThreadInNewWindow,
  handleThreadDroppedOutsideWindow,
  deriveOtherWindows,
  focusWindow,
  MAIN_WINDOW_ID,
  resolveInitialThreadRouteHash,
  __resetWindowRegistry,
} from "./windowRegistryClient";

// @vitest-environment jsdom

function installDesktopBridge() {
  let changeListener: ((snapshot: unknown) => void) | undefined;
  const bridge = {
    windowRegistry: {
      getMyWindowState: vi
        .fn()
        .mockResolvedValue({ windowId: "win-1", threadKeys: ["env-1:thread-1"] }),
      getSnapshot: vi.fn().mockResolvedValue({
        ownerByThreadKey: { "env-1:thread-1": "win-1" },
        windowThreadKeys: { "win-1": ["env-1:thread-1"], main: [] },
      }),
      openThreadInNewWindow: vi.fn().mockResolvedValue(undefined),
      addThreadToWindow: vi.fn().mockResolvedValue(undefined),
      focusWindowForThread: vi.fn().mockResolvedValue(undefined),
      focusWindow: vi.fn().mockResolvedValue(undefined),
      handleThreadDroppedOutsideWindow: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn((listener: (snapshot: unknown) => void) => {
        changeListener = listener;
        return () => {
          changeListener = undefined;
        };
      }),
    },
  };
  (window as unknown as { desktopBridge?: unknown }).desktopBridge = bridge;
  return { bridge, emitChange: (snapshot: unknown) => changeListener?.(snapshot) };
}

afterEach(() => {
  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
  __resetWindowRegistry();
});

describe("useWindowRegistry", () => {
  it("reports isDesktop: false with an empty state when window.desktopBridge is absent", () => {
    const { result } = renderHook(() => useWindowRegistry());
    expect(result.current.isDesktop).toBe(false);
    expect(result.current.myWindowId).toBeNull();
    expect(result.current.ownerByThreadKey.size).toBe(0);
  });

  it("loads my window state and the full ownership snapshot on mount", async () => {
    installDesktopBridge();
    const { result } = renderHook(() => useWindowRegistry());

    await waitFor(() => expect(result.current.myWindowId).toBe("win-1"));
    expect(result.current.myThreadKeys.has("env-1:thread-1")).toBe(true);
    expect(result.current.ownerByThreadKey.get("env-1:thread-1")).toBe("win-1");
    expect(result.current.otherWindows).toEqual([{ id: "main", label: "Main Window" }]);
  });

  it("updates reactively when the main process pushes a change", async () => {
    const { emitChange } = installDesktopBridge();
    const { result } = renderHook(() => useWindowRegistry());
    await waitFor(() => expect(result.current.myWindowId).toBe("win-1"));

    act(() => {
      emitChange({
        ownerByThreadKey: { "env-1:thread-1": "win-1", "env-1:thread-2": "main" },
        windowThreadKeys: { "win-1": ["env-1:thread-1"], main: [] },
      });
    });

    await waitFor(() => expect(result.current.ownerByThreadKey.get("env-1:thread-2")).toBe("main"));
  });
});

describe("openThreadInNewWindow", () => {
  it("delegates to desktopBridge.windowRegistry.openThreadInNewWindow", async () => {
    const { bridge } = installDesktopBridge();
    await openThreadInNewWindow("env-1:thread-1");
    expect(bridge.windowRegistry.openThreadInNewWindow).toHaveBeenCalledWith("env-1:thread-1");
  });
});

describe("focusWindow", () => {
  it("delegates to desktopBridge.windowRegistry.focusWindow", async () => {
    const { bridge } = installDesktopBridge();
    await focusWindow(MAIN_WINDOW_ID);
    expect(bridge.windowRegistry.focusWindow).toHaveBeenCalledWith("main");
  });

  it("resolves without throwing on web, where there is no desktop bridge", async () => {
    await expect(focusWindow(MAIN_WINDOW_ID)).resolves.toBeUndefined();
  });
});

describe("handleThreadDroppedOutsideWindow", () => {
  it("delegates to desktopBridge.windowRegistry.handleThreadDroppedOutsideWindow", async () => {
    const { bridge } = installDesktopBridge();
    await handleThreadDroppedOutsideWindow("env-1:thread-1", { x: 120, y: 340 });
    expect(bridge.windowRegistry.handleThreadDroppedOutsideWindow).toHaveBeenCalledWith(
      "env-1:thread-1",
      { x: 120, y: 340 },
    );
  });

  it("resolves without throwing on web, where there is no desktop bridge", async () => {
    await expect(
      handleThreadDroppedOutsideWindow("env-1:thread-1", { x: 0, y: 0 }),
    ).resolves.toBeUndefined();
  });
});

describe("resolveInitialThreadRouteHash", () => {
  it("routes a window opened around a thread straight to that thread", () => {
    expect(resolveInitialThreadRouteHash("?initialThreadKey=env-1%3Athread-1", "")).toBe(
      "#/env-1/thread-1",
    );
    expect(resolveInitialThreadRouteHash("?initialThreadKey=env-1%3Athread-1", "#/")).toBe(
      "#/env-1/thread-1",
    );
  });

  it("leaves the boot route alone without a usable thread key", () => {
    expect(resolveInitialThreadRouteHash("", "")).toBeNull();
    expect(resolveInitialThreadRouteHash("?initialThreadKey=", "")).toBeNull();
    expect(resolveInitialThreadRouteHash("?initialThreadKey=nonsense", "")).toBeNull();
  });

  it("never overrides a route the window is already on", () => {
    expect(
      resolveInitialThreadRouteHash("?initialThreadKey=env-1%3Athread-1", "#/settings/general"),
    ).toBeNull();
  });
});

describe("deriveOtherWindows", () => {
  // Numbering is a property of the window, not of who is looking at it: the
  // same OS window must read the same in every window's menu.
  it("names main and numbers secondary windows by registry creation order", () => {
    const windowIds = ["main", "win-a", "win-b", "win-c"];

    expect(deriveOtherWindows(windowIds, "main")).toEqual([
      { id: "win-a", label: "Window 1" },
      { id: "win-b", label: "Window 2" },
      { id: "win-c", label: "Window 3" },
    ]);
    expect(deriveOtherWindows(windowIds, "win-b")).toEqual([
      { id: "main", label: "Main Window" },
      { id: "win-a", label: "Window 1" },
      { id: "win-c", label: "Window 3" },
    ]);
  });

  it("lists every known window when the viewer is not in the registry", () => {
    expect(deriveOtherWindows(["main", "win-a"], null)).toEqual([
      { id: "main", label: "Main Window" },
      { id: "win-a", label: "Window 1" },
    ]);
  });
});
