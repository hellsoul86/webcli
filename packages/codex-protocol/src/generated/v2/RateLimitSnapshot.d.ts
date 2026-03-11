import type { PlanType } from "../PlanType";
import type { CreditsSnapshot } from "./CreditsSnapshot";
import type { RateLimitWindow } from "./RateLimitWindow";
export type RateLimitSnapshot = {
    limitId: string | null;
    limitName: string | null;
    primary: RateLimitWindow | null;
    secondary: RateLimitWindow | null;
    credits: CreditsSnapshot | null;
    planType: PlanType | null;
};
//# sourceMappingURL=RateLimitSnapshot.d.ts.map