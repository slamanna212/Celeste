# celeste-resolver

Internal HTTP service that runs `yt-dlp` on behalf of the Lavalink pod. Lavalink's LavaSrc yt-dlp source calls a tiny shim binary (`/usr/local/bin/yt-dlp`) that POSTs its argv here, so all YouTube extraction (EJS challenges via Deno, PO tokens via the bgutil sidecar, cookies) happens in one hardened pod. Never expose it outside the cluster: it executes (allowlisted) yt-dlp invocations.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `POT_BASE_URL` | `http://127.0.0.1:4416` | bgutil sidecar; also passed to yt-dlp as `youtubepot-bgutilhttp:base_url` |
| `COOKIES_PATH` | `/secrets/cookies.txt` | `--cookies` is added only if this file exists |
| `EXEC_TIMEOUT_SECONDS` | `30` | per-call timeout; process group killed, exitCode 124 |
| `MAX_CONCURRENCY` | `8` | concurrent yt-dlp processes |
| `PORT` | `8080` | listen port |
| `ALLOWED_URL_HOSTS` | `youtube.com,youtu.be` | hosts (and subdomains) a positional URL may use; `*` = any (SSRF guard) |
| `LOG_LEVEL` | `info` | |
| `PLAYBACK_FALLBACK_CLIENTS` | `default,mweb` | for playback calls (`-f ... -J <url>`), 1-byte-fetch the returned googlevideo URL; on non-2xx re-run with these `player_client`s in order within the `EXEC_TIMEOUT_SECONDS` budget. Empty = off |
| `YTDLP_COMMAND` | `python -m yt_dlp` | override (tests) |

## API
- `POST /v1/exec` `{"args": [...]}` -> `{"exitCode", "stdout", "stderr"}`. 400 `{"error"}` if args violate the allowlist.
- `GET /healthz`, `GET /readyz` (yt-dlp importable and POT `/ping` OK, else 503), `GET /v1/version`, `GET /metrics`.

### Allowlist
Booleans: `-q --quiet --no-warnings --flat-playlist --skip-download -J --dump-single-json`. With value (space or `--flag=value`): `-f/--format`, `--playlist-end <n>`, `--playlist-items <1:25>`, `--default-search`, `--extractor-args youtube:...`. Exactly one positional: `http(s)` URL on an allowed host, or `ytsearchN:` / `ytmsearchN:`. Everything else (e.g. `--exec`, `-o`, `--cookies*`, `--config-location`, `--plugin-dirs`, `-a`, `--*-command`) is rejected. Server adds `--ignore-config`, the POT extractor arg, and cookies.

## Local run
```
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest
# needs deno on PATH and a bgutil sidecar (docker run -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider:2.0.2)
.venv/bin/python -m resolver.main
```

## Docker
```
docker build -t celeste-resolver:dev --build-arg BGUTIL_VERSION=2.0.2 .
```
`BGUTIL_VERSION` (default `2.0.2`) must equal the Helm chart's `resolver.bgutilVersion`, which is also the sidecar image tag. Runs as uid 10001, read-only root FS OK (only `/tmp` needs to be writable; HOME, XDG cache and DENO_DIR live there).
