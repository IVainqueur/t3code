/// <reference types="vitest" />
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useWindowRegistry,
  openThreadInNewWindow,
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
    expect(result.current.otherWindowIds).toEqual(["main"]);
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
