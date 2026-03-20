import type { PendingServerRequest, RequestId } from "@webcli/contracts";

export class ApprovalBroker {
  private readonly threadOwners = new Map<string, string>();
  private readonly processOwners = new Map<string, string>();
  private readonly pendingById = new Map<RequestId, { approval: PendingServerRequest; sessionId: string }>();

  rememberThreadOwner(threadId: string, sessionId: string): void {
    this.threadOwners.set(threadId, sessionId);
  }

  rememberProcessOwner(processId: string, sessionId: string): void {
    this.processOwners.set(processId, sessionId);
  }

  resolveSessionIdForThread(threadId: string | null | undefined): string | null {
    if (!threadId) {
      return null;
    }

    return this.threadOwners.get(threadId) ?? null;
  }

  resolveSessionIdForProcess(processId: string | null | undefined): string | null {
    if (!processId) {
      return null;
    }

    return this.processOwners.get(processId) ?? null;
  }

  queue(approval: PendingServerRequest, sessionId: string): void {
    this.pendingById.set(approval.id, { approval, sessionId });
  }

  get(requestId: RequestId): PendingServerRequest | null {
    return this.pendingById.get(requestId)?.approval ?? null;
  }

  resolve(requestId: RequestId): PendingServerRequest | null {
    const pending = this.pendingById.get(requestId) ?? null;
    if (!pending) {
      return null;
    }

    this.pendingById.delete(requestId);
    return pending.approval;
  }

  listForSession(sessionId: string): Array<PendingServerRequest> {
    return Array.from(this.pendingById.values())
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => entry.approval);
  }

  list(): Array<PendingServerRequest> {
    return Array.from(this.pendingById.values()).map((entry) => entry.approval);
  }
}
