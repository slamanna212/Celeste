# Celeste — Discord Music Bot Build Spec

**Celeste** is a self-hosted, invite-only Discord music bot with a web control panel. Runs on the homelab Kubernetes cluster (kubeadm, Cilium, Traefik, MetalLB, Longhorn, ArgoCD/GitOps). Secrets come from Azure Key Vault via External Secrets Operator. Container images and the Helm chart are built and published by GitHub Actions.

This document is the source of truth for the initial build. Where it says **VERIFY**, check upstream docs/source before implementing. Do not guess. Where it says **ASK OWNER**, stop and ask.

---

## 1. Goals

- Play audio in Discord voice channels from: **YouTube, Spotify, Apple Music, SoundCloud, Twitch streams, direct HTTP URLs, and AzuraCast stations**.
- Full queue management, skip, vote-skip, now-playing embeds, per-guild volume and audio filters.
- **Web control panel** reachable through a Cloudflare Tunnel; a panel link is posted automatically when playback starts.
- Invite-only: the owner decides which guilds can use it.
- Survives restarts: bot redeploys don't lose queues or interrupt playback.
- YouTube extraction is swappable between two backends, so a YouTube breakage in one can be worked around with a config change.
- One Helm chart deploys the whole stack.

### Non-goals (v1)
- Public bot / sharding.
- Lyrics.
- Multi-node Lavalink.

---

## 2. Architecture

```
namespace: celeste

                    Cloudflare Tunnel (cloudflared Deployment)
                                  │ HTTPS → http://bot:8080
                                  ▼
┌───────────────────────┐  WS/REST  ┌─────────────────────────┐   HTTP   ┌──────────────────────────┐
│          bot          │─────────▶│        lavalink          │────────▶│        resolver          │
│ TS, discord.js        │          │ 4.2.x + LavaSrc          │ (shim)  │ FastAPI + yt-dlp + Deno  │
│ + web panel (Fastify, │          │ [+ youtube-source,       │         │ + bgutil POT sidecar     │
│   React/Mantine SPA)  │          │    when backend=plugin]  │         └──────────────────────────┘
│ 1 replica             │          └──────────┬──────────────┘
└──────────┬────────────┘                     │ HTTP (backend=plugin only)
           │ SQL                              ▼
┌──────────▼────────────┐          ┌─────────────────────────┐
│ Postgres (CNPG)       │          │ yt-cipher (optional)    │
│ queue, settings,      │          └─────────────────────────┘
│ allowlist, history,   │
│ playlists, web sessions│
└───────────────────────┘

ExternalSecret ──▶ Azure Key Vault
```

Nothing is exposed via Ingress or LoadBalancer. The only inbound path is the Cloudflare Tunnel to the bot's web port. Everything else is ClusterIP.

### Component responsibilities

| Component | Responsibility |
|---|---|
| **bot** | Slash commands, permissions, guild allowlist, queue logic, vote-skip, embeds, AzuraCast now-playing, web panel API + static SPA + realtime updates. Talks to Lavalink via client lib. Holds no audio. |
| **lavalink** | Voice connections (DAVE E2EE), track loading, decoding, filters, volume, Opus encoding. Non-YouTube sources natively or via LavaSrc. YouTube via the active backend (§3). |
| **resolver** | Runs yt-dlp behind a narrow HTTP API. Only place yt-dlp, Deno, and the PO token provider exist. |
| **yt-cipher** | Remote signature-cipher server for the youtube-source plugin. Deployed only when `youtube.backend=plugin`. |
| **postgres** | All persistent state. CloudNativePG `Cluster`. |
| **cloudflared** | Cloudflare Tunnel connector routing the panel hostname to the bot Service. Optional in the chart (owner may already run a tunnel). |

---

## 3. Key design decisions

1. **Lavalink for all audio.** Decoding is always on, so per-guild volume and filters work everywhere.
2. **Two interchangeable YouTube backends, one active at a time**, selected by Helm value `youtube.backend`:
   - `ytdlp` (**default**): LavaSrc's yt-dlp source. The `path` points to a shim baked into the Lavalink image that forwards argv to the resolver pod.
   - `plugin`: `dev.lavalink.youtube:youtube-plugin` with a self-hosted `yt-cipher` remote cipher server, optional OAuth refresh token and PO token.
   - Only one can be active because both claim YouTube URLs and `ytsearch:` and Lavalink does not fall through to another source manager on failure.
   - Rationale: neither is guaranteed to work at any given time. The youtube-source plugin broke on nearly all tracks after YouTube's SABR change in early Sept 2026; its latest tagged release is still 1.18.2 (July 2026) and recovery has relied on unreleased snapshot builds. yt-dlp typically ships fixes faster but also breaks periodically. Milestone 2 runs a bake-off (§12) and the default is set from the results, not assumed.
3. **yt-dlp runs in its own pod**, never in the bot or Lavalink images.
4. **Spotify and Apple Music are mirrored**: LavaSrc resolves metadata, then plays via providers (`ytsearch` ISRC → `ytsearch` text → `scsearch` text).
5. **Postgres is the only datastore** (no Valkey/Redis). Queue/state write rates are trivial at this scale. CloudNativePG operator manages it.
6. **Secrets: Azure Key Vault via External Secrets Operator.**
7. **Languages:** TypeScript for bot and web panel. Python for the resolver. Go for the shim.
8. **Invite-only** via Discord "Public Bot" off **and** an in-bot guild allowlist.
9. **Web panel served by the bot process** (it owns the players and the Discord client). A panel link is generated automatically when a playback session starts and posted with the first now-playing embed; no login flow.
10. **Delivery:** GitHub Actions builds all images and publishes a Helm chart (OCI) to GHCR. ArgoCD deploys the chart.
11. **Repo is public.** Consequences:
    - GHCR packages are public; no imagePullSecret by default (kept as a chart toggle in case the repo goes private later).
    - CI runs on **GitHub-hosted runners only**. Never self-hosted runners on a public repo: fork PRs can execute code on them.
    - Workflows use `pull_request` (not `pull_request_target`), least-privilege `permissions:`, and pinned action SHAs.
12. **The owner's GitOps repo is also public, so all runtime config lives in the database**, not in Helm values or env:
    - Helm values hold only infrastructure: image tags, YouTube backend, resources, storage class, ESO store name, NetworkPolicy toggles. Nothing identifying (no guild IDs, user IDs, panel hostname, radio URLs).
    - Env vars hold only secrets (from AKV) and in-cluster connection details.
    - Everything else (owners/admins, guild allowlist, panel base URL, defaults, radio sources) is set at runtime through `/admin` commands and stored in Postgres.
    - Bot owner is discovered from the Discord application itself (§7 Access control), so first boot needs no config.
13. **Backups: k8up** (owner-managed Schedule/Repository, outside this chart). The chart makes Postgres back up consistently under k8up (§10).

---

## 4. Repository layout (monorepo)

```
celeste/
├── apps/
│   ├── bot/                  # TypeScript bot + web API (Fastify)
│   ├── web/                  # React + Mantine SPA (built into the bot image)
│   └── resolver/             # Python FastAPI yt-dlp service
├── images/
│   └── lavalink/
│       ├── Dockerfile        # FROM official lavalink, adds shim + baked plugins
│       ├── config/           # application.yml templates per backend
│       └── shim/             # Go source for ytdlp-shim
├── charts/
│   └── celeste/              # Helm chart for the whole stack
├── deploy/
│   └── argocd/               # application.example.yaml (owner's real Application lives in their GitOps repo)
├── tools/
│   └── yt-bakeoff/           # script for milestone 2 bake-off
├── .github/workflows/
└── README.md
```

Package manager: pnpm workspaces for `apps/bot` and `apps/web`.

---

## 5. Resolver service (`apps/resolver`)

### Image
- Base: `python:3.12-slim` (glibc).
- Install a **pinned** `yt-dlp` version (in `requirements.txt`) with default extras, the EJS challenge-solver package if separate (**VERIFY** current yt-dlp README/wiki "EJS" page for packaging), **Deno** as the JS runtime (**VERIFY** yt-dlp's current recommended runtime), and `bgutil-ytdlp-pot-provider` pip plugin.
- bgutil **plugin version must match the sidecar server version** exactly. Pin both from one build arg / chart value.
- Non-root, read-only root FS, writable `/tmp` emptyDir.

### API (internal only)

`POST /v1/exec`
```json
{ "args": ["-q", "--no-warnings", "-f", "bestaudio", "-J", "https://youtu.be/..."] }
```
→
```json
{ "exitCode": 0, "stdout": "...", "stderr": "..." }
```
- Server appends enforced args:
  - `--extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416"`
  - `--cookies /secrets/cookies.txt` only if that file exists.
- **Arg allowlist**, reject anything else with 400: `-q`, `--quiet`, `--no-warnings`, `--flat-playlist`, `--skip-download`, `-J`, `--dump-single-json`, `-f/--format <fmt>`, `--playlist-end <n>`, `--playlist-items <spec>`, `--default-search <x>`, `--extractor-args <youtube:...>` (only `youtube:` namespace), and one positional URL or `ytsearchN:`/`ytmsearchN:` query. Explicitly reject `--exec`, `-o`, `--output`, `--config-location`, `--plugin-dirs`, `--cookies*`, `--load-info-json`, `-a/--batch-file`, any `--*-command`.
- **VERIFY** the exact args LavaSrc sends by reading the yt-dlp source manager classes in LavaSrc 4.8.x; the allowlist must cover them plus our configured `customLoadArgs`/`customPlaybackArgs`.
- Timeout 30 s per call. Concurrency semaphore (default 8 per pod).

`GET /healthz`, `GET /readyz` (yt-dlp importable + POT sidecar `/ping` OK), `GET /v1/version` (yt-dlp, plugin, Deno versions), `GET /metrics` (Prometheus: requests by outcome, latency, yt-dlp exit codes).

Structured JSON logs. Never log cookie contents.

### Sidecar
`brainicism/bgutil-ytdlp-pot-provider:<pinned>` on `127.0.0.1:4416`. **VERIFY** latest version and matching pip plugin version.

### Updates
No scheduled rebuilds. yt-dlp, the EJS package, Deno, and bgutil are pinned; Dependabot/Renovate opens PRs for new versions and the owner merges and releases when needed (e.g. when YouTube breaks the current version).

---

## 6. Lavalink image (`images/lavalink`)

### Base
`ghcr.io/lavalink-devs/lavalink:4.2.x` **glibc variant, not alpine** (DAVE needs glibc ≥ 2.35). **VERIFY** latest 4.2.x tag.

### Plugins (baked into the image)
- `com.github.topi314.lavasrc:lavasrc-plugin:4.8.3` (includes Spotify `/items` fix needed for newly created Spotify apps). **VERIFY** latest.
- `dev.lavalink.youtube:youtube-plugin:<pinned>` — baked in but only enabled when `youtube.backend=plugin`. **VERIFY** latest release vs. snapshot; pin via chart value so a snapshot hash can be dropped in without an image rebuild if needed (see note below).
- Jars go in the plugins dir at build time so pods need no Maven access at runtime. **VERIFY** how Lavalink handles pre-placed jars vs `plugins:` dependency entries to avoid double-loading. If youtube-plugin version needs to be overridable at runtime, use a `lavalink.plugins` dependency entry driven by a chart value instead of baking it, and allow egress to `maven.lavalink.dev`.

### Shim (`images/lavalink/shim`)
- Go, `CGO_ENABLED=0`, installed at `/usr/local/bin/yt-dlp`.
- Reads `RESOLVER_URL` (default `http://<release>-resolver:8080`), POSTs `{"args": os.Args[1:]}` to `/v1/exec`, writes stdout/stderr, exits with `exitCode`. Network error → stderr message, exit 1. Timeout 35 s.
- **VERIFY by reading LavaSrc source** that the yt-dlp source (a) only invokes the binary with args, (b) parses JSON from stdout, (c) for playback takes the media URL from the JSON and Lavaplayer fetches it over HTTP rather than piping media through stdout. **If (c) is false, stop and report.**
- googlevideo URLs are IP-bound. All pods egress via the same home public IP, so this works. Do not route resolver or Lavalink through a VPN/egress gateway.

### Config
`application.yml` rendered by the Helm chart into a ConfigMap; secrets referenced as `${ENV_VAR}` (Spring Boot resolves them). Common content:

```yaml
server:
  port: 2333
  address: 0.0.0.0
lavalink:
  server:
    password: "${LAVALINK_PASSWORD}"
    sources:
      youtube: false        # deprecated built-in source, always off
      bandcamp: true
      soundcloud: true
      twitch: true
      vimeo: false
      http: true            # direct URLs + AzuraCast
      local: false
    filters:
      volume: true
      equalizer: true
      karaoke: true
      timescale: true
      tremolo: true
      vibrato: true
      distortion: true
      rotation: true
      channelMix: true
      lowPass: true
    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    trackStuckThresholdMs: 10000
    playerUpdateInterval: 5
    resamplingQuality: LOW
plugins:
  lavasrc:
    providers:
      - 'ytsearch:"%ISRC%"'
      - 'ytsearch:%QUERY%'
      - 'scsearch:%QUERY%'
    sources:
      spotify: true
      applemusic: true
      ytdlp: {{ eq .Values.youtube.backend "ytdlp" }}
      youtube: false
      deezer: false
    spotify:
      clientId: "${SPOTIFY_CLIENT_ID}"
      clientSecret: "${SPOTIFY_CLIENT_SECRET}"
      countryCode: "US"
      playlistLoadLimit: 6
      albumLoadLimit: 6
    applemusic:
      countryCode: "US"
      mediaAPIToken: "${APPLE_MUSIC_MEDIA_API_TOKEN}"
      playlistLoadLimit: 6
      albumLoadLimit: 6
    ytdlp:
      path: "/usr/local/bin/yt-dlp"
      searchLimit: 10
      mixPlaylistLoadLimit: 25
      playlistLoadLimit: 500
  youtube:                  # youtube-source plugin; enabled only for backend=plugin
    enabled: {{ eq .Values.youtube.backend "plugin" }}
    allowSearch: true
    # clients, remoteCipher, oauth, pot → fill from youtube-source README (VERIFY keys)
metrics:
  prometheus:
    enabled: true
    endpoint: /metrics
```

**VERIFY**:
- With backend `ytdlp`, the `ytsearch:` prefix used by mirroring providers routes to the yt-dlp source.
- With backend `plugin`, the youtube-source plugin config keys for remote cipher (`yt-cipher` URL + password), OAuth refresh token, and PO token, and the recommended client list.

---

## 7. Bot (`apps/bot`)

### Stack
- Node 24 LTS, TypeScript strict, ESM.
- `discord.js` v14 (latest).
- **`lavalink-client`** (Tomato6966). **VERIFY** it supports Lavalink 4.2 voice state `channelId` (required for DAVE). If not, use the most current client that does and note it.
- **Drizzle ORM** + `postgres` (postgres.js) driver; drizzle-kit migrations run at startup (advisory lock so it's safe).
- **Fastify** for web API + static SPA + `/healthz` `/readyz` `/metrics` on port 8080.
- `pino` logs, `prom-client` metrics, `zod` env validation.
- Image: multi-stage `node:24-slim`, builds `apps/web` and copies `dist` into the bot image. Non-root.

### Intents
`Guilds`, `GuildVoiceStates` only. Slash commands only.

### Configuration
**Env (set by chart) — secrets and in-cluster wiring only:**
| Var | Purpose |
|---|---|
| `DISCORD_TOKEN` | secret (AKV) |
| `LAVALINK_HOST`/`PORT` | in-cluster Service |
| `LAVALINK_PASSWORD` | secret (AKV) |
| `DATABASE_URL` | from the CNPG app secret |
| `WEB_SESSION_SECRET` | secret (AKV), signs session cookies |

Application ID comes from the logged-in client (`client.application.id`), not env.

**Runtime settings (`app_settings` table, edited via `/admin config`):**
| Key | Default | Purpose |
|---|---|---|
| `panel_base_url` | unset | e.g. `https://celeste.example.com`. Until set, no panel button is posted. |
| `idle_disconnect_seconds` | 300 | |
| `default_volume` | 80 | |
| `max_queue_length` | 500 | |
| `history_retention_days` | 90 | |

Settings are cached in memory and reloaded on change. Validate every key/value with a zod schema; unknown keys rejected.

### Data model (Postgres, Drizzle)
- `app_settings` — key PK, value jsonb, updated_by, updated_at.
- `admins` — user_id PK, added_by, added_at. (Application owner(s) are always admins and are not stored.)
- `radio_sources` — id, base_url (unique), label, enabled, added_by, added_at. Each row is one AzuraCast instance (§8).
- `guilds` — id, allowed (bool), added_by, added_at.
- `guild_settings` — guild_id PK, volume, dj_role_id, delete_old_np (bool), last_text_channel_id, last_voice_channel_id, default_filter.
- `queue_items` — id, guild_id, position (int, gap-friendly or reindexed on move), encoded_track (text), info (jsonb: title, author, uri, artworkUrl, source, isStream, duration, original mirrored metadata), requester_id, added_at. Index (guild_id, position).
- `player_state` — guild_id PK, current_item_id, position_ms, paused, loop_mode, filter, updated_at. Updated at most every 5 s from `playerUpdate`.
- `lavalink_session` — single row: session_id, updated_at.
- `play_history` — id, guild_id, track info jsonb, requester_id, started_at. Retention from `history_retention_days` (daily in-process cleanup job).
- `playlists` / `playlist_items` — user-owned saved playlists (v1.1, schema now, commands later).
- `web_sessions` — id PK, token_hash (unique), guild_id, voice_channel_id, started_by, created_at, ended_at. See §9.

Implement `lavalink-client`'s queue store interface against `queue_items` + `player_state`. **VERIFY** the store interface shape; if it expects a KV-style get/set of a serialized queue, implement it as a JSONB row per guild instead of normalized rows and keep `queue_items` only if it fits.

### Access control
1. Developer portal: **Public Bot = off** (manual step, in README).
2. On `guildCreate` and on `ready`: leave any guild where `guilds.allowed` is not true; log it.
3. **Owner discovery:** on `ready`, `client.application.fetch()`; owner = `application.owner` (a user), or if the app belongs to a Team, all team members with an admin/developer role (**VERIFY** current team role model in discord.js/Discord API). Re-fetch hourly. Owners plus `admins` rows are "admins".
4. **`/admin` lives in the bot's DMs**, not in any guild: register `/admin` globally with interaction context **Bot DM only** and installation type guild install (**VERIFY** discord.js API for `setContexts(InteractionContextType.BotDM)` / `setIntegrationTypes`). Every handler re-checks the caller is an admin. Non-admins get "not authorized".
   - `/admin guild-allow <guild_id>`, `/admin guild-deny <guild_id>` (also leaves), `/admin guild-list`
   - `/admin invite-link <guild_id>` → allows the guild, then returns an OAuth2 URL with `bot applications.commands` scopes, minimal permissions (View Channel, Send Messages, Embed Links, Connect, Speak, Use Voice Activity), and `guild_id` + `disable_guild_select=true` so it can only be added to that guild.
   - `/admin admin-add <user>`, `/admin admin-remove <user>`, `/admin admin-list` (owners only for add/remove).
   - `/admin config list`, `/admin config get <key>`, `/admin config set <key> <value>`, `/admin config reset <key>` (keys autocomplete from the settings schema).
   - `/admin radio add <base_url> [label]` (validates by calling `/api/stations`), `/admin radio remove <source>`, `/admin radio list`, `/admin radio refresh`.
   - `/admin web-revoke-all` → end all active web sessions' links (playback continues; new links issued on next NP embed).
   - `/admin status` → versions (bot, Lavalink, plugins, resolver yt-dlp), active players, YouTube backend in use, recent source failure counts.
5. **First boot with an empty DB:** no guilds are allowed, so the bot leaves any guild it's in. The owner DMs the bot (DM is possible because the owner shares no guild requirement for app commands in bot DMs — **VERIFY**; if a shared guild is required, allow the owner's first guild automatically on `ready` when `guilds` is empty and log it) and runs `/admin invite-link`.
6. Optional per-guild **DJ role**: `/settings dj-role <role|none>` (requires Manage Guild). DJ or Manage Guild bypasses vote-skip and can use destructive commands (`/stop`, `/clear`, `/remove`, `/move`, `/filter`, `/volume`).
7. Set sensible `default_member_permissions` on `/settings`.

### Commands (global, guild context; `/admin` is DM-only)
| Command | Behavior |
|---|---|
| `/play <query>` | URL or search. Autocomplete: YouTube by default; prefixes `sc:` `sp:` `am:` search SoundCloud/Spotify/Apple. Joins caller's channel. Playlists/albums enqueue all up to `max_queue_length`. Remembers text channel. An AzuraCast listen URL or station page URL from a known source is treated as `/radio`. |
| `/playnext <query>` | Insert at front. |
| `/radio <station>` | Autocomplete across all enabled AzuraCast sources. §8. |
| `/pause`, `/resume` | |
| `/skip` | Instant for track requester, DJ, Manage Guild, or a user alone with the bot. Otherwise acts as `/voteskip`. |
| `/voteskip` | Needed = `ceil(listeners * 0.5)`, listeners = non-bot, non-deafened members in the bot's channel. Votes reset on track change. Voter must be in channel. Reply shows `x/y`. |
| `/stop` | Clear queue, stop, disconnect. |
| `/queue [page]` | Paginated embed with buttons. |
| `/nowplaying` | Current track embed with progress bar. |
| `/seek <time>` | `mm:ss` or seconds; rejected for streams. |
| `/volume <0-150>` | Per-guild, persisted. |
| `/filter <preset>` | `off`, `bassboost`, `nightcore`, `vaporwave`, `8d`, `karaoke`, `soft`, `treble`. Presets in one module shared with the web panel. |
| `/loop <off|track|queue>`, `/shuffle` | |
| `/remove <pos>`, `/move <from> <to>`, `/clear` | |
| `/disconnect` | |
| `/web` | Rotate the current session's panel link (§9). The link itself is posted automatically. |

Ephemeral replies for errors; public for state changes. Any playback-mutating command requires the caller to be in the bot's voice channel.

### Now-playing embeds
- On `trackStart`: post a new embed to the remembered text channel; delete the previous NP message if `delete_old_np` (default on).
- Fields: title (linked), artist, source, duration or LIVE, requester, artwork, queue length, volume, filter, loop.
- Buttons: ⏯ ⏭ ⏹ 🔁 🔀 (same permission/vote rules as commands).
- Mirrored tracks show the original platform's metadata and artwork, not the YouTube match.

### Persistence and resume
- Enable Lavalink **session resuming** (timeout 120 s). Store session id in `lavalink_session`. Bot restart → reconnect with stored session; players keep playing.
- Lavalink restart → on reconnect, for each guild with a non-empty queue and a remembered voice channel, rejoin and resume the current track from the last persisted position.

### Lifecycle
- Leave voice after `idle_disconnect_seconds` with an empty queue, or when no non-bot members remain for that long.
- `trackException`/`trackStuck`: log, short notice, skip. Three consecutive failures from the same source → stop and post a "source problem" notice naming the source (signals YouTube breakage → check resolver or switch backend).
- SIGTERM: stop accepting commands, flush state, close gateway. **Do not destroy Lavalink players.**

### Health and metrics
- `/healthz` process alive; `/readyz` gateway READY + Lavalink connected + DB reachable.
- Metrics: commands by name/outcome, active players, queue sizes, track failures by source, web sessions active.

---

## 8. AzuraCast integration

Works with any AzuraCast instance. Admins register instances with `/admin radio add <base_url>`; there is no AzuraCast config in Helm or env. **VERIFY** endpoints and auth requirements against the AzuraCast API docs (served at `<base_url>/api` on any instance).

- Stations: `GET <base_url>/api/stations` (public on default installs) → name, shortcode, listen URL, mounts. Cache per source for 10 minutes; `/admin radio refresh` clears it.
- Station identity in the bot: `<source_id>:<shortcode>`. Autocomplete label: `Station Name — <source label or host>`.
- Now playing: `GET <base_url>/api/nowplaying/<shortcode>`. Prefer the instance's real-time now-playing feed (SSE/WebSocket) when available; otherwise poll every 15 s **only while some guild is playing that station**. One poller/subscription per station shared across guilds.
- `/radio` loads the station's listen URL via Lavalink HTTP source; queue item marked stream (no seek, LIVE).
- During radio playback, **edit** the NP embed in place on song change (title, artist, art from AzuraCast, plus station name and listener count).
- No API keys in v1 (only public endpoints are used). If a source returns 401/403, `/admin radio add` reports it and refuses to add.

---

## 9. Web control panel

### Access model: one link per playback session, generated automatically
- A **playback session** starts when the bot joins a voice channel in a guild and ends when it leaves (stop, disconnect, idle timeout, kicked).
- On session start the bot creates a `web_sessions` row: random 32-byte base64url token (store only its SHA-256), guild_id, voice_channel_id, started_by user_id, created_at, ended_at null.
- The panel URL `<panel_base_url>/s/<token>` (from `app_settings`; if unset, no button and the panel is unused) is included automatically as a **link button ("Open web panel") on every now-playing embed** for that session. No command needed.
- Anyone with the link controls that guild's player while the session lives. Visiting the link sets an HttpOnly, Secure, SameSite=Lax signed cookie bound to the session id and redirects to `/player`.
- When the session ends: set `ended_at`, close SSE streams for it, and the link and cookies stop working immediately. The next session gets a new link.
- `/web` is still registered but only to **rotate** the link mid-session (DJ/Manage Guild/session starter only): invalidates the current token, issues a new one, edits the current NP embed's button.
- Every API call and SSE connection re-checks: session active, guild still allowed.
- Permissions from the web: full playback control (play, skip without vote, seek, volume, filters, queue editing, stop). No access to `/settings` or `/admin` equivalents. Every web action is attributed in history/logs as `web:<session_id>` and posts a short notice in the text channel for destructive actions (stop, clear, skip) so the channel sees who-ish did what.
- One hostname for everything. No Discord OAuth.
- Tradeoff, accepted by owner: the link is a bearer credential visible to everyone who can read the text channel. Exposure is bounded by the session lifetime and `/web` rotation.
- Schema change from §7: drop `web_links`; `web_sessions` becomes `id, token_hash, guild_id, voice_channel_id, started_by, created_at, ended_at`.

### API (Fastify, JSON, under `/api`)
- `GET /api/session` — guild name/icon, voice channel, session start time.
- `GET /api/player` — current track, position, paused, volume, filter, loop, voice channel.
- `GET /api/queue`
- `POST /api/play` {query}, `POST /api/playnext` {query}
- `POST /api/control` {action: pause|resume|skip|voteskip|stop|shuffle|loop, value?}
- `POST /api/seek` {ms}, `POST /api/volume` {value}, `POST /api/filter` {preset}
- `POST /api/queue/move` {from,to}, `DELETE /api/queue/:id`, `DELETE /api/queue`
- `GET /api/search?q=&source=` — mirrors `/play` autocomplete
- `GET /api/radio/stations` (all enabled sources), `POST /api/radio` {stationId: `<source_id>:<shortcode>`}
- `GET /api/history?page=`
- `GET /api/events` — **SSE** stream of player/queue/track events for the session's guild.

Validate all bodies with zod. Rate-limit mutating endpoints per session (e.g. 10/s burst, 60/min). CSRF: SameSite cookie + require `Content-Type: application/json` + check `Origin` against `panel_base_url`.

### SPA (`apps/web`)
- React + Mantine (latest), Vite, TypeScript.
- Pages: now playing (artwork, progress bar with seek, transport controls, volume slider, filter picker, loop/shuffle), queue (drag-to-reorder, remove, clear), search/add (source tabs), radio (station grid with live now-playing), history.
- Live updates via `/api/events`. Mobile-first layout.
- Ended/invalid session → page saying the session is over; a new link appears in Discord when music starts again.

### Exposure
- Cloudflare Tunnel → `http://<release>-bot:8080`. Chart can deploy `cloudflared` (token from AKV) or the owner points an existing tunnel at the Service (**ASK OWNER**).
- Optional Cloudflare Access in front is **not** used by default (it would add a second login).
- Only `/auth/*`, `/api/*`, and static assets are served on 8080 publicly. Put `/metrics`, `/healthz`, `/readyz` on a **separate port 9090** not routed by the tunnel.

---

## 10. Helm chart (`charts/celeste`)

Single chart deploying the whole stack. No third-party subcharts (no Bitnami).

### Prerequisites (documented, not installed by the chart)
- **CloudNativePG operator** (**ASK OWNER** whether installed; if not, README gives the install step).
- **External Secrets Operator** with an Azure Key Vault `ClusterSecretStore`.

### Templates
- `bot` Deployment (replicas 1, `strategy: Recreate`), Service (8080 web, 9090 metrics).
- `lavalink` Deployment (replicas 1, Recreate), Service 2333, ConfigMap `application.yml` rendered per `youtube.backend`.
- `resolver` Deployment (replicas 2, RollingUpdate) + bgutil sidecar, Service 8080. Rendered only when `youtube.backend=ytdlp`.
- `yt-cipher` Deployment + Service. Rendered only when `youtube.backend=plugin` and `ytCipher.enabled`. **VERIFY** image and config from the yt-cipher repo (kikkia/yt-cipher).
- `postgresql.cnpg.io/v1` `Cluster`: 1 instance (Longhorn already replicates the volume), 5Gi, storageClass from values. App DB/user `celeste`; bot reads `DATABASE_URL` from the CNPG-generated `<cluster>-app` secret (`uri` key). No CNPG-native backups.
- **k8up integration** (`postgres.k8up.enabled`, default true). The owner's existing k8up `Schedule`/repository does the backing up; the chart only makes it consistent:
  - Copying a live PGDATA directory file-by-file is **not** a consistent backup. So the chart uses k8up's application-aware backup: a pod annotation on the CNPG instance pods (via `Cluster.spec.inheritedMetadata.annotations`) telling k8up to run `pg_dump` inside the pod and stream it into the backup (annotation names like `k8up.io/backupcommand` and `k8up.io/file-extension` — **VERIFY** exact annotations and container-selection behavior in current k8up docs).
  - Dump command: `pg_dump --clean --if-exists -Fc celeste` as the `postgres` user, run in the `postgres` container. **VERIFY** how CNPG pods authenticate locally (peer auth for `postgres` user inside the instance pod is expected).
  - Exclude the Postgres PVC from k8up's file-level PVC backup with the opt-out annotation (**VERIFY** name, e.g. `k8up.io/backup: "false"`) so only the dump is backed up.
  - README documents restore: create the cluster empty, `pg_restore` the dump.
  - Running only one instance means the backup command always hits the primary.
- `cloudflared` Deployment (optional, `cloudflared.enabled`), token from AKV.
- `ExternalSecret`s (API version **VERIFY** against installed ESO, likely `external-secrets.io/v1`).
- `NetworkPolicy`:
  - lavalink ingress only from bot (2333).
  - resolver ingress only from lavalink (8080).
  - yt-cipher ingress only from lavalink.
  - postgres ingress only from bot + CNPG operator namespace (**VERIFY** required operator → instance ports).
  - bot 8080 ingress only from cloudflared pods (or the owner's tunnel namespace via value); 9090 from monitoring namespace.
  - Egress allow-all.
- Optional `ServiceMonitor`s (`metrics.serviceMonitor.enabled`).
- `imagePullSecrets` from an ExternalSecret producing a `kubernetes.io/dockerconfigjson` secret for GHCR — **only when `image.pullSecret.enabled`** (off by default; repo and packages are public).

### Resources (defaults)
| | requests | limits |
|---|---|---|
| bot | 50m / 192Mi | mem 512Mi |
| lavalink | 250m / 768Mi (`-Xmx768m`) | mem 1Gi |
| resolver | 100m / 256Mi | mem 1Gi |
| bgutil | 50m / 128Mi | mem 512Mi |
| postgres | 100m / 256Mi | mem 1Gi |

**No CPU limits on any component** (CFS throttling causes audible stutter on Lavalink and slow extraction on resolver).

### Key values
```yaml
image:
  registry: ghcr.io/<owner>          # ASK OWNER
  tag: ""                            # defaults to chart appVersion
  pullSecret:
    enabled: false                   # public packages; enable if repo goes private
    akvSecretName: celeste-ghcr-pull   # dockerconfigjson content

youtube:
  backend: ytdlp                     # ytdlp | plugin
  plugin:
    version: "1.18.2"                # or snapshot commit hash
    oauth:
      enabled: false
    poToken:
      enabled: false
ytCipher:
  enabled: true

resolver:
  replicas: 2
  cookies:
    enabled: false                   # mounts AKV celeste-ytdlp-cookies
  bgutilVersion: "<pinned>"

# No bot/runtime config here: owners, guilds, panel URL, defaults and
# radio sources are all set at runtime via /admin and stored in Postgres.

postgres:
  instances: 1
  storage:
    size: 5Gi
    storageClass: longhorn           # ASK OWNER
  k8up:
    enabled: true                    # pg_dump via k8up backup annotation; PVC excluded

cloudflared:
  enabled: false

externalSecrets:
  storeName: azure-keyvault          # ASK OWNER
  storeKind: ClusterSecretStore

networkPolicy:
  enabled: true
  tunnelNamespace: ""                # set if using an existing cloudflared elsewhere

metrics:
  serviceMonitor:
    enabled: false
```

### AKV secret names
| Purpose | AKV secret |
|---|---|
| Discord bot token | `celeste-discord-token` |
| Lavalink password | `celeste-lavalink-password` |
| Spotify client id / secret | `celeste-spotify-client-id`, `celeste-spotify-client-secret` |
| Apple Music media API token | `celeste-applemusic-token` |
| Web session signing secret | `celeste-web-session-secret` |
| GHCR pull secret (dockerconfigjson, only if pullSecret enabled) | `celeste-ghcr-pull` |
| yt-dlp cookies (optional) | `celeste-ytdlp-cookies` |
| youtube-source OAuth refresh token (optional) | `celeste-yt-oauth-refresh-token` |
| yt-cipher password (optional) | `celeste-ytcipher-password` |
| Cloudflare tunnel token (optional) | `celeste-cloudflared-token` |

The ExternalSecret manifests in the public repos only contain these key names, never values.

Postgres credentials are generated by CNPG, not stored in AKV.

---

## 11. GitHub Actions

Runners: **GitHub-hosted `ubuntu-latest` only** (public repo; free minutes; self-hosted runners are unsafe on public repos).

GHCR: packages pushed from this repo must be set to **public** visibility. **VERIFY** whether GHCR packages inherit visibility from a public repo or need to be flipped once in package settings; document the step in README.

Security for a public repo:
- `permissions:` set per job (`contents: read`, `packages: write` only where pushing).
- Third-party actions pinned to commit SHAs; Dependabot or Renovate for action/base-image bumps.
- No secrets needed for build/test. Publishing jobs run only on `push` to `main` or tags, never on PRs.
- Enable GitHub secret scanning and push protection on the repo.

Workflows (path-filtered):
- `bot.yml` — pnpm install, lint, typecheck, test (bot + web), build image `ghcr.io/<owner>/celeste`, push.
- `resolver.yml` — ruff, pytest, build `celeste-resolver`, push. No schedule.
- `lavalink.yml` — `go test` shim, build `celeste-lavalink`, push.
- `chart.yml` — `helm lint`, `helm template` against both backends with kubeconform, then on tag `chart-v*` package and push to `oci://ghcr.io/<owner>/charts`.
- `release.yml` — on tag `v*`: build all images with the version tag, bump chart `appVersion`, publish chart.

All images: buildx, `linux/amd64` only, OCI labels, SBOM + provenance attestations, base images pinned by digest. Image tags: semver on release, `sha-<short>` on main.

Dependabot (or Renovate) config covers: GitHub Actions, npm (pnpm), pip (resolver incl. yt-dlp and bgutil), Go modules (shim), Docker base images. Updates land as PRs; nothing auto-deploys.

### Deployment
- This repo provides `deploy/argocd/application.example.yaml` and `charts/celeste/values-example.yaml`.
- The owner's real ArgoCD `Application` and values live in their (public) GitOps repo and contain only infrastructure values (§3.12). **ASK OWNER** for its layout conventions.
- Releases are manual: tag `v*` → images + chart published → owner bumps the chart version in the GitOps repo.

---

## 12. Build order (milestones)

1. **Scaffold**: monorepo, pnpm workspace, lint/format, Dependabot config, README with manual steps (Discord app, Public Bot off, AKV secrets, CNPG/ESO/k8up prerequisites, first-boot flow: DM the bot `/admin invite-link`).
2. **YouTube bake-off** (decides default backend):
   - Build resolver image and Lavalink image with both backends.
   - `tools/yt-bakeoff`: fixed list of ~25 YouTube inputs (popular music video, auto-generated "Topic" track, age-restricted, live stream, playlist, YouTube Music URL, ytsearch queries, a few Spotify/Apple tracks to test mirroring). For each backend: load result, time to first audio byte, and 3-minute playback without error (Lavalink REST + a test guild).
   - Output a markdown table. Set chart default `youtube.backend` to the winner; document the result in README.
3. **Resolver**: API, allowlist, POT wiring, tests. Acceptance: `POST /v1/exec` with `-J <youtube url>` returns JSON containing a playable audio URL.
4. **Lavalink image**: shim, plugins, config. Acceptance: `GET /v4/loadtracks?identifier=ytsearch:<query>` returns tracks via the active backend; a Spotify track loads and mirrors.
5. **Helm chart**: all templates, both backends render and pass kubeconform. Acceptance: ArgoCD sync → all pods Ready; NetworkPolicy blocks resolver from a test pod; a k8up backup of the namespace contains a pg_dump file and no raw PGDATA.
6. **Bot core**: DB schema + migrations, owner discovery, DM `/admin` (guild-allow, invite-link, config), allowlist, `/play` `/skip` `/stop` `/queue`, NP embed. Acceptance: from an empty DB, owner DMs the bot, gets an invite link, adds it to a guild, and plays a YouTube URL in voice (DAVE handshake succeeds).
7. **Bot full commands**: vote-skip, filters, volume, loop, shuffle, seek, queue editing, buttons, DJ role, settings, remaining `/admin` subcommands.
8. **Persistence/resume**: Acceptance: `kubectl rollout restart deploy/<bot>` mid-track → audio continues, queue intact. Lavalink restart → bot rejoins and resumes near last position.
9. **Sources**: SoundCloud, Twitch live, direct HTTP (mp3; HLS if supported), Spotify track/album/playlist, Apple Music track/album/playlist.
10. **AzuraCast**: `/admin radio add`, `/radio` across multiple instances, live NP edits. Acceptance: two different public AzuraCast instances added; stations from both autocomplete and play.
11. **Web panel**: auto-generated session links on NP embeds, `/web` rotation, API, SSE, SPA, cloudflared. Acceptance: link appears on the first NP embed without any command; control playback from a phone; link stops working the moment the bot leaves voice; rotated link invalidates the old one.
12. **Hardening**: metrics/ServiceMonitors, failure notices, idle disconnect, history retention job, docs.

---

## 13. Known risks and fallbacks

| Risk | Mitigation |
|---|---|
| Active YouTube backend breaks | Switch `youtube.backend` in values and sync. Bot's "source problem" notice, `/admin status`, and metrics surface it. For yt-dlp: merge the Dependabot bump (or bump the pin) and release. For the plugin: it's a chart value, so a snapshot hash can be dropped in. |
| YouTube bot checks | Start anonymous + PO tokens. Escalate to cookies (ytdlp) or OAuth (plugin) from a **burner** Google account. Never the owner's main account. |
| LavaSrc yt-dlp source pipes media through stdout | Stop and report. Fallback: install yt-dlp directly in the Lavalink image (breaks the separate-pod requirement; owner decides). |
| Spotify-generated playlists fail | Need anonymous token endpoint (`customTokenEndpoint`, e.g. self-hosted spotify-tokener). Out of scope for v1; documented. |
| Apple Music token expires | Scraped token; rotate in AKV. Long-term: MusicKit key (Apple Developer account). |
| Wrong mirror match | ISRC first, then text search. Log matches where duration differs > 15 s. |
| Web panel link leaked | Link dies when the playback session ends; `/web` rotates it mid-session; `/admin web-revoke-all`; destructive web actions are announced in the text channel. |
| Public repos leak environment details | Code repo and GitOps repo are both public, so no IDs, hostnames, or radio URLs go in either; runtime config lives in Postgres. Secret scanning + push protection on. |
| Postgres data loss | k8up backs up a pg_dump (not raw PGDATA). Restore procedure in README; test it once after milestone 5. |
| Fork PR abuses CI | GitHub-hosted runners only, no secrets on PR workflows, no `pull_request_target`. |
| ToS | Bot stays invite-only. Repo is public but unpromoted; flip to private (and enable `image.pullSecret`) if it draws attention. |

---

## 14. Open items for the owner

- GHCR owner/org name.
- GitOps repo layout conventions for the ArgoCD `Application`.
- CloudNativePG installed? Longhorn storage class to use.
- `ClusterSecretStore` name for Azure Key Vault.
- New cloudflared in the chart or an existing tunnel.
- Spotify developer app credentials and Apple Music token loaded into AKV.

Everything else (owners, guilds, panel URL, radio sources, defaults) is set at runtime via `/admin` after deploy.
