import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree",
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  let windowRegistryState: {
    readonly isDesktop: boolean;
    readonly myWindowId: string | null;
  } = { isDesktop: false, myWindowId: null };
  const addThreadToWindow = vi.fn(async (_threadKey: string, _windowId: string) => undefined);
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  let routeTarget: { readonly kind: "draft"; readonly draftId: string } | null = null;
  let draftSession: {
    readonly logicalProjectKey: string;
    readonly promotedTo: null;
    readonly threadId: string;
    readonly createdAt: string;
    readonly runtimeMode: string;
    readonly interactionMode: string | null;
  } | null = null;
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => draftSession),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
  };

  return {
    addThreadToWindow,
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      options?: {
        windowRegistryState?: typeof windowRegistryState;
        workspaceDefaults?: { envMode: "local" | "worktree"; startFromOrigin: boolean };
      },
    ) {
      const workspaceDefaults = options?.workspaceDefaults ?? {
        envMode: "local" as const,
        startFromOrigin: false,
      };
      storedDraft = nextStoredDraft;
      windowRegistryState = options?.windowRegistryState ?? { isDesktop: false, myWindowId: null };
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      routeTarget = null;
      draftSession = null;
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      addThreadToWindow.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    // Simulates a concurrent invocation registering its own draft for the
    // same logical project while this invocation's await is pending — the
    // "raced draft" branch in useNewThreadHandler.
    setStoredDraft(nextStoredDraft: typeof storedDraft) {
      storedDraft = nextStoredDraft;
    },
    // Puts the user on an empty draft route for this same logical project —
    // the "reuse the draft I'm already looking at" branch.
    openDraftRoute(draftId: string, nextDraftSession: NonNullable<typeof draftSession>) {
      routeTarget = { kind: "draft", draftId };
      draftSession = nextDraftSession;
    },
    get routeTarget() {
      return routeTarget;
    },
    router,
    get windowRegistryState() {
      return windowRegistryState;
    },
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () =>
    new Map([
      [
        "environment-primary",
        {
          settings: {
            ...testState.targetSettings,
            newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
          },
        },
      ],
      ["environment-ssh", { settings: testState.targetSettings }],
    ]),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
  scopedThreadKey: (ref: { environmentId: string; threadId: string }) =>
    `${ref.environmentId}:${ref.threadId}`,
}));
vi.mock("../lib/windowRegistryClient", () => ({
  addThreadToWindow: (threadKey: string, windowId: string) =>
    testState.addThreadToWindow(threadKey, windowId),
  useWindowRegistry: () => testState.windowRegistryState,
}));
vi.mock("@t3tools/contracts", () => ({
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  // Environment settings pass through; the tests set project fields on the
  // project record, which the hook still honors until the server folds them.
  resolveProjectSettings: (settings: Record<string, unknown>) => ({
    settings,
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
}));
vi.mock("@t3tools/shared/threadEnvMode", () => ({
  resolveDefaultThreadEnvMode: (input: {
    readonly projectFile: "local" | "worktree" | null;
    readonly globalDefault: "local" | "worktree";
  }) => input.projectFile ?? input.globalDefault,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFileDefaultThreadEnvMode: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => ({
  readProjects: () => [
    {
      id: "project-remote",
      environmentId: "environment-ssh",
      workspaceRoot: "/remote/project",
      defaultThreadEnvMode: null,
      defaultModelSelection: null,
    },
  ],
  readThreadShell: () => null,
  useProjects: () => [],
  useThread: () => null,
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
}));
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => testState.routeTarget }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("adds the new thread to a secondary window that created it", async () => {
    testState.reset(null, { windowRegistryState: { isDesktop: true, myWindowId: "window-2" } });
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.addThreadToWindow).toHaveBeenCalledWith(
      "environment-ssh:thread-delayed",
      "window-2",
    );
  });

  it("does not add the new thread to a window when created from the main window", async () => {
    testState.reset(null, { windowRegistryState: { isDesktop: true, myWindowId: "main" } });
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.addThreadToWindow).not.toHaveBeenCalled();
  });

  it("does not add the new thread to a window on web/mobile (not desktop)", async () => {
    testState.reset(null, { windowRegistryState: { isDesktop: false, myWindowId: null } });
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.addThreadToWindow).not.toHaveBeenCalled();
  });

  it("adds the raced-draft winner's thread to a secondary window", async () => {
    testState.reset(null, { windowRegistryState: { isDesktop: true, myWindowId: "window-2" } });
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);

    // A concurrent invocation registers its own draft for the same logical
    // project while this invocation's env-mode resolution is still pending —
    // this invocation becomes the "raced" loser and defers to the winner.
    testState.setStoredDraft({
      draftId: "draft-winner",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-winner",
    });
    testState.completeProjectFileRead(null);
    const result = await pendingOpen;

    expect(result).toEqual({ draftId: "draft-winner", threadId: "thread-winner" });
    expect(testState.addThreadToWindow).toHaveBeenCalledWith(
      "environment-ssh:thread-winner",
      "window-2",
    );
  });

  it("adds a reused empty stored draft's thread to the secondary window that asked", async () => {
    testState.reset(
      {
        draftId: "draft-existing",
        environmentId: "environment-ssh",
        promotedTo: null,
        threadId: "thread-existing",
      },
      { windowRegistryState: { isDesktop: true, myWindowId: "window-2" } },
    );
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    const result = await pendingOpen;

    expect(result).toEqual({ draftId: "draft-existing", threadId: "thread-existing" });
    expect(testState.addThreadToWindow).toHaveBeenCalledWith(
      "environment-ssh:thread-existing",
      "window-2",
    );
  });

  it("adds a reused active draft's thread to the secondary window that asked", async () => {
    testState.reset(null, { windowRegistryState: { isDesktop: true, myWindowId: "window-2" } });
    testState.openDraftRoute("draft-open", {
      logicalProjectKey: "remote-project",
      promotedTo: null,
      threadId: "thread-open",
      createdAt: "2026-09-13T00:00:00.000Z",
      runtimeMode: "default",
      interactionMode: null,
    });
    const openThread = useNewThreadHandler();
    const result = await openThread({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);

    expect(result).toEqual({ draftId: "draft-open", threadId: "thread-open" });
    expect(testState.addThreadToWindow).toHaveBeenCalledWith(
      "environment-ssh:thread-open",
      "window-2",
    );
  });

  it.each([true, false])(
    "uses the target environment's start-from-origin default of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { workspaceDefaults: { envMode: "worktree", startFromOrigin } });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(projectRef);

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(opened).toEqual({
        draftId: draft?.draftId ?? "draft-delayed",
        threadId: draft?.threadId ?? "thread-delayed",
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ envMode: "worktree", startFromOrigin }),
        );
      }
    },
  );

  it.each([true, false])(
    "preserves an explicit start-from-origin choice of %s",
    async (startFromOrigin) => {
      testState.reset(draft, {
        workspaceDefaults: { envMode: "worktree", startFromOrigin: !startFromOrigin },
      });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;

      const opened = await openThread(projectRef, { envMode: "worktree", startFromOrigin });

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
    },
  );
});
