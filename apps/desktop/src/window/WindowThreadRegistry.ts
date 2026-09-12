export type WindowId = string;

export interface WindowRegistrySnapshot {
  ownerByThreadKey: Record<string, WindowId>;
  windowThreadKeys: Record<WindowId, ReadonlyArray<string>>;
}

export class WindowThreadRegistry {
  private readonly threadKeysByWindow = new Map<WindowId, Set<string>>();
  private readonly windowByThreadKey = new Map<string, WindowId>();
  private readonly listeners = new Set<(snapshot: WindowRegistrySnapshot) => void>();

  createWindow(windowId: WindowId, initialThreadKeys: ReadonlyArray<string> = []): void {
    if (this.threadKeysByWindow.has(windowId)) {
      this.releaseWindow(windowId);
    }
    this.threadKeysByWindow.set(windowId, new Set());
    for (const threadKey of initialThreadKeys) {
      this.assignThreadWithoutNotify(threadKey, windowId);
    }
    this.notify();
  }

  assignThread(threadKey: string, windowId: WindowId): void {
    this.assignThreadWithoutNotify(threadKey, windowId);
    this.notify();
  }

  releaseWindow(windowId: WindowId): void {
    const threadKeys = this.threadKeysByWindow.get(windowId);
    if (!threadKeys) return;
    for (const threadKey of threadKeys) {
      this.windowByThreadKey.delete(threadKey);
    }
    this.threadKeysByWindow.delete(windowId);
    this.notify();
  }

  ownerOf(threadKey: string): WindowId | undefined {
    return this.windowByThreadKey.get(threadKey);
  }

  snapshot(): WindowRegistrySnapshot {
    const windowThreadKeys: Record<WindowId, ReadonlyArray<string>> = {};
    for (const [windowId, threadKeys] of this.threadKeysByWindow) {
      windowThreadKeys[windowId] = [...threadKeys];
    }
    return {
      ownerByThreadKey: Object.fromEntries(this.windowByThreadKey),
      windowThreadKeys,
    };
  }

  subscribe(listener: (snapshot: WindowRegistrySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private assignThreadWithoutNotify(threadKey: string, windowId: WindowId): void {
    if (!this.threadKeysByWindow.has(windowId)) {
      throw new Error(`Window ${windowId} does not exist`);
    }
    const previousOwner = this.windowByThreadKey.get(threadKey);
    if (previousOwner !== undefined) {
      this.threadKeysByWindow.get(previousOwner)?.delete(threadKey);
    }
    this.threadKeysByWindow.get(windowId)?.add(threadKey);
    this.windowByThreadKey.set(threadKey, windowId);
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
