import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { describe, expect, it } from "vite-plus/test";

import { isRestoreVisible } from "./AgentsPanel.dismissal.js";

describe("isRestoreVisible", () => {
  it("is true only for dismissed agents", () => {
    expect(isRestoreVisible({ dismissed: true } as RuntimeSubagent)).toBe(true);
    expect(isRestoreVisible({ dismissed: false } as RuntimeSubagent)).toBe(false);
  });
});
