# Celeste

Self-hosted, invite-only Discord music bot with a web control panel. Runs on Kubernetes (ArgoCD/GitOps),
secrets via External Secrets + Azure Key Vault, images and Helm chart published by GitHub Actions to GHCR.

Plays YouTube, Spotify, Apple Music, SoundCloud, Twitch, direct HTTP URLs and AzuraCast stations through Lavalink.
The full design is in [celeste-SPEC.md](celeste-SPEC.md); fixed names/ports/env vars are in [docs/contracts.md](docs/contracts.md).

## Architecture

```
namespace: celeste

        Cloudflare Tunnel (your own cloudflared)
                      | HTTP -> celeste-bot:8080
                      v
 +-----------------------+  WS/REST  +---------------------+  HTTP  +-------------------------+
 |          bot          |---------->|      lavalink       |------->|        resolver         |
 | TS, discord.js        |           | 4.2.x + LavaSrc     | (shim) | FastAPI + yt-dlp + Deno |
 | + web panel (Fastify, |           | [+ youtube-source   |        | + bgutil POT sidecar    |
 |   React/Mantine SPA)  |           |  when backend=plugin]        +-------------------------+
 +-----------+-----------+           +----------+----------+
             | SQL                              | (backend=plugin only)
 +-----------v-----------+                      v
 | Postgres (CNPG)       |           +---------------------+
 +-----------------------+           | yt-cipher (optional)|
                                     +---------------------+
 ExternalSecret --> Azure Key Vault
```

Nothing is exposed via Ingress or LoadBalancer. The only inbound path is your Cloudflare Tunnel to the bot's web port (8080).

## Repository layout

| Path                | What                                                | Docs                                                   |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `apps/bot`          | TypeScript bot + Fastify web API                    | [apps/bot/README.md](apps/bot/README.md)               |
| `apps/web`          | React + Mantine SPA, built into the bot image       |                                                        |
| `apps/resolver`     | Python FastAPI yt-dlp service                       | [apps/resolver/README.md](apps/resolver/README.md)     |
| `packages/shared`   | `@celeste/shared`: types shared by bot and web      |                                                        |
| `images/lavalink`   | Lavalink image with LavaSrc, shim and baked plugins | [images/lavalink/README.md](images/lavalink/README.md) |
| `charts/celeste`    | Helm chart for the whole stack                      | [charts/celeste/README.md](charts/celeste/README.md)   |
| `deploy/argocd`     | Example ArgoCD Application                          |                                                        |
| `.github/workflows` | CI: one workflow per component plus `release.yml`   |                                                        |

Images: `ghcr.io/slamanna212/celeste` (bot + web), `ghcr.io/slamanna212/celeste-resolver`,
`ghcr.io/slamanna212/celeste-lavalink`. Chart: `oci://ghcr.io/slamanna212/charts/celeste`.

Local development: Node 24 (`.nvmrc`), pnpm 10. `pnpm install`, then `pnpm build | lint | typecheck | test | format:check`.

## Manual setup

### 1. Discord application

1. <https://discord.com/developers/applications> -> New Application.
2. **Bot** tab: reset/copy the token (goes into AKV as `celeste-discord-token`).
3. **Bot** tab: turn **Public Bot OFF**. Otherwise anyone can add the bot to their server.
4. No privileged intents are needed. Leave Presence, Server Members and Message Content **off**
   (Celeste uses only `Guilds` and `GuildVoiceStates`).
5. Do not use the Installation tab's install link to add it anywhere; guilds are added with the link from `/admin invite-link` (see first boot).

### 2. Spotify app

<https://developer.spotify.com/dashboard> -> Create app (Web API). Redirect URI is not used; any placeholder such as
`http://127.0.0.1/callback` works. Copy Client ID and Client Secret into AKV. Spotify-generated playlists are not supported.

### 3. Apple Music token

Lavalink's Apple Music source uses a media API token (a JWT scraped from the Apple Music web player). Open
<https://music.apple.com> in a browser, open dev tools -> Network, and copy the `Authorization: Bearer <token>` value
from a request to `amp-api.music.apple.com` (the token only, without `Bearer `). It expires, so expect to rotate it in AKV
periodically (Apple Music playback is the first thing to stop working when it lapses).

### 4. Azure Key Vault secrets

Create these in the vault behind your `azure-keyvault` ClusterSecretStore. The chart's ExternalSecrets only contain the names.

| Purpose                                                        | AKV secret                       | Required                                        |
| -------------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| Discord bot token                                              | `celeste-discord-token`          | yes                                             |
| Lavalink password (any long random string)                     | `celeste-lavalink-password`      | yes                                             |
| Spotify client id                                              | `celeste-spotify-client-id`      | yes                                             |
| Spotify client secret                                          | `celeste-spotify-client-secret`  | yes                                             |
| Apple Music media API token                                    | `celeste-applemusic-token`       | yes                                             |
| Web session signing secret (`openssl rand -base64 48`)         | `celeste-web-session-secret`     | yes                                             |
| GHCR pull secret (dockerconfigjson)                            | `celeste-ghcr-pull`              | only if `pullSecret` enabled (private packages) |
| yt-dlp cookies (Netscape format, from a burner Google account) | `celeste-ytdlp-cookies`          | optional                                        |
| youtube-source OAuth refresh token (burner account)            | `celeste-yt-oauth-refresh-token` | optional, `backend=plugin`                      |
| yt-cipher password                                             | `celeste-ytcipher-password`      | `backend=plugin`                                |
| Cloudflare tunnel token                                        | `celeste-cloudflared-token`      | not used (you run your own cloudflared)         |

```sh
az keyvault secret set --vault-name <vault> --name celeste-discord-token --value '<token>'
az keyvault secret set --vault-name <vault> --name celeste-lavalink-password --value "$(openssl rand -base64 32)"
az keyvault secret set --vault-name <vault> --name celeste-web-session-secret --value "$(openssl rand -base64 48)"
# ...and so on for the rest
```

Never use your main Google account for cookies/OAuth. Use a burner.

### 5. Cluster prerequisites

The chart does not install these.

**CloudNativePG operator** (not yet installed on this cluster). Chart repo `https://cloudnative-pg.github.io/charts`, chart
`cloudnative-pg` (latest at time of writing: 0.29.1, operator 1.30.1). Add an Application to the GitOps repo, in the same style as the others:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cloudnative-pg
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: '1'
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  sources:
    - repoURL: https://cloudnative-pg.github.io/charts
      chart: cloudnative-pg
      targetRevision: '0.29.1'
      helm:
        valueFiles:
          - $values/values/cloudnative-pg.yaml
    - repoURL: https://github.com/slamanna212/HomelabArgoCD.git
      targetRevision: main
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: cnpg-system
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

`ServerSideApply=true` matters here: the CNPG CRDs are too large for client-side apply. An empty `values/cloudnative-pg.yaml` is fine.

**External Secrets Operator** with a `ClusterSecretStore` named `azure-keyvault` (already installed; the chart uses `external-secrets.io/v1`).

**k8up** (already installed). The chart only adds annotations so k8up runs `pg_dump` and skips the raw PGDATA volume.
You own the k8up `Schedule`/`Repository` for the `celeste` namespace.

**Cloudflare Tunnel.** The chart does not deploy cloudflared. In your existing tunnel, add a public hostname pointing at
`http://celeste-bot.celeste.svc.cluster.local:8080` (the service name assumes release name `celeste`). Only port 8080;
the metrics port 9090 must not be exposed. Set `networkPolicy.tunnelNamespace: cloudflared` in your values — with NetworkPolicy enabled and this unset, nothing can reach port 8080.

### 6. GHCR package visibility

Publishing from this repo creates three container packages (`celeste`, `celeste-resolver`, `celeste-lavalink`) plus
the chart package (`charts/celeste`). A package pushed with `GITHUB_TOKEN` and linked to the repo (the `org.opencontainers.image.source`
label that the metadata action sets) **inherits access permissions but not visibility**: new packages are **private** by default,
even from a public repo. After the first successful push, flip each one once:
GitHub profile -> Packages -> package -> Package settings -> Change visibility -> Public.
Until then the cluster cannot pull without an image pull secret (`celeste-ghcr-pull`). This is a one-time step per package.

### 7. Repository security settings

Settings -> Code security: enable **secret scanning** and **push protection**; enable Dependabot alerts.
Workflows never use `pull_request_target` and PR runs only build, never push. Both this repo and the GitOps repo are public:
keep IDs, hostnames and radio URLs out of both (runtime config lives in Postgres).

### 8. Deploy

1. Copy `charts/celeste/values-example.yaml` to `values/celeste.yaml` in the GitOps repo and edit.
2. Copy [deploy/argocd/application.example.yaml](deploy/argocd/application.example.yaml) to `apps/celeste.yaml` there. For OCI Helm charts ArgoCD's
   `repoURL` omits `oci://` (`ghcr.io/slamanna212/charts`), the same way the `ghcr.io/actions/...` runner charts are referenced.
3. Sync. Pods: bot, lavalink, resolver (with bgutil sidecar), Postgres, and yt-cipher when `youtube.backend=plugin`.

### 9. First boot

The DB starts empty, so no guild is allowed and the bot leaves any guild it is in.

1. Open a DM with the bot (find it via the application's page or a shared server) and run `/admin invite-link <guild_id>`.
   This allows that guild and returns an OAuth2 URL limited to that guild.
2. Open the URL and add the bot to the guild.
3. In the DM: `/admin config set panel_base_url https://your-panel-hostname`. Until this is set no web panel button is posted.
4. `/play` something in a voice channel. The now-playing embed carries the "Open web panel" link.
5. `/admin status` shows versions, active players and the YouTube backend in use.

Other settings (`idle_disconnect_seconds`, `default_volume`, `max_queue_length`, `history_retention_days`) are `/admin config` keys.

## Operations

### Switching the YouTube backend

Two backends, one active: `ytdlp` (default; yt-dlp via the resolver pod) and `plugin` (youtube-source + yt-cipher).
Change `youtube.backend` in `values/celeste.yaml` in the GitOps repo and sync. For `plugin`, ensure `celeste-ytcipher-password`
(and optionally `celeste-yt-oauth-refresh-token`) exist in AKV. Check `/admin status` afterwards.

If YouTube starts failing, first try the other backend, then bump yt-dlp (merge the Dependabot PR and release).

### Dependency updates

[Dependabot](.github/dependabot.yml) covers GitHub Actions, npm (pnpm workspace via the npm ecosystem, which reads `pnpm-lock.yaml`),
pip (`apps/resolver`), Go modules (`images/lavalink/shim`) and Dockerfiles. Updates arrive as PRs; nothing auto-deploys.

**The bgutil POT sidecar image version (a chart value) must be bumped together with the `bgutil-ytdlp-pot-provider` pip plugin in
`apps/resolver`.** Dependabot bumps only the pip side; the chart value is manual. A mismatch breaks PO token generation.

### Releasing

1. Tag `vX.Y.Z` on main and push the tag. `release.yml` builds and pushes the three images tagged `X.Y.Z` / `X.Y`, sets chart
   `version` and `appVersion` to `X.Y.Z` in the job (not committed) and pushes `oci://ghcr.io/slamanna212/charts/celeste:X.Y.Z`.
2. In the GitOps repo, bump `targetRevision` in `apps/celeste.yaml` to `X.Y.Z`. Nothing deploys until you do.

Chart-only changes can be published with a `chart-vX.Y.Z` tag (`chart.yml`). Pushes to main publish images tagged `sha-<short>` and `latest`.

### Backup and restore

Postgres is backed up by k8up running `pg_dump --clean --if-exists -Fc celeste` inside the Postgres pod (annotations set by the chart,
`postgres.k8up.enabled`). Raw PGDATA is excluded because a file-level copy of a live database is not consistent. The CNPG cluster has no native backups.

To restore:

1. Deploy the chart so CNPG creates a fresh, empty cluster with the `celeste` database; scale the bot to 0 (`kubectl -n celeste scale deploy/celeste-bot --replicas=0`).
2. Fetch the dump from the k8up repository (k8up `Restore` to a PVC or local path, or `restic restore` against the repo). The dump is a file inside the snapshot.
3. Restore into the empty cluster:
   ```sh
   kubectl -n celeste cp celeste.dump celeste-postgres-1:/tmp/celeste.dump -c postgres
   kubectl -n celeste exec celeste-postgres-1 -c postgres -- \
     pg_restore --clean --if-exists --no-owner -d celeste /tmp/celeste.dump
   ```
4. Scale the bot back up. Queues, settings, allowlist and playlists return.

Test this once after the first backup runs.

## CI

| Workflow       | Does                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `bot.yml`      | pnpm install (frozen lockfile), build shared, lint, typecheck, test, image `celeste`            |
| `resolver.yml` | ruff check + format check, pytest, image `celeste-resolver`                                     |
| `lavalink.yml` | `go vet` + `go test` on the shim, image `celeste-lavalink`                                      |
| `chart.yml`    | `helm lint`, `helm template` (both backends) through kubeconform; push chart on `chart-v*` tags |
| `release.yml`  | on `v*` tags: all images + chart with the tag version                                           |

GitHub-hosted `ubuntu-latest` only, actions pinned to commit SHAs, per-job least-privilege `permissions`. Images build for `linux/amd64`
with SBOM and max-mode provenance attestations. PRs build only; pushes happen on main and tags.
