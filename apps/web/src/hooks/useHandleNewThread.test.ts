import { describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
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
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => null),
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
    reset(
      nextStoredDraft: typeof storedDraft,
      nextWindowRegistryState?: typeof windowRegistryState,
    ) {
      storedDraft = nextStoredDraft;
      windowRegistryState = nextWindowRegistryState ?? { isDesktop: false, myWindowId: null };
      router.state.location.href = "/";
      router.navigate.mockClear();
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
    router,
    get windowRegistryState() {
      return windowRegistryState;
    },
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: false }
      : new Map([
          [
            "environment-ssh",
            {
              settings: {
                defaultThreadEnvMode: "local",
                newWorktreesStartFromOrigin: false,
                defaultModelSelection: null,
              },
            },
          ],
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
vi.mock("../lib/chatThreadActions", () => ({
  hasExplicitComposerModelSelection: () => false,
  resolveNewDraftStartFromOrigin: () => false,
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
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => null }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

describe("useNewThreadHandler", () => {
  it.each([
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
  ])("abandons a delayed %s draft open when the user navigates elsewhere", async (_, draft) => {
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
    testState.reset(null, { isDesktop: true, myWindowId: "window-2" });
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
    testState.reset(null, { isDesktop: true, myWindowId: "main" });
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
    testState.reset(null, { isDesktop: false, myWindowId: null });
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
    testState.reset(null, { isDesktop: true, myWindowId: "window-2" });
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
});
