import { AppError } from "@webcli/contracts";
import { translate } from "./init";

export function localizeError(error: unknown): string {
  return localizeErrorWithFallback(error, "errors.requestFailed");
}

export function localizeErrorWithFallback(error: unknown, fallbackKey: string): string {
  if (error instanceof AppError) {
    switch (error.code) {
      case "invalid.json":
        return translate("errors.invalidJson");
      case "resource.path_required":
        return translate("errors.resourcePathRequired");
      case "resource.not_found":
        return translate("errors.resourceNotFound");
      case "thread_summaries.invalid_query":
        return translate("errors.threadSummaryQueryInvalid");
      case "workspace.not_found":
        return translate("errors.workspaceNotFound");
      case "workspace.payload_required":
        return translate("errors.workspacePayloadRequired");
      case "workspace.name_required":
        return translate("errors.workspaceNameRequired");
      case "workspace.path_required":
        return translate("errors.workspacePathRequired");
      case "workspace.not_directory":
        return translate("errors.workspaceNotDirectory");
      case "workspace.outside_home":
        return translate("errors.workspaceOutsideHome", error.params);
      case "thread.not_found":
        return translate("errors.threadNotFound");
      case "approval.not_pending":
        return translate("errors.approvalNotPending");
      case "git.not_repo":
        return translate("errors.gitNotRepo");
      case "git.branch_switch_failed":
        return translate("errors.gitBranchSwitchFailed", error.params);
      case "account.api_key_invalid":
        return translate("errors.accountApiKeyInvalid");
      case "account.login_canceled":
        return translate("errors.accountLoginCanceled");
      case "account.auth_required":
        return translate("errors.accountAuthRequired");
      case "account.chatgpt_tokens_invalid":
        return translate("errors.accountChatgptTokensInvalid");
      case "account.device_code_start_failed":
        return translate("errors.accountDeviceCodeStartFailed");
      default:
        return `${translate("errors.unknownPrefix")}: ${error.message}`;
    }
  }

  if (error instanceof Error) {
    return error.message ? `${translate(fallbackKey)}: ${error.message}` : translate(fallbackKey);
  }

  return translate(fallbackKey);
}
