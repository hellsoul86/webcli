import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@webcli/contracts";
import { setAppLocale } from "./init";
import { localizeError, localizeErrorWithFallback } from "./errors";

describe("localized errors", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("maps known AppError codes to translated messages", () => {
    expect(localizeError(new AppError("git.not_repo", "Current project is not a Git repository"))).toBe(
      "当前项目不是 Git 仓库。",
    );
    expect(localizeError(new AppError("account.api_key_invalid", "Invalid API key"))).toBe(
      "API Key 无效。",
    );
    expect(
      localizeError(new AppError("account.device_code_start_failed", "Failed to start device code login")),
    ).toBe("无法启动 Device Code 登录。");
  });

  it("falls back to English after locale switch", async () => {
    await setAppLocale("en-US");
    expect(
      localizeError(new AppError("workspace.not_directory", "Workspace path is not a directory")),
    ).toBe("Workspace path is not a directory.");
    expect(localizeError(new AppError("account.chatgpt_tokens_invalid", "Invalid tokens"))).toBe(
      "The ChatGPT Auth Tokens are invalid.",
    );
    expect(
      localizeError(new AppError("account.device_code_start_failed", "Failed to start device code login")),
    ).toBe("Failed to start device code login.");
  });

  it("keeps unknown errors readable with a localized prefix", async () => {
    expect(localizeErrorWithFallback(new Error("boom"), "errors.requestFailed")).toBe(
      "请求失败: boom",
    );
    await setAppLocale("en-US");
    expect(localizeErrorWithFallback(new Error("boom"), "errors.requestFailed")).toBe(
      "Request failed: boom",
    );
  });
});
