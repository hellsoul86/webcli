# WebCLI Staging Deployment

This directory contains the staging deployment scaffold for the following layout:

- Frontend static files served by Nginx
- `/api/*` and `/ws` reverse proxied by Nginx to the local Fastify server
- Fastify server bound to `127.0.0.1:4000`
- Cloudflare used only for proxied DNS and TLS in front of the origin

## Domains

- Primary app: `staging.webcli.royding.ai`
- API/ops endpoint: `api.staging.webcli.royding.ai`

The browser should only use `https://staging.webcli.royding.ai`.

## Cloudflare

Configure both records as `Proxied` A records pointing to the staging origin IP:

- `staging.webcli.royding.ai`
- `api.staging.webcli.royding.ai`

Recommended TLS mode: `Full (strict)`.

The API hostname is nested under `staging.webcli`, so the Cloudflare edge certificate must
explicitly cover either:

- `api.staging.webcli.royding.ai`
- or `*.staging.webcli.royding.ai`

`*.royding.ai` alone is not enough for `api.staging.webcli.royding.ai`.

The current staging setup uses:

- proxied DNS for both hostnames
- Cloudflare Origin CA on the source host
- an advanced edge certificate that covers `*.webcli.royding.ai` and `*.staging.webcli.royding.ai`

## Source Checkout

Clone the repository on the staging server and keep that checkout on `main`.

Suggested path:

```bash
/srv/webcli-staging/repo
```

Current origin host:

- Alibaba Cloud instance `i-6wegiqgjp702ffkm9i1z`
- public IP `8.216.82.40`

The deploy script copies that checkout into versioned release directories under:

```bash
/srv/webcli-staging/releases
```

The active release is exposed via:

```bash
/srv/webcli-staging/current
```

Persistent app data is kept outside the release tree:

```bash
/srv/webcli-staging/shared/data
```

## Prerequisites

- Node.js 25.x
- `npm`
- `nginx`
- `codex` installed on the server
- The Unix user that will run the service must already have completed:

```bash
codex login
```

On a fresh Ubuntu host, a simple way to get Node 25 is:

```bash
sudo npm install -g n
sudo n 25
hash -r
node -v
```

The installed `node`/`npm` should resolve from `/usr/local/bin`.

## Install the Service

1. Copy the env template and edit values as needed:

```bash
sudo cp deploy/staging/env/webcli-staging.env.example /etc/webcli-staging.env
```

2. Install the systemd unit template:

```bash
sudo cp deploy/staging/systemd/webcli-staging@.service /etc/systemd/system/webcli-staging@.service
sudo systemctl daemon-reload
```

3. Install the Nginx config:

```bash
sudo cp deploy/staging/nginx/webcli-staging.conf /etc/nginx/conf.d/webcli-staging.conf
sudo nginx -t
sudo systemctl reload nginx
```

## First Deploy

Run the deploy script from the repository checkout on the server:

```bash
cd /srv/webcli-staging/repo
sudo WEBCLI_STAGING_SERVICE_INSTANCE=<unix-user> bash ./deploy/staging/bin/deploy.sh
```

Example:

```bash
sudo WEBCLI_STAGING_SERVICE_INSTANCE=roy bash ./deploy/staging/bin/deploy.sh
```

This will:

- create a versioned release under `/srv/webcli-staging/releases`
- install dependencies in that release
- build all workspaces
- repoint `/srv/webcli-staging/current`
- restart `webcli-staging@<unix-user>`
- reload Nginx

## Updating Staging

From the repository checkout on the server:

```bash
git pull --ff-only
sudo WEBCLI_STAGING_SERVICE_INSTANCE=<unix-user> bash ./deploy/staging/bin/deploy.sh
```

## GitHub Actions Deploy

The repository supports both:

- automatic staging deploys after the `CI` workflow completes successfully on `main`
- manual staging deploys via the `Deploy Staging` workflow (`workflow_dispatch`)

Configure these GitHub Actions variables:

- `STAGING_SSH_HOST=8.216.82.40`
- `STAGING_SSH_USER=ecs-user`
- `STAGING_REPO_DIR=/srv/webcli-staging/repo`
- `STAGING_SERVICE_INSTANCE=ecs-user`
- `STAGING_APP_URL=https://staging.webcli.royding.ai`
- `STAGING_API_HEALTH_URL=https://api.staging.webcli.royding.ai/api/health`

Configure these GitHub Actions secrets:

- `STAGING_SSH_PRIVATE_KEY`
  - the private key that can SSH into the staging host as `ecs-user`
- `STAGING_SSH_KNOWN_HOSTS`
  - output of `ssh-keyscan -H 8.216.82.40`

The workflow logs into the staging host over SSH, fast-forwards the server checkout to
`origin/main`, runs `bash ./deploy/staging/bin/deploy.sh`, and then checks the public
health endpoints.

## Rollback

List releases:

```bash
ls -1 /srv/webcli-staging/releases
```

Rollback to a previous release:

```bash
sudo WEBCLI_STAGING_SERVICE_INSTANCE=<unix-user> bash ./deploy/staging/bin/rollback.sh <release-id>
```

Example:

```bash
sudo WEBCLI_STAGING_SERVICE_INSTANCE=roy bash ./deploy/staging/bin/rollback.sh 20260312T191500-9058550
```

## Verification

- `https://staging.webcli.royding.ai/api/health`
- `https://api.staging.webcli.royding.ai/api/health`
- open `https://staging.webcli.royding.ai`
- confirm thread bootstrap, streaming turns, and WebSocket connectivity

As of March 12, 2026, these two public endpoints are live and returning successful responses
through Cloudflare in `Full (strict)` mode.
