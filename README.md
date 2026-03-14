# WebCLI

Remote single-user Codex workbench built on top of `codex app-server`.

## Requirements

- Node.js 25+
- `codex` CLI installed on the target host
- The same Unix user that runs this app must already be authenticated with `codex`

Before starting the server for the first time:

```bash
codex login
```

## Development

Install dependencies:

```bash
npm install
```

Start the backend and Vite frontend together:

```bash
npm run dev
```

- Web app: `http://127.0.0.1:5173`
- API / WebSocket server: `http://127.0.0.1:4000`

## Production Build

Build all packages:

```bash
npm run build
```

Start the Fastify server:

```bash
npm run start -w @webcli/server
```

If `apps/web/dist` exists, the Fastify server will also serve the built SPA.

## Staging Deploy

The staging deployment target uses:

- Alibaba Cloud origin host
- Nginx for static files and reverse proxy
- Cloudflare for proxied DNS and TLS

Current public staging endpoints:

- `https://staging.webcli.royding.ai`
- `https://api.staging.webcli.royding.ai/api/health`

Deployment assets and instructions live in:

```bash
deploy/staging/README.md
```

Automatic and manual GitHub Actions deploy support is defined in:

```bash
.github/workflows/deploy-staging.yml
```

## Test

```bash
npm run test
```

## Notes

- This project does not implement browser-side ChatGPT login.
- Access control is expected to be enforced by a reverse proxy or zero-trust layer.
- Workspace metadata is stored in `apps/server/data/webcli.sqlite`.
- Thread history remains owned by Codex rollout storage; this app only indexes and projects it.
