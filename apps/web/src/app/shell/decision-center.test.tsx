import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingServerRequest, ServerRequestResolveInput } from "@webcli/contracts";
import { setAppLocale } from "../../i18n/init";
import { DecisionCenter } from "./decision-center";

describe("DecisionCenter", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("submits typed request-user-input answers", async () => {
    const onResolve = vi.fn(async (_resolution: ServerRequestResolveInput) => {});
    const request: PendingServerRequest = {
      id: "request-1",
      kind: "requestUserInput",
      method: "item/tool/requestUserInput",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      params: {
        questions: [
          {
            id: "approval_mode",
            header: "Approval mode",
            question: "Choose how to proceed",
            isOther: false,
            isSecret: false,
            options: [
              { label: "accept", description: "Continue" },
              { label: "decline", description: "Reject" },
            ],
          },
        ],
      },
    };

    render(<DecisionCenter requests={[request]} onResolve={onResolve} />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "decline" },
    });
    fireEvent.click(screen.getByTestId("decision-submit-request-1"));

    expect(onResolve).toHaveBeenCalledWith({
      requestId: "request-1",
      kind: "requestUserInput",
      resolution: {
        answers: {
          approval_mode: {
            answers: ["decline"],
          },
        },
      },
    });
  });

  it("shows allow-for-session action for command approvals that support it", () => {
    const onResolve = vi.fn(async (_resolution: ServerRequestResolveInput) => {});
    const request: PendingServerRequest = {
      id: "request-2",
      kind: "commandExecutionApproval",
      method: "item/commandExecution/requestApproval",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      params: {
        command: "npm test",
        availableDecisions: ["accept", "acceptForSession", "decline"],
      },
    };

    render(<DecisionCenter requests={[request]} onResolve={onResolve} />);

    expect(screen.getByTestId("decision-session-request-2")).toBeVisible();
  });
});
