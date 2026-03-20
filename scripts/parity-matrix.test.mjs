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
const WAVE1_REQUESTS_NOT_MISSING = [
  "account/rateLimits/read",
  "configRequirements/read",
  "externalAgentConfig/detect",
  "externalAgentConfig/import",
  "config/batchWrite",
];
const WAVE1_NOTIFICATIONS_NOT_MISSING = [
  "account/rateLimits/updated",
  "model/rerouted",
  "deprecationNotice",
  "configWarning",
];
const WAVE2_REQUESTS_DEFERRED = ["experimentalFeature/list", "feedback/upload"];
const WAVE2_NOTIFICATIONS_DEFERRED = [
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/error",
  "thread/realtime/closed",
];

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

test("desktop parity matrix keeps implemented wave1 capability families out of missing", () => {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));

  assertNotMissing(matrix.requests, WAVE1_REQUESTS_NOT_MISSING, "requests");
  assertNotMissing(matrix.notifications, WAVE1_NOTIFICATIONS_NOT_MISSING, "notifications");
  assertDeferred(matrix.requests, WAVE2_REQUESTS_DEFERRED, "requests");
  assertDeferred(matrix.notifications, WAVE2_NOTIFICATIONS_DEFERRED, "notifications");
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

function assertNotMissing(statusMap, methods, label) {
  for (const method of methods) {
    assert.ok(
      !statusMap.missing.includes(method),
      `${label} method ${method} should not be marked missing`,
    );
    assert.ok(
      statusMap.supported.includes(method) || statusMap.partial.includes(method),
      `${label} method ${method} should be either supported or partial`,
    );
  }
}

function assertDeferred(statusMap, methods, label) {
  for (const method of methods) {
    assert.ok(
      statusMap["deferred-wave2"].includes(method),
      `${label} method ${method} should stay in deferred-wave2`,
    );
  }
}

function extractMethods(source) {
  return [...source.matchAll(/"method": "([^"]+)"/g)].map((match) => match[1]);
}
