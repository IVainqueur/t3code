import type { RuntimeTaskId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { SubagentDetailView } from "../components/SubagentDetailView";
import { SidebarInset } from "~/components/ui/sidebar";
import { useThreadDetail, useThreadSubagent } from "../state/entities";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";

function SubagentDetailRouteView() {
  const navigate = useNavigate();
  const params = Route.useParams();
  const threadRef = resolveThreadRouteRef(params);
  const thread = useThreadDetail(threadRef);
  const agent = useThreadSubagent(threadRef, (params.taskId as RuntimeTaskId | undefined) ?? null);
  const onBackToThread = useCallback(() => {
    if (threadRef === null) {
      return;
    }
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
  }, [navigate, threadRef]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {agent === null ? null : (
        <SubagentDetailView
          agent={agent}
          threadTitle={thread?.title ?? params.threadId}
          onBackToThread={onBackToThread}
          cwd={thread?.worktreePath ?? undefined}
          threadRef={threadRef ?? undefined}
        />
      )}
    </SidebarInset>
  );
}

// `$threadId_` opts out of nesting under the thread route: that route is a
// leaf that renders ChatView with no <Outlet />, so a nested child would
// never mount. The URL path is unchanged.
export const Route = createFileRoute("/_chat/$environmentId/$threadId_/agents/$taskId")({
  component: SubagentDetailRouteView,
});
