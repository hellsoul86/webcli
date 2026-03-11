import type { PlanType } from "../PlanType";
export type Account = {
    "type": "apiKey";
} | {
    "type": "chatgpt";
    email: string;
    planType: PlanType;
};
//# sourceMappingURL=Account.d.ts.map