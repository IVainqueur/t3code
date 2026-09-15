import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { WindowThreadRegistry } from "./WindowThreadRegistry.js";

describe("WindowThreadRegistry", () => {
  it("assigns a thread to a window and reports it in the snapshot", () => {
    const registry = new WindowThreadRegistry();
    registry.createWindow("win-1");
    registry.assignThread("env-1:thread-1", "win-1");

    expect(registry.ownerOf("env-1:thread-1")).toBe("win-1");
    expect(registry.snapshot().windowThreadKeys["win-1"]).toEqual(["env-1:thread-1"]);
    expect(registry.snapshot().ownerByThreadKey["env-1:thread-1"]).toBe("win-1");
  });

  it("reassigns a thread from one window to another, enforcing single ownership", () => {
    const registry = new WindowThreadRegistry();
    registry.createWindow("win-1");
    registry.createWindow("win-2");
    registry.assignThread("env-1:thread-1", "win-1");

    registry.assignThread("env-1:thread-1", "win-2");

    expect(registry.ownerOf("env-1:thread-1")).toBe("win-2");
    expect(registry.snapshot().windowThreadKeys["win-1"]).toEqual([]);
    expect(registry.snapshot().windowThreadKeys["win-2"]).toEqual(["env-1:thread-1"]);
  });

  it("releasing a window drops it and unowns its threads, but does not touch other windows", () => {
    const registry = new WindowThreadRegistry();
    registry.createWindow("win-1");
    registry.createWindow("win-2");
    registry.assignThread("env-1:thread-1", "win-1");
    registry.assignThread("env-1:thread-2", "win-2");

    registry.releaseWindow("win-1");

    expect(registry.ownerOf("env-1:thread-1")).toBeUndefined();
    expect(registry.snapshot().windowThreadKeys["win-1"]).toBeUndefined();
    expect(registry.ownerOf("env-1:thread-2")).toBe("win-2");
  });

  it("creating a window with initial thread keys assigns them immediately", () => {
    const registry = new WindowThreadRegistry();
    registry.createWindow("win-1", ["env-1:thread-1", "env-1:thread-2"]);

    expect(registry.ownerOf("env-1:thread-1")).toBe("win-1");
    expect(registry.ownerOf("env-1:thread-2")).toBe("win-1");
  });

  it("notifies subscribers on every mutation with the latest snapshot, and stops after unsubscribe", () => {
    const registry = new WindowThreadRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.createWindow("win-1");
    registry.assignThread("env-1:thread-1", "win-1");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]![0].ownerByThreadKey["env-1:thread-1"]).toBe("win-1");

    unsubscribe();
    registry.releaseWindow("win-1");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("throws when assigning a thread to an unregistered window", () => {
    const registry = new WindowThreadRegistry();
    expect(() => {
      registry.assignThread("env-1:thread-1", "win-999");
    }).toThrow();
  });

  it("recreating an existing window cleans up old thread references", () => {
    const registry = new WindowThreadRegistry();
    registry.createWindow("win-1", ["env-1:thread-1", "env-1:thread-2"]);

    expect(registry.ownerOf("env-1:thread-1")).toBe("win-1");
    expect(registry.ownerOf("env-1:thread-2")).toBe("win-1");

    registry.createWindow("win-1");

    expect(registry.ownerOf("env-1:thread-1")).toBeUndefined();
    expect(registry.ownerOf("env-1:thread-2")).toBeUndefined();
    expect(registry.snapshot().windowThreadKeys["win-1"]).toEqual([]);
  });
});
