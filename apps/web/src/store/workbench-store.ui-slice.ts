import type { StateCreator } from "zustand";
import { defaultConnection } from "./workbench-store.defaults";
import type { UiSlice, WorkbenchState } from "./workbench-store.types";

export const createUiSlice: StateCreator<WorkbenchState, [], [], UiSlice> = (set) => ({
  connection: defaultConnection,
  activeWorkspaceId: "all",
  activeThreadId: null,
  inspectorTab: "diff",
  threadLifecycle: {
    archivedMode: "active",
  },
  setConnection: (next) =>
    set((state) => ({
      connection: {
        ...state.connection,
        ...next,
      },
    })),
  setActiveWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),
  setActiveThread: (threadId) => set({ activeThreadId: threadId }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setArchivedMode: (mode) =>
    set((state) => ({
      threadLifecycle: {
        ...state.threadLifecycle,
        archivedMode: mode,
      },
    })),
});
