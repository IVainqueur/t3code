/**
 * Main-pane view of one subagent's transcript, reached from the sidebar's
 * nested agent rows and from the Agents panel.
 *
 * Prose blocks render through ChatMarkdown — the same renderer the chat
 * timeline uses for assistant text — so a subagent's output reads exactly
 * like the parent agent's. Tool blocks get the timeline's monospace body
 * treatment; the timeline's own row components cannot be reused here because
 * they read TimelineRowCtx and are built from work-log rows, not content
 * blocks (see the task report for the full finding).
 *
 * The transcript arrives on the live RuntimeSubagent, so a running agent's
 * blocks append in place with no fetch of its own.
 */
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  formatSubagentModelLabel,
  formatSubagentTokenCount,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Bot } from "lucide-react";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import { ScrollArea } from "~/components/ui/scroll-area";
import { STATUS_VISUALS } from "./AgentsPanel";
import ChatMarkdown from "./ChatMarkdown";
import { formatTranscriptBlockCode, transcriptEntryToBlock } from "./SubagentDetailView.logic";
import type { TranscriptBlock } from "./SubagentDetailView.logic";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "./WorkspaceBreadcrumb";

const toolBodyClassName =
  "mt-1 max-h-80 cursor-text overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-secondary-label text-[length:var(--font-size-code,0.6875rem)] leading-relaxed select-text";

function TranscriptBlockView({
  block,
  cwd,
  threadRef,
}: {
  readonly block: TranscriptBlock;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
}) {
  if (block.type === "text" || block.type === "thinking") {
    if (block.text.trim().length === 0) {
      return null;
    }
    return (
      <div className={cn("min-w-0", block.type === "thinking" && "text-muted-foreground italic")}>
        {block.type === "thinking" ? (
          <p className="mb-1 font-medium text-xs uppercase tracking-wide not-italic">Thinking</p>
        ) : null}
        <ChatMarkdown text={block.text} cwd={cwd} threadRef={threadRef} />
      </div>
    );
  }

  const body = formatTranscriptBlockCode(
    block.type === "tool_use" ? block.input : block.output,
  ).trim();
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "font-medium text-xs",
          block.type === "tool_result" && block.isError ? "text-destructive" : "text-foreground",
        )}
      >
        {block.type === "tool_use" ? block.toolName : block.isError ? "Tool error" : "Tool result"}
      </p>
      {body.length > 0 ? <pre className={toolBodyClassName}>{body}</pre> : null}
    </div>
  );
}

function SubagentBreadcrumb({
  threadTitle,
  onBackToThread,
  current,
}: {
  readonly threadTitle: string;
  readonly onBackToThread: () => void;
  readonly current: string;
}) {
  return (
    <WorkspaceBreadcrumb ariaLabel="Subagent">
      <WorkspaceBreadcrumbItem>
        <button
          type="button"
          onClick={onBackToThread}
          className="min-w-0 truncate rounded-sm hover:text-foreground"
        >
          {threadTitle}
        </button>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem current className="truncate">
        {current}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}

/**
 * Stand-in for a taskId with no matching subagent — a stale bookmark, or an
 * agent whose rows aged out of the activity window. Keeps the breadcrumb so
 * the way back to the parent thread is still reachable.
 */
export function SubagentNotFoundView({
  threadTitle,
  onBackToThread,
}: {
  readonly threadTitle: string;
  readonly onBackToThread: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-col gap-1.5 border-b px-4 py-3">
        <SubagentBreadcrumb
          threadTitle={threadTitle}
          onBackToThread={onBackToThread}
          current="Subagent not found"
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Bot aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="font-medium text-sm">Subagent not found</p>
        <p className="max-w-xs text-muted-foreground text-xs">
          This thread has no agent with that id. It may have been from an older run.
        </p>
      </div>
    </div>
  );
}

export function SubagentDetailView({
  agent,
  threadTitle,
  onBackToThread,
  cwd,
  threadRef,
}: {
  readonly agent: RuntimeSubagent;
  readonly threadTitle: string;
  readonly onBackToThread: () => void;
  readonly cwd?: string | undefined;
  readonly threadRef?: ScopedThreadRef | undefined;
}) {
  const blocks = useMemo(
    () =>
      agent.transcript.map((entry) => ({
        key: `${entry.ordinal}:${entry.kind}`,
        block: transcriptEntryToBlock(entry),
      })),
    [agent.transcript],
  );
  const status = STATUS_VISUALS[agent.status];
  const modelLabel = formatSubagentModelLabel(agent.model, agent.effort);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-col gap-1.5 border-b px-4 py-3">
        <SubagentBreadcrumb
          threadTitle={threadTitle}
          onBackToThread={onBackToThread}
          current={agent.title}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-1.5 rounded-full", status.dotClass)} />
            {status.label}
          </span>
          {agent.role ? <span className="truncate">{agent.role}</span> : null}
          {modelLabel ? <span className="truncate">{modelLabel}</span> : null}
          {agent.usage ? (
            <span className="tabular-nums">
              Σ {formatSubagentTokenCount(agent.usage.totalTokens)} tok
            </span>
          ) : null}
          {agent.dismissed ? <span>Dismissed</span> : null}
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        {blocks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Bot aria-hidden className="size-6 text-muted-foreground/60" />
            <p className="font-medium text-sm">No transcript yet</p>
            <p className="max-w-xs text-muted-foreground text-xs">
              This agent has not reported any output. Transcript blocks appear here as it works.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-4 py-4 text-sm">
            {blocks.map(({ key, block }) => (
              <TranscriptBlockView key={key} block={block} cwd={cwd} threadRef={threadRef} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
