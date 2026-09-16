import { readAssistantText } from "./assistantTextSelection";

/** Case-insensitive substring matches, in document order, as offsets into `text`. */
export function findTextMatches(
  text: string,
  query: string,
): Array<{ start: number; end: number }> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const haystack = text.toLowerCase();
  const matches: Array<{ start: number; end: number }> = [];
  let searchStart = 0;
  for (;;) {
    const foundAt = haystack.indexOf(needle, searchStart);
    if (foundAt === -1) break;
    matches.push({ start: foundAt, end: foundAt + needle.length });
    searchStart = foundAt + needle.length;
  }
  return matches;
}

/**
 * Builds one DOM Range per match of `query` in `root`'s rendered text, in
 * document order. A match may span multiple text nodes (e.g. bold or link
 * markup splitting the matched words), so each range is built from the first
 * and last text chunk it overlaps rather than assuming a single text node.
 */
export function findConversationFindRangesInRoot(root: HTMLElement, query: string): Range[] {
  const { text, chunks } = readAssistantText(root);
  const ranges: Range[] = [];
  for (const { start, end } of findTextMatches(text, query)) {
    const first = chunks.find((chunk) => chunk.end > start);
    const last = chunks.findLast((chunk) => chunk.start < end);
    if (!first || !last) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(first.node, Math.max(0, start - first.start));
    range.setEnd(last.node, Math.min(last.node.length, end - last.start));
    if (!range.collapsed) ranges.push(range);
  }
  return ranges;
}

const ALL_MATCHES_HIGHLIGHT_NAME = "t3-conversation-find";
const ACTIVE_MATCH_HIGHLIGHT_NAME = "t3-conversation-find-active";

/**
 * Registers `ranges` in the shared "all matches" highlight, and `ranges[activeIndex]`
 * (if any) in the shared "active match" highlight, without disturbing ranges
 * other mounted rows have already registered. Returns a cleanup that removes
 * only this call's own ranges.
 */
export function applyConversationFindHighlight(ranges: Range[], activeIndex: number | null) {
  const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  if (!registry || typeof Highlight === "undefined" || ranges.length === 0) {
    return () => {};
  }

  const allHighlight = registry.get(ALL_MATCHES_HIGHLIGHT_NAME) ?? new Highlight();
  if (registry.get(ALL_MATCHES_HIGHLIGHT_NAME) !== allHighlight) {
    registry.set(ALL_MATCHES_HIGHLIGHT_NAME, allHighlight);
  }
  const activeHighlight = registry.get(ACTIVE_MATCH_HIGHLIGHT_NAME) ?? new Highlight();
  if (registry.get(ACTIVE_MATCH_HIGHLIGHT_NAME) !== activeHighlight) {
    registry.set(ACTIVE_MATCH_HIGHLIGHT_NAME, activeHighlight);
  }

  for (const range of ranges) allHighlight.add(range);
  const activeRange = activeIndex !== null ? ranges[activeIndex] : undefined;
  if (activeRange) activeHighlight.add(activeRange);

  return () => {
    for (const range of ranges) allHighlight.delete(range);
    if (activeRange) activeHighlight.delete(activeRange);
    if (allHighlight.size === 0) registry.delete(ALL_MATCHES_HIGHLIGHT_NAME);
    if (activeHighlight.size === 0) registry.delete(ACTIVE_MATCH_HIGHLIGHT_NAME);
  };
}

/**
 * Finds and highlights `query`'s matches within `root`, marking the match at
 * `activeOccurrenceInRow` (if any) as the active one. No-ops when the CSS
 * Custom Highlight API is unavailable; the row simply isn't highlighted, and
 * navigation still scrolls it into view.
 */
export function highlightConversationFindMatches({
  root,
  query,
  activeOccurrenceInRow,
}: {
  root: HTMLElement;
  query: string;
  activeOccurrenceInRow: number | null;
}) {
  if (query.trim().length === 0) return () => {};
  const ranges = findConversationFindRangesInRoot(root, query);
  return applyConversationFindHighlight(ranges, activeOccurrenceInRow);
}
