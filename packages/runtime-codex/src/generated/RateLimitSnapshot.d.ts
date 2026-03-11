import type { CreditsSnapshot } from "./CreditsSnapshot";
import type { PlanType } from "./PlanType";
import type { RateLimitWindow } from "./RateLimitWindow";
export type RateLimitSnapshot = {
    limit_id: string | null;
    limit_name: string | null;
    primary: RateLimitWindow | null;
    secondary: RateLimitWindow | null;
    credits: CreditsSnapshot | null;
    plan_type: PlanType | null;
};
//# sourceMappingURL=RateLimitSnapshot.d.ts.map