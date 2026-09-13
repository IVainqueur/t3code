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

  it("produces no drop handlers in the main window, which is never an assignment target", () => {
    expect(
      makeSidebarWindowDropHandlers({ isDesktop: true, myWindowId: "main", host: host() }),
    ).toBeNull();
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
