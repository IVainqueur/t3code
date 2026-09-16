import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@t3tools/contracts";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  findConversationMatches,
  resolveConversationFindKeyAction,
} from "./conversationFindMatches";
import type { ChatMessage } from "../../types";

function rows(
  entries: ReadonlyArray<readonly ["user" | "assistant", string]>,
): MessagesTimelineRow[] {
  const messages: ChatMessage[] = entries.map(([role, text], index) => ({
    id: MessageId.make(`message-${index}`),
    role,
    text,
    streaming: false,
    turnId: null,
    createdAt: new Date(index * 1000).toISOString(),
    updatedAt: new Date(index * 1000).toISOString(),
  }));
  return messages.map((message) => ({
    kind: "message",
    id: message.id,
    createdAt: message.createdAt,
    message,
    durationStart: message.createdAt,
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  }));
}

describe("findConversationMatches", () => {
  it("finds one match per occurrence in row order, case-insensitively", () => {
    const source = rows([
      ["user", "Where is the Bug in the parser?"],
      ["assistant", "The bug is in the tokenizer, not the parser."],
    ]);

    const matches = findConversationMatches(source, "bug");

    expect(matches).toEqual([
      { rowIndex: 0, messageId: "message-0", occurrenceInRow: 0 },
      { rowIndex: 1, messageId: "message-1", occurrenceInRow: 0 },
    ]);
  });

  it("returns multiple occurrences within a single row in order", () => {
    const source = rows([["assistant", "cat cat catalog cat"]]);

    const matches = findConversationMatches(source, "cat");

    expect(matches).toEqual([
      { rowIndex: 0, messageId: "message-0", occurrenceInRow: 0 },
      { rowIndex: 0, messageId: "message-0", occurrenceInRow: 1 },
      { rowIndex: 0, messageId: "message-0", occurrenceInRow: 2 },
      { rowIndex: 0, messageId: "message-0", occurrenceInRow: 3 },
    ]);
  });

  it("returns no matches for a blank query", () => {
    const source = rows([["user", "anything"]]);
    expect(findConversationMatches(source, "")).toEqual([]);
    expect(findConversationMatches(source, "   ")).toEqual([]);
  });

  it("ignores non-message rows", () => {
    const source: MessagesTimelineRow[] = [
      { kind: "context-compaction", id: "c1", createdAt: "1970-01-01T00:00:00.000Z", label: "bug" },
      ...rows([["user", "bug"]]),
    ];

    const matches = findConversationMatches(source, "bug");

    expect(matches).toEqual([{ rowIndex: 1, messageId: "message-0", occurrenceInRow: 0 }]);
  });
});

describe("resolveConversationFindKeyAction", () => {
  it("steps to the next match on Enter", () => {
    expect(resolveConversationFindKeyAction({ key: "Enter", shiftKey: false })).toBe("next");
  });

  it("steps to the previous match on Shift+Enter", () => {
    expect(resolveConversationFindKeyAction({ key: "Enter", shiftKey: true })).toBe("previous");
  });

  it("closes the find bar on Escape", () => {
    expect(resolveConversationFindKeyAction({ key: "Escape", shiftKey: false })).toBe("close");
  });

  it("ignores other keys", () => {
    expect(resolveConversationFindKeyAction({ key: "a", shiftKey: false })).toBeNull();
  });
});
