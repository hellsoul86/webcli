import type { ReviewCodeLocation } from "./ReviewCodeLocation";
/**
 * A single review finding describing an observed issue or recommendation.
 */
export type ReviewFinding = {
    title: string;
    body: string;
    confidence_score: number;
    priority: number;
    code_location: ReviewCodeLocation;
};
//# sourceMappingURL=ReviewFinding.d.ts.map