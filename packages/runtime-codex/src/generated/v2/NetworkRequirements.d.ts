export type NetworkRequirements = {
    enabled: boolean | null;
    httpPort: number | null;
    socksPort: number | null;
    allowUpstreamProxy: boolean | null;
    dangerouslyAllowNonLoopbackProxy: boolean | null;
    dangerouslyAllowAllUnixSockets: boolean | null;
    allowedDomains: Array<string> | null;
    deniedDomains: Array<string> | null;
    allowUnixSockets: Array<string> | null;
    allowLocalBinding: boolean | null;
};
//# sourceMappingURL=NetworkRequirements.d.ts.map