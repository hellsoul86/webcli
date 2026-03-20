import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const matrixPath = path.join(repoRoot, "docs", "desktop-parity-matrix.json");
const generatedRequestsPath = path.join(
  repoRoot,
  "packages",
  "runtime-codex",
  "src",
  "generated",
  "ClientRequest.ts",
);
const generatedNotificationsPath = path.join(
  repoRoot,
  "packages",
  "runtime-codex",
  "src",
  "generated",
  "ServerNotification.ts",
);

const VALID_STATUSES = ["supported", "partial", "missing", "deferred-wave2"];

test("desktop parity matrix covers every generated request and notification exactly once", () => {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  const requests = extractMethods(readFileSync(generatedRequestsPath, "utf8"));
  const notifications = extractMethods(readFileSync(generatedNotificationsPath, "utf8"));

  assertStatusPartition(matrix.requests, requests, "requests");
  assertStatusPartition(matrix.notifications, notifications, "notifications");

  const knownMethods = new Set([...requests, ...notifications]);
  for (const key of Object.keys(matrix.mappings ?? {})) {
    assert.ok(knownMethods.has(key), `Unexpected mapping key: ${key}`);
  }
  for (const key of Object.keys(matrix.notes ?? {})) {
    assert.ok(knownMethods.has(key), `Unexpected note key: ${key}`);
  }
});

function assertStatusPartition(statusMap, expectedMethods, label) {
  const seen = new Map();

  for (const status of VALID_STATUSES) {
    assert.ok(Array.isArray(statusMap[status]), `Missing ${label}.${status} array`);
    for (const method of statusMap[status]) {
      assert.equal(typeof method, "string", `${label}.${status} entries must be strings`);
      const previous = seen.get(method);
      assert.equal(
        previous,
        undefined,
        `${label} method ${method} appears more than once (${previous} and ${status})`,
      );
      seen.set(method, status);
    }
  }

  const expected = [...expectedMethods].sort();
  const actual = [...seen.keys()].sort();
  assert.deepEqual(actual, expected, `${label} matrix does not match generated methods`);
}

function extractMethods(source) {
  return [...source.matchAll(/"method": "([^"]+)"/g)].map((match) => match[1]);
}
