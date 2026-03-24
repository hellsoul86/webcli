/**
 * ActiveSessionSlice — session-oriented state for the new architecture.
 *
 * This slice tracks the active server-side session and its lifecycle state.
 * It works alongside the existing slices (which remain for thread/turn data)
 * and adds session-level concepts aligned with Kimi CLI's web mode:
 *
 *  - Session state machine (stopped/idle/busy/restarting/error)
 *  - Session list management
 *  - Active session tracking
 */

import type { StateCreator } from "zustand";
import type {
  SessionStatus,
  SessionSummary,
} from "@webcli/contracts";

export type ActiveSessionSlice = {
  /** The currently active server-side session ID (null if no session). */
  activeSessionId: string | null;

  /** Cached session status for the active session. */
  activeSessionStatus: SessionStatus | null;

  /** All known session summaries, keyed by session ID. */
  sessionSummaries: Record<string, SessionSummary>;

  /** Whether a session is being created (loading state). */
  sessionCreating: boolean;

  // Actions
  setActiveSessionId: (sessionId: string | null) => void;
  setActiveSessionStatus: (status: SessionStatus | null) => void;
  updateSessionSummary: (summary: SessionSummary) => void;
  removeSessionSummary: (sessionId: string) => void;
  syncSessionList: (sessions: SessionSummary[]) => void;
  setSessionCreating: (creating: boolean) => void;
};

export const createActiveSessionSlice: StateCreator<
  ActiveSessionSlice,
  [],
  [],
  ActiveSessionSlice
> = (set) => ({
  activeSessionId: null,
  activeSessionStatus: null,
  sessionSummaries: {},
  sessionCreating: false,

  setActiveSessionId: (sessionId) =>
    set({ activeSessionId: sessionId }),

  setActiveSessionStatus: (status) =>
    set({ activeSessionStatus: status }),

  updateSessionSummary: (summary) =>
    set((state) => ({
      sessionSummaries: {
        ...state.sessionSummaries,
        [summary.id]: summary,
      },
    })),

  removeSessionSummary: (sessionId) =>
    set((state) => {
      const next = { ...state.sessionSummaries };
      delete next[sessionId];
      return { sessionSummaries: next };
    }),

  syncSessionList: (sessions) =>
    set({
      sessionSummaries: Object.fromEntries(
        sessions.map((s) => [s.id, s]),
      ),
    }),

  setSessionCreating: (creating) =>
    set({ sessionCreating: creating }),
});
