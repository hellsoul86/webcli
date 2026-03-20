import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  WORKBENCH_STORAGE_KEY,
  WORKBENCH_STORAGE_VERSION,
} from "./workbench-store.defaults";
import {
  countTimelineEntries,
  resetWorkbenchPersistStorage,
  resolvePersistStorage,
  selectTimeline,
  selectTimelineWindow,
} from "./workbench-store.helpers";
import { createCommandSlice } from "./workbench-store.command-slice";
import { createIntegrationSlice } from "./workbench-store.integrations-slice";
import { createSessionSlice } from "./workbench-store.session-slice";
import type { WorkbenchState } from "./workbench-store.types";
import { createUiSlice } from "./workbench-store.ui-slice";

export type {
  CommandSession,
  IntegrationState,
  PendingApproval,
  RealtimeAudioState,
  RealtimeSessionState,
  RealtimeTranscriptEntry,
  ThreadView,
  TimelineEntry,
} from "./workbench-store.types";
export type {
  InspectorTab,
  SettingsTab,
  ThreadArchiveMode,
} from "./workbench-store.types";

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (...args) => ({
      ...createUiSlice(...args),
      ...createSessionSlice(...args),
      ...createCommandSlice(...args),
      ...createIntegrationSlice(...args),
    }),
    {
      name: WORKBENCH_STORAGE_KEY,
      version: WORKBENCH_STORAGE_VERSION,
      storage: createJSONStorage(resolvePersistStorage),
      migrate: (persistedState: any) => ({
        ...persistedState,
        threadLifecycle: {
          archivedMode: "active",
        },
      }),
      partialize: (state) => ({
        activeThreadId: state.activeThreadId,
        activeWorkspaceId: state.activeWorkspaceId,
        inspectorTab: state.inspectorTab,
      }),
    },
  ),
);

export {
  countTimelineEntries,
  resetWorkbenchPersistStorage,
  selectTimeline,
  selectTimelineWindow,
};
