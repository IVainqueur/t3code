import { describe, expect, it } from "vite-plus/test";
import { findConversationFindRangesInRoot, findTextMatches } from "./conversationFindHighlight";

describe("findTextMatches", () => {
  it("finds case-insensitive substring matches in order", () => {
    expect(findTextMatches("Where is the Bug? The bug is here.", "bug")).toEqual([
      { start: 13, end: 16 },
      { start: 22, end: 25 },
    ]);
  });

  it("returns no matches for a blank query", () => {
    expect(findTextMatches("anything", "")).toEqual([]);
    expect(findTextMatches("anything", "   ")).toEqual([]);
  });

  it("returns no matches when the query is absent", () => {
    expect(findTextMatches("hello world", "xyz")).toEqual([]);
  });
});

class FakeNode {
  parentElement: FakeNode | null = null;
  childNodes: FakeNode[] = [];

  constructor(
    readonly tagName: string,
    readonly data = "",
    readonly attributes: Record<string, string> = {},
  ) {}

  get nodeType() {
    return this.tagName === "#text" ? 3 : 1;
  }
  get length() {
    return this.data.length;
  }
  append(...children: FakeNode[]) {
    for (const child of children) child.parentElement = this;
    this.childNodes.push(...children);
    return this;
  }
  matches(selector: string) {
    return selector.split(", ").some((part) => part === this.tagName.toLowerCase());
  }
}

function fakeText(text: string) {
  return new FakeNode("#text", text);
}

class FakeRange {
  startContainer!: FakeNode;
  startOffset = 0;
  endContainer!: FakeNode;
  endOffset = 0;
  setStart(node: FakeNode, offset: number) {
    this.startContainer = node;
    this.startOffset = offset;
  }
  setEnd(node: FakeNode, offset: number) {
    this.endContainer = node;
    this.endOffset = offset;
  }
  get collapsed() {
    return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
  }
}

function fakeRoot(...children: FakeNode[]) {
  const root = new FakeNode("DIV").append(...children);
  return Object.assign(root, {
    ownerDocument: { createRange: () => new FakeRange() },
  }) as unknown as HTMLElement;
}

describe("findConversationFindRangesInRoot", () => {
  it("builds a range for a match spanning two text nodes across inline markup", () => {
    // "Hello " + "world" (inside <strong>), same as react-markdown emitting bold text.
    const before = fakeText("Hello ");
    const bold = fakeText("world");
    const root = fakeRoot(before, new FakeNode("strong").append(bold));

    const ranges = findConversationFindRangesInRoot(root, "hello world");

    expect(ranges).toHaveLength(1);
    const [range] = ranges as unknown as FakeRange[];
    expect(range!.startContainer).toBe(before);
    expect(range!.startOffset).toBe(0);
    expect(range!.endContainer).toBe(bold);
    expect(range!.endOffset).toBe(5);
  });

  it("builds one range per occurrence within a single text node", () => {
    const text = fakeText("cat cat catalog");
    const root = fakeRoot(text);

    const ranges = findConversationFindRangesInRoot(root, "cat") as unknown as FakeRange[];

    expect(ranges.map((range) => [range.startOffset, range.endOffset])).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });

  it("returns no ranges for a blank query", () => {
    const root = fakeRoot(fakeText("anything"));
    expect(findConversationFindRangesInRoot(root, "")).toEqual([]);
  });
});
