/**
 * Native HTML5 drag-and-drop for moving a thread between desktop windows.
 *
 * This is deliberately a second, separate drag system from the dnd-kit
 * reordering in `Sidebar.tsx`. dnd-kit is pointer-simulated and in-document,
 * so it cannot cross two Electron `BrowserWindow`s; only a real native drag
 * can. The two gestures share the same rows, so they are told apart by a
 * modifier: holding Alt/Option starts a cross-window drag, and everything
 * else stays the reorder gesture it has always been.
 *
 * `Sidebar.pointer.ts` cancels native drags outright while its sort sensor is
 * live, so it has a matching modifier check — the two must stay in agreement
 * or the row drags twice or not at all.
 */

/** Drag payload type carrying a scoped thread key. Named like the composer's
    mention payload, and for the same reason: so a drop target can tell an
    in-app thread drag from an OS file drag or a text selection. */
export const THREAD_WINDOW_DRAG_TYPE = "application/x-t3code-thread-key";

// Mirrors the main process's `MAIN_WINDOW_ID`. Threads live in the main
// window by default, so it is never a drop destination — "add to window"
// only ever means a secondary window.
const MAIN_WINDOW_ID = "main";

export interface ThreadWindowDragTransfer {
  readonly types: ReadonlyArray<string>;
  setData(format: string, data: string): void;
  getData(format: string): string;
  dropEffect: string;
  effectAllowed: string;
}

export interface ThreadWindowDragStartEvent {
  readonly dataTransfer: ThreadWindowDragTransfer | null;
  readonly altKey: boolean;
  preventDefault(): void;
}

export interface ThreadWindowDragEndEvent {
  readonly dataTransfer: ThreadWindowDragTransfer | null;
  readonly screenX: number;
  readonly screenY: number;
}

export interface ThreadWindowDropEvent {
  readonly dataTransfer: ThreadWindowDragTransfer;
  preventDefault(): void;
}

export function dataTransferHasThreadKey(types: ReadonlyArray<string>): boolean {
  return types.includes(THREAD_WINDOW_DRAG_TYPE);
}

/** True for a `dragstart` that should become a cross-window thread drag.
    Shared with the sort sensor so both sides gate on the same condition. */
export function isThreadWindowDragGesture(event: { readonly altKey: boolean }): boolean {
  return event.altKey;
}

/**
 * True for a `dragstart` the sort sensor must step aside for: the row has
 * already tagged it as a cross-window thread drag, and the modifier that
 * distinguishes it from a reorder was held. Anything else — a text selection,
 * an image, an unmodified row drag — stays blocked, exactly as before.
 */
export function isThreadWindowDragStart(event: {
  readonly altKey: boolean;
  readonly dataTransfer: { readonly types: ReadonlyArray<string> } | null;
}): boolean {
  if (!isThreadWindowDragGesture(event)) return false;
  return event.dataTransfer !== null && dataTransferHasThreadKey(event.dataTransfer.types);
}

export interface ThreadWindowDragHost {
  /**
   * The drag ended without any drop target taking it. Only the main process
   * can tell "released over another window" from "released over the desktop",
   * so this hands off the release point in screen coordinates.
   */
  onDroppedOutsideWindow(threadKey: string, screenPoint: { x: number; y: number }): void;
}

export interface ThreadWindowDragHandlers {
  readonly draggable: true;
  onDragStart(event: ThreadWindowDragStartEvent): void;
  onDragEnd(event: ThreadWindowDragEndEvent): void;
}

/**
 * Drag props for a sidebar thread row. `null` off the desktop, so a web row
 * carries no `draggable` attribute at all. Every row variant that can start a
 * drag gets the same object: a thread must behave identically whether it was
 * picked up from a card row, a slim row, or a search result.
 */
export function makeThreadWindowDragHandlers(input: {
  isDesktop: boolean;
  threadKey: string;
  host: ThreadWindowDragHost;
}): ThreadWindowDragHandlers | null {
  if (!input.isDesktop) return null;
  // Only a drag this row actually tagged may report a release point. Without
  // the flag, an untagged drag that merely happened to end on the row (a
  // rejected file drop, an aborted sort) would detach the thread.
  let tagged = false;
  return {
    draggable: true,
    onDragStart(event) {
      if (event.dataTransfer === null) return;
      if (!isThreadWindowDragGesture(event)) {
        // Not our gesture: cancel the native drag so the pointer sensor's
        // reorder gesture runs exactly as it did before this feature existed.
        event.preventDefault();
        return;
      }
      tagged = true;
      event.dataTransfer.setData(THREAD_WINDOW_DRAG_TYPE, input.threadKey);
      // Naming any other effect makes the browser cancel the drop outright.
      event.dataTransfer.effectAllowed = "move";
    },
    onDragEnd(event) {
      if (!tagged) return;
      tagged = false;
      // A drop target that took the thread reports its effect here. Anything
      // else — empty desktop, a window with no sidebar under the pointer, or
      // an OS that lost the payload in transit — reads as "none" and falls
      // through to the main process's bounds check.
      if (event.dataTransfer !== null && event.dataTransfer.dropEffect !== "none") return;
      input.host.onDroppedOutsideWindow(input.threadKey, { x: event.screenX, y: event.screenY });
    },
  };
}

export interface SidebarWindowDropHost {
  addThreadToWindow(threadKey: string, windowId: string): void;
}

export interface SidebarWindowDropHandlers {
  onDragOver(event: ThreadWindowDropEvent): void;
  onDrop(event: ThreadWindowDropEvent): void;
}

/**
 * Drop props for a secondary window's sidebar, so a thread dragged out of
 * another window can be taken in here. `null` wherever a drop would be
 * meaningless: on web, before this window's id has loaded, and in the main
 * window, which owns every thread it is not explicitly given away.
 */
export function makeSidebarWindowDropHandlers(input: {
  isDesktop: boolean;
  myWindowId: string | null;
  host: SidebarWindowDropHost;
}): SidebarWindowDropHandlers | null {
  const { myWindowId } = input;
  if (!input.isDesktop || myWindowId === null || myWindowId === MAIN_WINDOW_ID) return null;
  // Leave every other drag alone: the sidebar's file-drop handlers and the
  // composer mention drop both share these elements.
  const claim = (event: ThreadWindowDropEvent): boolean => {
    if (!dataTransferHasThreadKey(event.dataTransfer.types)) return false;
    event.preventDefault();
    return true;
  };
  return {
    onDragOver(event) {
      if (!claim(event)) return;
      event.dataTransfer.dropEffect = "move";
    },
    onDrop(event) {
      if (!claim(event)) return;
      const threadKey = event.dataTransfer.getData(THREAD_WINDOW_DRAG_TYPE);
      if (threadKey.length === 0) return;
      input.host.addThreadToWindow(threadKey, myWindowId);
    },
  };
}
