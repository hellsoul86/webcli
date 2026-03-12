import { beforeEach, describe, expect, it } from "vitest";
import { setAppLocale } from "./init";
import { formatDateTime, formatNumber, formatPercent, formatRelativeShort } from "./format";

describe("i18n formatters", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("formats relative time in Chinese by default", () => {
    const now = Date.UTC(2026, 2, 12, 12, 0, 0);
    expect(formatRelativeShort(now - 3 * 60 * 1000, now, "zh-CN")).toBe("3分");
    expect(formatRelativeShort(now - 2 * 24 * 60 * 60 * 1000, now, "zh-CN")).toBe("2天");
  });

  it("formats relative time in English when locale is en-US", () => {
    const now = Date.UTC(2026, 2, 12, 12, 0, 0);
    expect(formatRelativeShort(now - 3 * 60 * 1000, now, "en-US")).toBe("3m");
    expect(formatRelativeShort(now - 2 * 24 * 60 * 60 * 1000, now, "en-US")).toBe("2d");
  });

  it("formats numbers, percentages, and dates by locale", () => {
    expect(formatNumber(12034, "en-US")).toBe("12,034");
    expect(formatPercent(0.72, "en-US")).toBe("72%");
    expect(formatDateTime(Date.UTC(2026, 2, 12, 4, 5), "en-US")).toContain("2026");
    expect(formatDateTime(Date.UTC(2026, 2, 12, 4, 5), "zh-CN")).toContain("2026/");
  });
});
