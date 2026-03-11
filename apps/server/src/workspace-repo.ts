import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  WorkspaceCreateInput,
  WorkspaceRecord,
  WorkspaceUpdateInput,
} from "@webcli/codex-protocol";

type WorkspaceRow = {
  id: string;
  name: string;
  abs_path: string;
  default_model: string | null;
  approval_policy: WorkspaceRecord["approvalPolicy"];
  sandbox_mode: WorkspaceRecord["sandboxMode"];
  created_at: string;
  updated_at: string;
};

type IgnoredWorkspaceRow = {
  abs_path: string;
};

const DEFAULT_APPROVAL_POLICY: WorkspaceRecord["approvalPolicy"] = "on-request";
const DEFAULT_SANDBOX_MODE: WorkspaceRecord["sandboxMode"] = "danger-full-access";

export class WorkspaceRepo {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        abs_path TEXT NOT NULL UNIQUE,
        default_model TEXT,
        approval_policy TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ignored_workspaces (
        abs_path TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  list(): Array<WorkspaceRecord> {
    const rows = this.db
      .prepare("SELECT * FROM workspaces ORDER BY updated_at DESC, name ASC")
      .all() as Array<WorkspaceRow>;

    return rows.map(mapRow);
  }

  get(id: string): WorkspaceRecord | null {
    const row = this.db
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(id) as WorkspaceRow | undefined;

    return row ? mapRow(row) : null;
  }

  listIgnoredPaths(): Array<string> {
    const rows = this.db
      .prepare("SELECT abs_path FROM ignored_workspaces ORDER BY created_at DESC")
      .all() as Array<IgnoredWorkspaceRow>;

    return rows.map((row) => row.abs_path);
  }

  create(input: WorkspaceCreateInput): WorkspaceRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const absPath = normalizeAbsPath(input.absPath);
    this.unignorePath(absPath);

    this.db
      .prepare(
        `
        INSERT INTO workspaces (
          id, name, abs_path, default_model, approval_policy, sandbox_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.name.trim(),
        absPath,
        input.defaultModel ?? null,
        input.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
        input.sandboxMode ?? DEFAULT_SANDBOX_MODE,
        now,
        now,
      );

    return this.get(id)!;
  }

  update(id: string, input: WorkspaceUpdateInput): WorkspaceRecord | null {
    const existing = this.get(id);
    if (!existing) {
      return null;
    }

    const next: WorkspaceRecord = {
      ...existing,
      name: input.name?.trim() || existing.name,
      absPath: input.absPath ? normalizeAbsPath(input.absPath) : existing.absPath,
      defaultModel:
        input.defaultModel === undefined ? existing.defaultModel : input.defaultModel,
      approvalPolicy: input.approvalPolicy ?? existing.approvalPolicy,
      sandboxMode: input.sandboxMode ?? existing.sandboxMode,
      updatedAt: new Date().toISOString(),
    };
    this.unignorePath(next.absPath);

    this.db
      .prepare(
        `
        UPDATE workspaces
        SET name = ?, abs_path = ?, default_model = ?, approval_policy = ?, sandbox_mode = ?, updated_at = ?
        WHERE id = ?
        `,
      )
      .run(
        next.name,
        next.absPath,
        next.defaultModel,
        next.approvalPolicy,
        next.sandboxMode,
        next.updatedAt,
        id,
      );

    return this.get(id);
  }

  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) {
      return false;
    }

    const result = this.db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.ignorePath(existing.absPath);
    }

    return result.changes > 0;
  }

  ignorePath(absPath: string): void {
    const normalized = normalizeAbsPath(absPath);
    this.db
      .prepare(
        `
        INSERT INTO ignored_workspaces (abs_path, created_at)
        VALUES (?, ?)
        ON CONFLICT(abs_path) DO NOTHING
        `,
      )
      .run(normalized, new Date().toISOString());
  }

  unignorePath(absPath: string): void {
    const normalized = normalizeAbsPath(absPath);
    this.db.prepare("DELETE FROM ignored_workspaces WHERE abs_path = ?").run(normalized);
  }
}

function mapRow(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    absPath: row.abs_path,
    source: "saved",
    defaultModel: row.default_model,
    approvalPolicy: row.approval_policy,
    sandboxMode: row.sandbox_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAbsPath(value: string): string {
  return resolve(value);
}
