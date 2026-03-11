/**
 * Details of a ghost commit created from a repository state.
 */
export type GhostCommit = {
    id: string;
    parent: string | null;
    preexisting_untracked_files: Array<string>;
    preexisting_untracked_dirs: Array<string>;
};
//# sourceMappingURL=GhostCommit.d.ts.map