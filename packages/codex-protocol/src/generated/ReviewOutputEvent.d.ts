import type { ReviewFinding } from "./ReviewFinding";
/**
 * Structured review result produced by a child review session.
 */
export type ReviewOutputEvent = {
    findings: Array<ReviewFinding>;
    overall_correctness: string;
    overall_explanation: string;
    overall_confidence_score: number;
};
//# sourceMappingURL=ReviewOutputEvent.d.ts.map