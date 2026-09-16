import { describe, expect, it } from "vite-plus/test";

import { formatTranscriptBlockCode, transcriptEntryToBlock } from "./SubagentDetailView.logic.js";

describe("transcriptEntryToBlock", () => {
  it("maps a text entry to a text block", () => {
    expect(
      transcriptEntryToBlock({ ordinal: 0, kind: "text", content: { text: "hi" }, at: "t0" }),
    ).toEqual({ type: "text", text: "hi", at: "t0" });
  });

  it("reads a bare string text payload", () => {
    expect(transcriptEntryToBlock({ ordinal: 0, kind: "text", content: "hi", at: "t0" })).toEqual({
      type: "text",
      text: "hi",
      at: "t0",
    });
  });

  it("maps a thinking entry, accepting either payload key", () => {
    expect(
      transcriptEntryToBlock({
        ordinal: 1,
        kind: "thinking",
        content: { thinking: "hmm" },
        at: "t1",
      }),
    ).toEqual({ type: "thinking", text: "hmm", at: "t1" });
    expect(
      transcriptEntryToBlock({ ordinal: 1, kind: "thinking", content: { text: "hmm" }, at: "t1" }),
    ).toEqual({ type: "thinking", text: "hmm", at: "t1" });
  });

  it("maps a tool_use entry to a tool_use block", () => {
    expect(
      transcriptEntryToBlock({
        ordinal: 2,
        kind: "tool_use",
        content: { toolName: "Read", input: { path: "/x" } },
        at: "t2",
      }),
    ).toEqual({ type: "tool_use", toolName: "Read", input: { path: "/x" }, at: "t2" });
  });

  it("falls back to the provider's name/tool_name key and an unnamed label", () => {
    expect(
      transcriptEntryToBlock({ ordinal: 3, kind: "tool_use", content: { name: "Bash" }, at: "t3" }),
    ).toMatchObject({ type: "tool_use", toolName: "Bash" });
    expect(
      transcriptEntryToBlock({
        ordinal: 3,
        kind: "tool_use",
        content: { tool_name: "Bash" },
        at: "t3",
      }),
    ).toMatchObject({ type: "tool_use", toolName: "Bash" });
    expect(
      transcriptEntryToBlock({ ordinal: 3, kind: "tool_use", content: {}, at: "t3" }),
    ).toMatchObject({ type: "tool_use", toolName: "tool" });
  });

  it("maps a tool_result entry, preferring a content payload over the envelope", () => {
    expect(
      transcriptEntryToBlock({
        ordinal: 4,
        kind: "tool_result",
        content: { content: "ok", isError: true },
        at: "t4",
      }),
    ).toEqual({ type: "tool_result", output: "ok", isError: true, at: "t4" });
    expect(
      transcriptEntryToBlock({ ordinal: 4, kind: "tool_result", content: { rows: 2 }, at: "t4" }),
    ).toEqual({ type: "tool_result", output: { rows: 2 }, isError: false, at: "t4" });
  });

  it("degrades an unknown kind to text rather than dropping the entry", () => {
    expect(
      transcriptEntryToBlock({
        ordinal: 5,
        kind: "image" as never,
        content: { text: "x" },
        at: "t5",
      }),
    ).toEqual({ type: "text", text: "x", at: "t5" });
  });
});

describe("formatTranscriptBlockCode", () => {
  it("pretty-prints objects and passes strings through", () => {
    expect(formatTranscriptBlockCode({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatTranscriptBlockCode("plain")).toBe("plain");
    expect(formatTranscriptBlockCode(undefined)).toBe("");
  });
});
