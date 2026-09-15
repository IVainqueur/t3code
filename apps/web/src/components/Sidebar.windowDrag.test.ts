import { describe, expect, it, vi } from "vite-plus/test";
import {
  THREAD_WINDOW_DRAG_TYPE,
  dataTransferHasThreadKey,
  isThreadWindowDragStart,
  makeSidebarWindowDropHandlers,
  makeThreadWindowDragHandlers,
} from "./Sidebar.windowDrag";

function transfer(options?: { types?: ReadonlyArray<string>; threadKey?: string }) {
  const data = new Map<string, string>();
  if (options?.threadKey !== undefined) {
    data.set(THREAD_WINDOW_DRAG_TYPE, options.threadKey);
  }
  return {
    data,
    types: options?.types ?? (options?.threadKey === undefined ? [] : [THREAD_WINDOW_DRAG_TYPE]),
    setData: (format: string, value: string) => data.set(format, value),
    getData: (format: string) => data.get(format) ?? "",
    dropEffect: "none",
    effectAllowed: "uninitialized",
  };
}

function dragStartEvent(options: {
  altKey: boolean;
  dataTransfer?: ReturnType<typeof transfer> | null;
}) {
  return {
    altKey: options.altKey,
    dataTransfer: options.dataTransfer === undefined ? transfer() : options.dataTransfer,
    preventDefault: vi.fn(),
  };
}

function dragEndEvent(options: {
  dropEffect: string;
  screenX?: number;
  screenY?: number;
  dataTransfer?: ReturnType<typeof transfer> | null;
}) {
  const dataTransfer =
    options.dataTransfer === undefined
      ? { ...transfer(), dropEffect: options.dropEffect }
      : options.dataTransfer;
  return {
    dataTransfer,
    screenX: options.screenX ?? 0,
    screenY: options.screenY ?? 0,
  };
}

function dropEvent(threadKey?: string) {
  return {
    dataTransfer: transfer(threadKey === undefined ? {} : { threadKey }),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe("dataTransferHasThreadKey", () => {
  it("recognizes the thread drag payload and ignores unrelated drags", () => {
    expect(dataTransferHasThreadKey([THREAD_WINDOW_DRAG_TYPE, "text/plain"])).toBe(true);
    expect(dataTransferHasThreadKey(["Files"])).toBe(false);
    expect(dataTransferHasThreadKey([])).toBe(false);
  });
});

describe("isThreadWindowDragStart", () => {
  const start = (altKey: boolean, types: ReadonlyArray<string> | null) => ({
    altKey,
    dataTransfer: types === null ? null : { types },
  });

  it("accepts only a modifier-held drag carrying the thread payload", () => {
    expect(isThreadWindowDragStart(start(true, [THREAD_WINDOW_DRAG_TYPE]))).toBe(true);
    expect(isThreadWindowDragStart(start(false, [THREAD_WINDOW_DRAG_TYPE]))).toBe(false);
    expect(isThreadWindowDragStart(start(true, ["Files"]))).toBe(false);
    expect(isThreadWindowDragStart(start(true, []))).toBe(false);
    expect(isThreadWindowDragStart(start(true, null))).toBe(false);
  });
});

/** Stands in for the document keydown subscription, so a test can press
    Escape at an exact point in the gesture. */
function escapeKey() {
  let press: (() => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    unsubscribe,
    get subscribed() {
      return press !== null;
    },
    press: () => {
      if (press === null) throw new Error("nothing is listening for Escape");
      press();
    },
    subscribeToCancel: (onCancel: () => void) => {
      press = onCancel;
      return () => {
        press = null;
        unsubscribe();
      };
    },
  };
}

describe("makeThreadWindowDragHandlers", () => {
  const host = () => ({ onDroppedOutsideWindow: vi.fn() });

  it("produces no drag props on web, where there are no other windows to drag to", () => {
    expect(
      makeThreadWindowDragHandlers({
        isDesktop: false,
        threadKey: "env-1:thread-1",
        host: host(),
      }),
    ).toBeNull();
  });

  it("marks the row draggable on desktop", () => {
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: host(),
    });
    expect(handlers?.draggable).toBe(true);
  });

  it("sets the thread key payload when the modifier is held", () => {
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: host(),
    })!;
    const event = dragStartEvent({ altKey: true });

    handlers.onDragStart(event);

    expect(event.dataTransfer!.getData(THREAD_WINDOW_DRAG_TYPE)).toBe("env-1:thread-1");
    expect(event.dataTransfer!.effectAllowed).toBe("move");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("aborts the native drag without the modifier, leaving the sort gesture alone", () => {
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: host(),
    })!;
    const event = dragStartEvent({ altKey: false });

    handlers.onDragStart(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer!.data.has(THREAD_WINDOW_DRAG_TYPE)).toBe(false);
  });

  it("reports the release point when no drop target accepted the drag", () => {
    const dragHost = host();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: dragHost,
    })!;

    handlers.onDragStart(dragStartEvent({ altKey: true }));
    handlers.onDragEnd(dragEndEvent({ dropEffect: "none", screenX: 1_280, screenY: 640 }));

    expect(dragHost.onDroppedOutsideWindow).toHaveBeenCalledWith("env-1:thread-1", {
      x: 1_280,
      y: 640,
    });
  });

  it("stays quiet when a drop target already handled the drag", () => {
    const dragHost = host();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: dragHost,
    })!;

    handlers.onDragStart(dragStartEvent({ altKey: true }));
    handlers.onDragEnd(dragEndEvent({ dropEffect: "move", screenX: 10, screenY: 10 }));

    expect(dragHost.onDroppedOutsideWindow).not.toHaveBeenCalled();
  });

  it("stays quiet for a drag it never tagged, so an unmodified sort cannot detach a thread", () => {
    const dragHost = host();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: dragHost,
    })!;

    handlers.onDragStart(dragStartEvent({ altKey: false }));
    handlers.onDragEnd(dragEndEvent({ dropEffect: "none" }));

    expect(dragHost.onDroppedOutsideWindow).not.toHaveBeenCalled();
  });

  it("does not report a second time when one tagged drag ends twice", () => {
    const dragHost = host();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: dragHost,
    })!;

    handlers.onDragStart(dragStartEvent({ altKey: true }));
    handlers.onDragEnd(dragEndEvent({ dropEffect: "none" }));
    handlers.onDragEnd(dragEndEvent({ dropEffect: "none" }));

    expect(dragHost.onDroppedOutsideWindow).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when the drag was cancelled with Escape", () => {
    // Chromium reports dropEffect "none" for an Escape-cancelled drag exactly
    // as it does for a release over empty desktop, so without the latch a
    // cancel would spawn a window the user just said they did not want.
    const dragHost = host();
    const escape = escapeKey();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: dragHost,
      subscribeToCancel: escape.subscribeToCancel,
    })!;

    handlers.onDragStart(dragStartEvent({ altKey: true }));
    escape.press();
    handlers.onDragEnd(dragEndEvent({ dropEffect: "none", screenX: 900, screenY: 400 }));

    expect(dragHost.onDroppedOutsideWindow).not.toHaveBeenCalled();
  });

  it("releases the Escape subscription and forgets the cancel once the drag ends", () => {
    const dragHost = host();
    const escape = escapeKey();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: dragHost,
      subscribeToCancel: escape.subscribeToCancel,
    })!;

    handlers.onDragStart(dragStartEvent({ altKey: true }));
    expect(escape.subscribed).toBe(true);
    escape.press();
    handlers.onDragEnd(dragEndEvent({ dropEffect: "none" }));
    expect(escape.subscribed).toBe(false);
    expect(escape.unsubscribe).toHaveBeenCalledOnce();

    // A cancelled gesture must not poison the next one.
    handlers.onDragStart(dragStartEvent({ altKey: true }));
    handlers.onDragEnd(dragEndEvent({ dropEffect: "none", screenX: 5, screenY: 6 }));
    expect(dragHost.onDroppedOutsideWindow).toHaveBeenCalledExactlyOnceWith("env-1:thread-1", {
      x: 5,
      y: 6,
    });
  });

  it("never listens for Escape during an unmodified drag it did not tag", () => {
    const escape = escapeKey();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: host(),
      subscribeToCancel: escape.subscribeToCancel,
    })!;

    handlers.onDragStart(dragStartEvent({ altKey: false }));

    expect(escape.subscribed).toBe(false);
  });

  it("survives a drag with no dataTransfer rather than throwing mid-gesture", () => {
    const dragHost = host();
    const handlers = makeThreadWindowDragHandlers({
      isDesktop: true,
      threadKey: "env-1:thread-1",
      host: dragHost,
    })!;

    expect(() =>
      handlers.onDragStart(dragStartEvent({ altKey: true, dataTransfer: null })),
    ).not.toThrow();
    expect(() =>
      handlers.onDragEnd(dragEndEvent({ dropEffect: "none", dataTransfer: null })),
    ).not.toThrow();
    expect(dragHost.onDroppedOutsideWindow).not.toHaveBeenCalled();
  });
});

describe("makeSidebarWindowDropHandlers", () => {
  const host = () => ({ addThreadToWindow: vi.fn() });

  it("produces no drop handlers on web", () => {
    expect(
      makeSidebarWindowDropHandlers({ isDesktop: false, myWindowId: "secondary-1", host: host() }),
    ).toBeNull();
  });

  it("takes a drop in the main window, which is how a thread comes back home", () => {
    const dropHost = host();
    const handlers = makeSidebarWindowDropHandlers({
      isDesktop: true,
      myWindowId: "main",
      host: dropHost,
    })!;
    const event = dropEvent("env-1:thread-1");

    // The cursor has to say "yes" while hovering main, or the affordance lies
    // about a drop that succeeds either way.
    handlers.onDragOver(event);
    expect(event.dataTransfer.dropEffect).toBe("move");

    handlers.onDrop(event);
    expect(dropHost.addThreadToWindow).toHaveBeenCalledWith("env-1:thread-1", "main");
  });

  it("produces no drop handlers before this window's id is known", () => {
    expect(
      makeSidebarWindowDropHandlers({ isDesktop: true, myWindowId: null, host: host() }),
    ).toBeNull();
  });

  it("claims a thread drag on dragover so the OS reports a move, not a rejection", () => {
    const handlers = makeSidebarWindowDropHandlers({
      isDesktop: true,
      myWindowId: "secondary-1",
      host: host(),
    })!;
    const event = dropEvent("env-1:thread-1");

    handlers.onDragOver(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer.dropEffect).toBe("move");
  });

  it("ignores a file drag, leaving it to the existing file-drop handlers", () => {
    const handlers = makeSidebarWindowDropHandlers({
      isDesktop: true,
      myWindowId: "secondary-1",
      host: host(),
    })!;
    const event = { ...dropEvent(), dataTransfer: transfer({ types: ["Files"] }) };

    handlers.onDragOver(event);
    handlers.onDrop(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.dataTransfer.dropEffect).toBe("none");
  });

  it("adds the dropped thread to this window", () => {
    const dropHost = host();
    const handlers = makeSidebarWindowDropHandlers({
      isDesktop: true,
      myWindowId: "secondary-1",
      host: dropHost,
    })!;
    const event = dropEvent("env-1:thread-1");

    handlers.onDrop(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dropHost.addThreadToWindow).toHaveBeenCalledWith("env-1:thread-1", "secondary-1");
  });

  it("ignores a thread drag whose payload did not survive the trip between windows", () => {
    const dropHost = host();
    const handlers = makeSidebarWindowDropHandlers({
      isDesktop: true,
      myWindowId: "secondary-1",
      host: dropHost,
    })!;
    const event = { ...dropEvent(), dataTransfer: transfer({ types: [THREAD_WINDOW_DRAG_TYPE] }) };

    handlers.onDrop(event);

    expect(dropHost.addThreadToWindow).not.toHaveBeenCalled();
  });
});
