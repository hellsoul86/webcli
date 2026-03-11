import type { StateCreator } from "zustand";
import { defaultIntegrations } from "./workbench-store.defaults";
import { resetFuzzySearchState } from "./workbench-store.helpers";
import type { IntegrationSlice, WorkbenchState } from "./workbench-store.types";

export const createIntegrationSlice: StateCreator<WorkbenchState, [], [], IntegrationSlice> = (
  set,
) => ({
  integrations: defaultIntegrations,
  setSettingsOpen: (open) =>
    set((state) => ({
      integrations: {
        ...state.integrations,
        settingsOpen: open,
      },
    })),
  setSettingsTab: (tab) =>
    set((state) => ({
      integrations: {
        ...state.integrations,
        settingsTab: tab,
      },
    })),
  setIntegrations: (next) =>
    set((state) => ({
      integrations: {
        ...state.integrations,
        ...next,
      },
    })),
  setIntegrationSnapshot: (snapshot) =>
    set((state) => ({
      integrations: {
        ...state.integrations,
        ...snapshot,
      },
    })),
  setFuzzySearch: (next) =>
    set((state) => ({
      integrations: {
        ...state.integrations,
        fuzzySearch: {
          ...state.integrations.fuzzySearch,
          ...next,
        },
      },
    })),
  clearFuzzySearch: () =>
    set((state) => ({
      integrations: {
        ...state.integrations,
        fuzzySearch: resetFuzzySearchState(),
      },
    })),
});
