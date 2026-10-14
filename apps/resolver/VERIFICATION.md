# Verification log (2026-10-14)

## 1. yt-dlp and EJS
- Latest stable yt-dlp: **2026.8.19** (https://pypi.org/pypi/yt-dlp/json).
- EJS is a **separate PyPI package**, `yt-dlp-ejs`, pulled in by the `default` extra (`yt-dlp-ejs==0.8.0` in requires_dist of 2026.8.19). Latest on PyPI is 0.8.0 (https://pypi.org/pypi/yt-dlp-ejs/json). We pin it explicitly as well.
- yt-dlp also offers a `pin` extra that pins all its transitive deps; we install `yt-dlp[default,pin]`.
- JS runtime: **Deno** is "recommended" and enabled by default; minimum supported version **2.3.0** (https://github.com/yt-dlp/yt-dlp/wiki/EJS, https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/README.md). yt-dlp's `pin-deno` extra pins `deno==2.9.5`; we copy the Deno 2.9.5 binary from `denoland/deno:bin-2.9.5` (digest-pinned in Dockerfile). Latest Deno release is 2.9.7 (https://github.com/denoland/deno/releases); 2.9.5 chosen to match yt-dlp's tested pin and the bgutil sidecar's Deno base (`denoland/deno:debian-2.9.5`).
- Verified in the built image: `/v1/version` -> ytDlp 2026.8.19, ejs 0.8.0, deno 2.9.5.

## 2. bgutil
- Latest `bgutil-ytdlp-pot-provider` on PyPI: **2.0.2** (https://pypi.org/pypi/bgutil-ytdlp-pot-provider/json).
- Docker Hub `brainicism/bgutil-ytdlp-pot-provider:2.0.2` exists (node variant, = `latest`; `2.0.2-deno` is the Deno variant) (https://hub.docker.com/v2/repositories/brainicism/bgutil-ytdlp-pot-provider/tags). Same version as the plugin.
- Image listens on port **4416** with `--host 0.0.0.0` default CMD (server/Dockerfile in https://github.com/Brainicism/bgutil-ytdlp-pot-provider). It is unauthenticated: only expose it on pod localhost.
- Extractor arg: `--extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416"` (README, https://github.com/Brainicism/bgutil-ytdlp-pot-provider#readme).
- Ping endpoint: `GET /ping` -> `{"server_uptime": ..., "version": "2.0.2"}` (server/src/main.ts). The resolver surfaces this version as `potServer` in `/v1/version`.

## 3. LavaSrc 4.8.3 yt-dlp source (topi314/LavaSrc, tag 4.8.3, `main/.../lavasrc/ytdlp/`)
- `YtdlpAudioSourceManager`: binary invoked via `ProcessBuilder([path, ...args])` (args only; stderr merged into stdout via `redirectErrorStream(true)`); stdout parsed as JSON; non-zero exit -> exception.
- Defaults: `customLoadArgs = -q --no-warnings --flat-playlist --skip-download -J`; `customPlaybackArgs = -q --no-warnings -f bestaudio -J`.
- `getItem` appends `--playlist-items 1:<mixPlaylistLoadLimit>` if identifier contains `list=RD`, else `--playlist-items 1:<playlistLoadLimit>` if it contains `list=`; then the identifier as the single positional.
- Positional is either `ytsearch<searchLimit>:<query>` (from `ytsearch:` prefix) or a URL matching `https?://(www.|m.|music.)?youtube.com/...` or `https?://(www.)?youtu.be/...`. Not used: `ytmsearch`, `scsearch` (allowed anyway per spec for ytmsearch only).
- `YtdlpAudioTrack.process`: runs playback args + `trackInfo.uri`, reads `url`, `ext`, `filesize` from JSON, and Lavaplayer fetches `url` over HTTP (`YoutubePersistentHttpStream`). Media is NOT piped through stdout (check (c) true).
- `customLoadArgs`/`customPlaybackArgs` are user-configurable (`plugins.lavasrc.ytdlp.*`); the allowlist accepts only the flags listed in README.

## Smoke test
Built image + `brainicism/bgutil-ytdlp-pot-provider:2.0.2` on a docker network, resolver run with `--read-only --tmpfs /tmp --user 10001 --cap-drop ALL`: `/readyz` ready; `-J --flat-playlist ytsearch1:...` returned playlist JSON (exit 0, ~2.3 s); `-q --no-warnings -f bestaudio -J <watch url>` returned a googlevideo `url` (ext webm, filesize set), exit 0.
