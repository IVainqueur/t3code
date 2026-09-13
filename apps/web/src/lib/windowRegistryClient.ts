import { useSyncExternalStore } from "react";

export interface WindowRegistryState {
  isDesktop: boolean;
  myWindowId: string | null;
  myThreadKeys: ReadonlySet<string>;
  ownerByThreadKey: ReadonlyMap<string, string>;
  otherWindowIds: ReadonlyArray<string>;
}

interface RawSnapshot {
  ownerByThreadKey: Record<string, string>;
  windowThreadKeys: Record<string, ReadonlyArray<string>>;
}

const EMPTY_STATE: WindowRegistryState = {
  isDesktop: false,
  myWindowId: null,
  myThreadKeys: new Set(),
  ownerByThreadKey: new Map(),
  otherWindowIds: [],
};

function getBridge() {
  return (window as unknown as { desktopBridge?: { windowRegistry?: DesktopWindowRegistryBridge } })
    .desktopBridge?.windowRegistry;
}

interface DesktopWindowRegistryBridge {
  getMyWindowState(): Promise<{ windowId: string; threadKeys: ReadonlyArray<string> }>;
  getSnapshot(): Promise<RawSnapshot>;
  openThreadInNewWindow(threadKey: string): Promise<void>;
  addThreadToWindow(threadKey: string, windowId: string): Promise<void>;
  focusWindowForThread(threadKey: string): Promise<void>;
  handleThreadDroppedOutsideWindow(
    threadKey: string,
    screenPoint: { x: number; y: number },
  ): Promise<void>;
  onChanged(listener: (snapshot: RawSnapshot) => void): () => void;
}

let cachedState: WindowRegistryState = EMPTY_STATE;
const storeListeners = new Set<() => void>();
let unsubscribeFromChanges: (() => void) | null = null;

function toState(myWindowId: string | null, snapshot: RawSnapshot): WindowRegistryState {
  return {
    isDesktop: true,
    myWindowId,
    myThreadKeys: new Set(myWindowId ? (snapshot.windowThreadKeys[myWindowId] ?? []) : []),
    ownerByThreadKey: new Map(Object.entries(snapshot.ownerByThreadKey)),
    otherWindowIds: Object.keys(snapshot.windowThreadKeys).filter((id) => id !== myWindowId),
  };
}

function setState(next: WindowRegistryState): void {
  cachedState = next;
  for (const listener of storeListeners) listener();
}

let initialized = false;
function resetState(): void {
  if (unsubscribeFromChanges) {
    unsubscribeFromChanges();
    unsubscribeFromChanges = null;
  }
  initialized = false;
  cachedState = EMPTY_STATE;
  storeListeners.clear();
}

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  const bridge = getBridge();
  if (!bridge) return;

  void (async () => {
    const [{ windowId }, snapshot] = await Promise.all([
      bridge.getMyWindowState(),
      bridge.getSnapshot(),
    ]);
    setState(toState(windowId, snapshot));
  })();

  unsubscribeFromChanges = bridge.onChanged((snapshot) => {
    setState(toState(cachedState.myWindowId, snapshot));
  });
}

// Export for testing
export function __resetWindowRegistry(): void {
  resetState();
}

export function useWindowRegistry(): WindowRegistryState {
  ensureInitialized();
  return useSyncExternalStore(
    (listener) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
    () => cachedState,
  );
}

export async function openThreadInNewWindow(threadKey: string): Promise<void> {
  await getBridge()?.openThreadInNewWindow(threadKey);
}

export async function addThreadToWindow(threadKey: string, windowId: string): Promise<void> {
  await getBridge()?.addThreadToWindow(threadKey, windowId);
}

export async function focusWindowForThread(threadKey: string): Promise<void> {
  await getBridge()?.focusWindowForThread(threadKey);
}

/**
 * Reports where a native cross-window thread drag was released, in screen
 * coordinates, when no drop target accepted it. Call this only for a
 * `dragend` whose `dropEffect` is `"none"` — otherwise a drop target has
 * already moved the thread and this would move it a second time.
 */
export async function handleThreadDroppedOutsideWindow(
  threadKey: string,
  screenPoint: { x: number; y: number },
): Promise<void> {
  await getBridge()?.handleThreadDroppedOutsideWindow(threadKey, screenPoint);
}
