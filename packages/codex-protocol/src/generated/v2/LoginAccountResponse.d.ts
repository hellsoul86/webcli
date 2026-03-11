export type LoginAccountResponse = {
    "type": "apiKey";
} | {
    "type": "chatgpt";
    loginId: string;
    /**
     * URL the client should open in a browser to initiate the OAuth flow.
     */
    authUrl: string;
} | {
    "type": "chatgptAuthTokens";
};
//# sourceMappingURL=LoginAccountResponse.d.ts.map