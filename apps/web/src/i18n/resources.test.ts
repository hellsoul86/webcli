import { describe, expect, it } from "vitest";
import enUS from "./resources/en-US";
import zhCN from "./resources/zh-CN";

describe("i18n resources", () => {
  it("keeps zh-CN and en-US keys in sync", () => {
    expect(collectKeys(enUS)).toEqual(collectKeys(zhCN));
  });
});

function collectKeys(value: unknown, prefix = ""): Array<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, nested]) => collectKeys(nested, prefix ? `${prefix}.${key}` : key))
    .sort();
}
