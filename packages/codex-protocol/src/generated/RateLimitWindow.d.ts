export type RateLimitWindow = {
    /**
     * Percentage (0-100) of the window that has been consumed.
     */
    used_percent: number;
    /**
     * Rolling window duration, in minutes.
     */
    window_minutes: number | null;
    /**
     * Unix timestamp (seconds since epoch) when the window resets.
     */
    resets_at: number | null;
};
//# sourceMappingURL=RateLimitWindow.d.ts.map