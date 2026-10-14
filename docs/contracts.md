# Cross-component contracts

Fixed names, ports, and env vars that the bot, images, chart and CI all rely on. Change them here first.

## Owner decisions (spec §14)

| Item            | Decision                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHCR owner      | `ghcr.io/slamanna212`                                                                                                                                                                                                                          |
| Images          | `ghcr.io/slamanna212/celeste` (bot+web), `ghcr.io/slamanna212/celeste-resolver`, `ghcr.io/slamanna212/celeste-lavalink`                                                                                                                        |
| Chart           | `oci://ghcr.io/slamanna212/charts/celeste`                                                                                                                                                                                                     |
| CloudNativePG   | **not installed yet** — README documents installing it as a prerequisite                                                                                                                                                                       |
| Storage class   | `longhorn`                                                                                                                                                                                                                                     |
| ESO store       | `ClusterSecretStore` named `azure-keyvault`, API `external-secrets.io/v1`                                                                                                                                                                      |
| Tunnel          | Owner runs their own cloudflared in namespace `cloudflared`. The chart does **not** deploy cloudflared. `networkPolicy.tunnelNamespace: cloudflared` in the example values.                                                                    |
| YouTube backend | `ytdlp` is the default (owner confirmed it works and youtube-source currently doesn't). No bake-off tool. `plugin` stays supported as a switch.                                                                                                |
| GitOps          | Owner's ArgoCD repo uses multi-source Applications: chart source + `$values/values/<app>.yaml` from `https://github.com/slamanna212/HomelabArgoCD.git`, `syncOptions: [CreateNamespace=true, ServerSideApply=true]`, automated prune/selfHeal. |

## Kubernetes names (release name `<r>`, namespace `celeste`)

| Thing             | Name                                                                         | Port(s)                                               |
| ----------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Bot Service       | `<r>-bot`                                                                    | `8080` web (public via tunnel), `9090` metrics/health |
| Lavalink Service  | `<r>-lavalink`                                                               | `2333`                                                |
| Resolver Service  | `<r>-resolver`                                                               | `8080`                                                |
| bgutil sidecar    | in resolver pod                                                              | `127.0.0.1:4416`                                      |
| yt-cipher Service | `<r>-yt-cipher`                                                              | per upstream (verify)                                 |
| CNPG Cluster      | `<r>-postgres`                                                               | app secret `<r>-postgres-app`, key `uri`              |
| Pod label         | `app.kubernetes.io/component`: `bot` / `lavalink` / `resolver` / `yt-cipher` |                                                       |

## Env vars

**Bot** (`apps/bot`):

| Var                  | Source                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`      | AKV `celeste-discord-token`                                                           |
| `LAVALINK_HOST`      | `<r>-lavalink`                                                                        |
| `LAVALINK_PORT`      | `2333`                                                                                |
| `LAVALINK_PASSWORD`  | AKV `celeste-lavalink-password`                                                       |
| `DATABASE_URL`       | secret `<r>-postgres-app` key `uri`                                                   |
| `WEB_SESSION_SECRET` | AKV `celeste-web-session-secret`                                                      |
| `WEB_PORT`           | default `8080`                                                                        |
| `METRICS_PORT`       | default `9090`                                                                        |
| `YOUTUBE_BACKEND`    | `ytdlp` \| `plugin` (infra value from chart; shown in `/admin status`)                |
| `RESOLVER_URL`       | `http://<r>-resolver:8080` (optional; used by `/admin status` to fetch `/v1/version`) |
| `LOG_LEVEL`          | default `info`                                                                        |

**Lavalink** (`images/lavalink`): `LAVALINK_PASSWORD`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `APPLE_MUSIC_MEDIA_API_TOKEN`, `RESOLVER_URL` (read by the shim), and for backend=plugin: `YTCIPHER_PASSWORD`, `YT_OAUTH_REFRESH_TOKEN` (optional), `_JAVA_OPTIONS=-Xmx768m`. Config is mounted at `/opt/Lavalink/application.yml` (verify path for the upstream image).

**Resolver** (`apps/resolver`): `POT_BASE_URL` (default `http://127.0.0.1:4416`), `COOKIES_PATH` (default `/secrets/cookies.txt`), `EXEC_TIMEOUT_SECONDS` (30), `MAX_CONCURRENCY` (8), `PORT` (8080).

## AKV secret names

See spec §10. ExternalSecret `secretKey`s inside k8s secrets are free to choose; templates map them to the env vars above.

## Docker build contexts (used by CI)

| Image            | Dockerfile                   | Context                                                               |
| ---------------- | ---------------------------- | --------------------------------------------------------------------- |
| celeste          | `apps/bot/Dockerfile`        | repo root (pnpm workspace: `packages/shared`, `apps/bot`, `apps/web`) |
| celeste-resolver | `apps/resolver/Dockerfile`   | `apps/resolver`                                                       |
| celeste-lavalink | `images/lavalink/Dockerfile` | `images/lavalink`                                                     |

## Workspace

pnpm workspace packages: `packages/shared` (`@celeste/shared`: filter presets + web API types — the contract between bot and web), `apps/bot` (`@celeste/bot`), `apps/web` (`@celeste/web`). Node 24, TypeScript strict, ESM.
