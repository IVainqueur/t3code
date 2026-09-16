import { describe, expect, it } from "vite-plus/test";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

import { visibleSubagentsForSidebar } from "./Sidebar.subagents";

describe("visibleSubagentsForSidebar", () => {
  it("filters out dismissed subagents", () => {
    const agents = [
      { id: "a", dismissed: false } as RuntimeSubagent,
      { id: "b", dismissed: true } as RuntimeSubagent,
    ];
    expect(visibleSubagentsForSidebar(agents).map((a) => a.id)).toEqual(["a"]);
  });

  it("includes completed, non-dismissed subagents", () => {
    const agents = [{ id: "a", dismissed: false, status: "completed" } as RuntimeSubagent];
    expect(visibleSubagentsForSidebar(agents)).toHaveLength(1);
  });

  it("preserves display order", () => {
    const agents = [
      { id: "a", dismissed: false } as RuntimeSubagent,
      { id: "b", dismissed: false } as RuntimeSubagent,
      { id: "c", dismissed: true } as RuntimeSubagent,
      { id: "d", dismissed: false } as RuntimeSubagent,
    ];
    expect(visibleSubagentsForSidebar(agents).map((a) => a.id)).toEqual(["a", "b", "d"]);
  });
});
