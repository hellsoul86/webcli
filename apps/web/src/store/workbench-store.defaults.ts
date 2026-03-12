import type { IntegrationState } from "./workbench-store.types";

export const WORKBENCH_STORAGE_KEY = "webcli-workbench";
export const WORKBENCH_STORAGE_VERSION = 3;

export const defaultConnection = {
  connected: false,
  childPid: null,
  authenticated: false,
  requiresOpenaiAuth: true,
  restartCount: 0,
  lastError: null,
};

export const defaultIntegrations: IntegrationState = {
  settingsOpen: false,
  settingsTab: "general",
  authStatus: null,
  config: null,
  mcpServers: [],
  skills: [],
  apps: [],
  plugins: [],
  fuzzySearch: {
    sessionId: null,
    query: "",
    status: "idle",
    results: [],
  },
};
