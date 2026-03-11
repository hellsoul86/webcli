import type { CommandSessionSnapshot } from "@webcli/contracts";

export class CommandService {
  private readonly sessions = new Map<string, CommandSessionSnapshot>();

  start(input: {
    processId: string;
    command: string;
    cwd: string;
    tty: boolean;
    allowStdin: boolean;
  }): CommandSessionSnapshot {
    const session: CommandSessionSnapshot = {
      processId: input.processId,
      command: input.command,
      cwd: input.cwd,
      tty: input.tty,
      allowStdin: input.allowStdin,
      status: "running",
      stdout: "",
      stderr: "",
      exitCode: null,
      createdAt: Date.now(),
    };
    this.sessions.set(session.processId, session);
    return session;
  }

  appendOutput(
    processId: string,
    stream: "stdout" | "stderr",
    text: string,
  ): CommandSessionSnapshot | null {
    const current = this.sessions.get(processId);
    if (!current) {
      return null;
    }

    const next: CommandSessionSnapshot = {
      ...current,
      [stream]: `${current[stream]}${text}`,
    };
    this.sessions.set(processId, next);
    return next;
  }

  complete(
    processId: string,
    payload: { status: "completed" | "failed"; exitCode: number | null; stdout: string; stderr: string },
  ): CommandSessionSnapshot | null {
    const current = this.sessions.get(processId);
    if (!current) {
      return null;
    }

    const next: CommandSessionSnapshot = {
      ...current,
      status: payload.status,
      exitCode: payload.exitCode,
      stdout: payload.stdout ? `${current.stdout}${payload.stdout}` : current.stdout,
      stderr: payload.stderr ? `${current.stderr}${payload.stderr}` : current.stderr,
    };
    this.sessions.set(processId, next);
    return next;
  }

  get(processId: string): CommandSessionSnapshot | null {
    return this.sessions.get(processId) ?? null;
  }
}
