/**
 * Superset of [`codex_file_search::FileMatch`]
 */
export type FuzzyFileSearchResult = {
    root: string;
    path: string;
    file_name: string;
    score: number;
    indices: Array<number> | null;
};
//# sourceMappingURL=FuzzyFileSearchResult.d.ts.map