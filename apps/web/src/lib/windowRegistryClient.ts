import { useSyncExternalStore } from "react";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";

/** The well-known id the Electron main process gives its main window. */
export const MAIN_WINDOW_ID = "main";

/**
 * Boot query parameter the Electron main process puts on a secondary
 * window's URL when that window is created around a specific thread.
 */
export const INITIAL_THREAD_KEY_PARAM = "initialThreadKey";

/**
 * The hash route a freshly opened window should start on, or `null` to leave
 * the boot route alone. Applied before the router's history is created, so a
 * window opened around a thread shows that thread instead of the landing
 * route. An explicit hash (a reload of an already-navigated window) always
 * wins over the boot parameter.
 */
export function resolveInitialThreadRouteHash(search: string, currentHash: string): string | null {
  if (currentHash !== "" && currentHash !== "#" && currentHash !== "#/") return null;
  const threadKey = new URLSearchParams(search).get(INITIAL_THREAD_KEY_PARAM);
  if (threadKey === null) return null;
  const threadRef = parseScopedThreadKey(threadKey);
  if (threadRef === null) return null;
  return `#/${encodeURIComponent(threadRef.environmentId)}/${encodeURIComponent(threadRef.threadId)}`;
}

export interface WindowMenuEntry {
  readonly id: string;
  readonly label: string;
}

export interface WindowRegistryState {
  isDesktop: boolean;
  myWindowId: string | null;
  myThreadKeys: ReadonlySet<string>;
  ownerByThreadKey: ReadonlyMap<string, string>;
  /**
   * Every window except the one asking, already labelled for menus. Derived
   * here so the sidebar context menu and the command palette cannot drift
   * apart, and so a window's label means the same thing whichever window's
   * menu it is read from.
   */
  otherWindows: ReadonlyArray<WindowMenuEntry>;
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
  otherWindows: [],
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

/**
 * Labels every known window, then drops the viewer's own. Secondary windows
 * are numbered by their position among *all* secondary windows — the main
 * process inserts them into the registry in creation order and
 * `Object.keys` preserves insertion order for these non-integer-like keys —
 * so one OS window carries the same number in every window's menu. Numbering
 * by position in the already-filtered list would renumber the same window
 * depending on who is looking at it.
 */
export function deriveOtherWindows(
  windowIds: ReadonlyArray<string>,
  myWindowId: string | null,
): ReadonlyArray<WindowMenuEntry> {
  const entries: WindowMenuEntry[] = [];
  let secondaryCount = 0;
  for (const id of windowIds) {
    const label = id === MAIN_WINDOW_ID ? "Main Window" : `Window ${(secondaryCount += 1)}`;
    if (id !== myWindowId) {
      entries.push({ id, label });
    }
  }
  return entries;
}

function toState(myWindowId: string | null, snapshot: RawSnapshot): WindowRegistryState {
  return {
    isDesktop: true,
    myWindowId,
    myThreadKeys: new Set(myWindowId ? (snapshot.windowThreadKeys[myWindowId] ?? []) : []),
    ownerByThreadKey: new Map(Object.entries(snapshot.ownerByThreadKey)),
    otherWindows: deriveOtherWindows(Object.keys(snapshot.windowThreadKeys), myWindowId),
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
