import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export interface ConversationFindMatch {
  readonly rowIndex: number;
  readonly messageId: string;
  /** 0-based index of this match among the matches within its own row. */
  readonly occurrenceInRow: number;
}

/** Case-insensitive substring search over message rows, in timeline order. */
export function findConversationMatches(
  rows: ReadonlyArray<MessagesTimelineRow>,
  query: string,
): ConversationFindMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const matches: ConversationFindMatch[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.kind !== "message" || !row.message.text) return;
    const haystack = row.message.text.toLowerCase();
    let occurrenceInRow = 0;
    let searchStart = 0;
    for (;;) {
      const foundAt = haystack.indexOf(needle, searchStart);
      if (foundAt === -1) break;
      matches.push({ rowIndex, messageId: row.message.id, occurrenceInRow });
      occurrenceInRow += 1;
      searchStart = foundAt + needle.length;
    }
  });
  return matches;
}

export type ConversationFindKeyAction = "next" | "previous" | "close";

export interface ConversationFindKeyEventLike {
  key: string;
  shiftKey: boolean;
}

/** Enter/Shift+Enter step through matches; Escape closes the find bar. */
export function resolveConversationFindKeyAction(
  event: ConversationFindKeyEventLike,
): ConversationFindKeyAction | null {
  if (event.key === "Enter") return event.shiftKey ? "previous" : "next";
  if (event.key === "Escape") return "close";
  return null;
}
