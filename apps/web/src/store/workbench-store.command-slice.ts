import type { StateCreator } from "zustand";
import type { CommandSlice, WorkbenchState } from "./workbench-store.types";

export const createCommandSlice: StateCreator<WorkbenchState, [], [], CommandSlice> = (set) => ({
  commandSessions: {},
  commandOrder: [],
  startCommandSession: ({ processId, command, cwd, tty, allowStdin }) =>
    set((state) => ({
      commandSessions: {
        ...state.commandSessions,
        [processId]: {
          processId,
          command,
          cwd,
          tty,
          allowStdin,
          status: "running",
          stdout: "",
          stderr: "",
          exitCode: null,
          createdAt: Date.now(),
        },
      },
      commandOrder: state.commandOrder.includes(processId)
        ? state.commandOrder
        : [processId, ...state.commandOrder],
    })),
  setCommandSession: (session) =>
    set((state) => {
      if (!session) {
        return state;
      }

      return {
        commandSessions: {
          ...state.commandSessions,
          [session.processId]: session,
        },
        commandOrder: state.commandOrder.includes(session.processId)
          ? state.commandOrder
          : [session.processId, ...state.commandOrder],
      };
    }),
  appendCommandOutput: (processId, stream, text) =>
    set((state) => {
      const session = state.commandSessions[processId];
      if (!session) {
        return state;
      }

      return {
        commandSessions: {
          ...state.commandSessions,
          [processId]: {
            ...session,
            [stream]: `${session[stream]}${text}`,
          },
        },
      };
    }),
  completeCommandSession: (processId, payload) =>
    set((state) => {
      const session = state.commandSessions[processId];
      if (!session) {
        return state;
      }

      return {
        commandSessions: {
          ...state.commandSessions,
          [processId]: {
            ...session,
            status: payload.exitCode === 0 ? "completed" : "failed",
            exitCode: payload.exitCode,
            stdout: payload.stdout ? `${session.stdout}${payload.stdout}` : session.stdout,
            stderr: payload.stderr ? `${session.stderr}${payload.stderr}` : session.stderr,
          },
        },
      };
    }),
  failCommandSession: (processId, message) =>
    set((state) => {
      const session = state.commandSessions[processId];
      if (!session) {
        return state;
      }

      return {
        commandSessions: {
          ...state.commandSessions,
          [processId]: {
            ...session,
            status: "failed",
            stderr: `${session.stderr}${session.stderr ? "\n" : ""}${message}`,
          },
        },
      };
    }),
});
