/**
 * Turns a persisted subagent transcript entry into a renderable block.
 *
 * Transcript payloads arrive as `unknown`: they come from provider adapters
 * and are replayed from storage without schema validation on the read path
 * (same contract as the rest of the subagent fold). So every accessor here is
 * tolerant, every unknown shape degrades to something displayable, and no
 * entry is ever dropped — a viewer that silently hides a block is worse than
 * one that shows its raw JSON.
 */
import type { SubagentTranscriptEntry } from "@t3tools/client-runtime/state/subagentRuntime";

export type TranscriptBlock =
  | { readonly type: "text"; readonly text: string; readonly at: string }
  | { readonly type: "thinking"; readonly text: string; readonly at: string }
  | {
      readonly type: "tool_use";
      readonly toolName: string;
      readonly input: unknown;
      readonly at: string;
    }
  | {
      readonly type: "tool_result";
      readonly output: unknown;
      readonly isError: boolean;
      readonly at: string;
    };

function record(content: unknown): Record<string, unknown> {
  return typeof content === "object" && content !== null
    ? (content as Record<string, unknown>)
    : {};
}

function firstString(content: unknown, keys: ReadonlyArray<string>): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  const source = record(content);
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

export function transcriptEntryToBlock(entry: SubagentTranscriptEntry): TranscriptBlock {
  const at = entry.at;
  switch (entry.kind) {
    case "thinking":
      return { type: "thinking", text: firstString(entry.content, ["thinking", "text"]) ?? "", at };
    case "tool_use": {
      const source = record(entry.content);
      return {
        type: "tool_use",
        toolName: firstString(entry.content, ["toolName", "name", "tool_name"]) ?? "tool",
        input: "input" in source ? source.input : entry.content,
        at,
      };
    }
    case "tool_result": {
      const source = record(entry.content);
      return {
        type: "tool_result",
        // Providers wrap results in a `content` envelope; unwrap it so the
        // viewer shows the result, not the envelope around it.
        output: "content" in source ? source.content : entry.content,
        isError: source.isError === true || source.is_error === true,
        at,
      };
    }
    default:
      // Unknown kinds (a provider adding, say, an image block) still render,
      // as whatever text they carry.
      return { type: "text", text: firstString(entry.content, ["text"]) ?? "", at };
  }
}

/** Monospace body for a tool block: JSON for structured payloads, raw text otherwise. */
export function formatTranscriptBlockCode(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
