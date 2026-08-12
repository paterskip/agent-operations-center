# Agent Operations Center

Read-only, live mission-control dashboard for a Hermes multi-agent team. It discovers all named Hermes Kanban boards, renders task lanes and agent presence, and streams board changes through SSE without exposing the Hermes dashboard API or filesystem paths to the browser.

![Agent Operations Center desktop dashboard](docs/dashboard-desktop.png)

## MVP features

- multi-board portfolio switcher;
- Kanban columns for `triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`, `review`, and `done`;
- agent presence and per-agent task filtering;
- live event stream powered by Hermes `task_events`;
- task drawer with dependencies, run history, comments, branch, and heartbeat;
- responsive dark mission-control UI;
- fail-closed HTTP Basic authentication in production;
- read-only SQLite connections and read-only Docker mounts.

## Local development

Requirements: Node.js 24+, npm, and a local Hermes installation.

```bash
cp .env.example .env.local
# Set credentials, or explicitly set AOC_DISABLE_AUTH=true for local-only development.
npm install
npm run dev -- --port 3010
```

Open `http://127.0.0.1:3010`. The default local data paths are `/root/.hermes/kanban` and `/root/.hermes/profiles`.

## VPS deployment

1. Copy `.env.example` to `.env` and set a long, unique password.
2. Build and start the private service:

```bash
docker compose up -d --build
docker compose ps
```

The container binds only to `127.0.0.1:3010`. Put Caddy or Nginx in front of it for TLS and a domain. Never change the mapping to `0.0.0.0` without a firewall and authentication layer.

Example Caddy site with Authelia (see `docker-compose.yml` for the Authelia service; you must create `deploy/authelia/` with your own `configuration.yml` + `users_database.yml`):

```caddy
agents.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3010
}
```

Authelia must be configured to emit `remote-user` and `remote-groups` headers (the app reads exactly these two). It must also **strip inbound `remote-user` / `remote-groups` headers from clients** — otherwise the header trust chain is broken. Basic auth or Authelia without 2FA is a minimum guard; prefer enforcing 2FA in the identity provider for public deployments.

### Password management

The panel deliberately does **not** manage passwords — that stays in Authelia's hands:

- **Self-service reset**: Authelia's built-in reset-password flow (requires SMTP in `deploy/authelia/configuration.yml`).
- **Admin (no SMTP needed)**: `docker exec agent-operations-center-authelia-1 authelia admin user password <username>` — sets a new hash atomically via Authelia's own CLI (no YAML editing by the app).
- **Brute-force protection**: enforced by Authelia itself (per-user/IP bans), not by the app.

### Kanban transitions (DnD)

The drag-and-drop surface only exposes transitions the `hermes kanban` CLI can execute natively (`schedule`, `claim`, `block`, `complete`, `reopen-review`; blocked tasks move through the CEO decision flow via `unblock`). Other lanes are agent-driven by design (`triage` is specified/decomposed by agents, `scheduled→ready` happens via `recompute_ready`, `review→done` by the reviewer) — a comment alone never changes task status.

### CSP in development

The middleware adds `'unsafe-eval'` to `script-src` only when `NODE_ENV !== "production"` (React dev mode requirement). Production builds (`next start` / the Docker image) never include it. If you run a staging environment, make sure it boots with `NODE_ENV=production`.

## Security model

- The application opens SQLite with `readonly` and `query_only` enabled.
- Docker mounts only the Kanban root read-only. Profile homes and their `.env` files are not mounted; the public role roster is supplied through `AOC_AGENTS`.
- API responses deliberately omit worker PIDs, session IDs, claim locks, workspace paths, attachment paths, credentials, and environment variables.
- No write endpoint, shell command, merge, or deployment action exists in MVP.
- Basic auth is a minimum guard. For public production use, prefer an identity-aware reverse proxy such as Cloudflare Access or Authelia.

## Architecture

`HermesDataSource` is represented by `lib/hermes.ts`. UI and routes depend on its sanitized snapshot rather than the raw SQLite schema, so a future official Hermes API adapter can replace direct reads without redesigning the interface.
