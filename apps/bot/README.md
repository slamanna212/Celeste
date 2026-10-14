# @celeste/bot

Discord bot + web panel API for Celeste (spec sections 7-9). Node 22, TypeScript (strict, ESM), discord.js 14, lavalink-client, Drizzle + postgres.js, Fastify, pino, prom-client, zod.

## Dev setup

```sh
pnpm install
pnpm --filter @celeste/shared build
cp .env.example .env   # or export the variables below
pnpm --filter @celeste/bot dev        # tsx watch
pnpm --filter @celeste/bot test       # vitest (pure logic; no Discord/Lavalink/DB needed)
pnpm --filter @celeste/bot typecheck && pnpm --filter @celeste/bot build
pnpm --filter @celeste/bot db:generate   # after editing src/db/schema.ts; commit apps/bot/drizzle
```

You need Postgres and a Lavalink 4.2.x node (see `images/lavalink`). Migrations in `drizzle/` are applied at startup under a Postgres advisory lock.

Discord developer portal: set **Public Bot = off**, enable no privileged intents (only Guilds + GuildVoiceStates are used).

First boot: DM the bot and run `/admin invite-link <guild_id>`; if the bot cannot be DMed (no shared server) it auto-allows the first guild that contains an owner when the allowlist has never been used.

## Environment

| Var                                                     | Default                                                                  | Notes                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `DISCORD_TOKEN`                                         | required                                                                 |                                                      |
| `LAVALINK_HOST` / `LAVALINK_PORT` / `LAVALINK_PASSWORD` | -, `2333`, required                                                      |                                                      |
| `DATABASE_URL`                                          | required                                                                 |                                                      |
| `WEB_SESSION_SECRET`                                    | required (>=16 chars)                                                    | signs the session cookie                             |
| `WEB_PORT`                                              | `8080`                                                                   | public: `/s/:token`, `/api/*`, SPA                   |
| `METRICS_PORT`                                          | `9090`                                                                   | `/healthz` `/readyz` `/metrics`                      |
| `YOUTUBE_BACKEND`                                       | `ytdlp`                                                                  | `ytdlp` or `plugin`; informational (`/admin status`) |
| `RESOLVER_URL`                                          | unset                                                                    | used by `/admin status` (`GET /v1/version`)          |
| `LOG_LEVEL`                                             | `info`                                                                   |                                                      |
| `WEB_STATIC_DIR`                                        | `../web/dist` relative to the bot package (dev); `/app/web` in the image | built SPA                                            |

Runtime settings (`/admin config`): `panel_base_url`, `idle_disconnect_seconds` (300), `default_volume` (80), `max_queue_length` (500), `history_retention_days` (90).

## Commands

Guild: `/play` `/playnext` `/radio` `/pause` `/resume` `/skip` `/voteskip` `/stop` `/queue` `/nowplaying` `/seek` `/volume` `/filter` `/loop` `/shuffle` `/remove` `/move` `/clear` `/disconnect` `/web` `/settings dj-role` `/settings delete-old-np`.

DM only (admins): `/admin guild-allow|guild-deny|guild-list|invite-link|admin-add|admin-remove|admin-list|web-revoke-all|status`, `/admin config list|get|set|reset`, `/admin radio add|remove|list|refresh`.

Permission notes: with no DJ role configured, destructive commands (`/stop /clear /remove /move /filter /volume`) are open to everyone in the bot's voice channel; once `/settings dj-role` is set they need the DJ role, Manage Server, or being alone with the bot.

## Docker

`docker build -f apps/bot/Dockerfile .` from the repo root (needs the root `.dockerignore`). The image is non-root, needs no writable paths, exposes 8080 and 9090.
