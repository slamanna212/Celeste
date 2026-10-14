# Verification log (2026-10-14)

Everything here was read from source or observed in a running container. Consumed by the Helm chart.

## 1. LavaSrc yt-dlp source (tag 4.8.3)
Sources: https://github.com/topi314/LavaSrc/blob/4.8.3/main/src/main/java/com/github/topi314/lavasrc/ytdlp/YtdlpAudioSourceManager.java ,
`.../ytdlp/YtdlpAudioTrack.java`, `plugin/.../config/YtdlpConfig.java`, `plugin/.../LavaSrcPlugin.java`.

- (a) TRUE. `new ProcessBuilder([path] + args)`; only argv, no shell, no env, no stdin.
- (b) TRUE. Reads all of the process output as UTF-8, `waitFor()`, then `JsonBrowser.parse`.
- (c) TRUE. `YtdlpAudioTrack.process()` runs yt-dlp with playback args + track URI, reads `url` (media URL), `ext`, `filesize` from the JSON, then Lavaplayer streams it via `YoutubePersistentHttpStream` (HTTP) into Matroska (webm) or MPEG (m4a) decoders. Nothing is piped via stdout. Live streams: webm unsupported, mpeg only.
- **stderr is merged into stdout** (`processBuilder.redirectErrorStream(true)`). Any byte on stderr pollutes the JSON. Non-zero exit code -> `RuntimeException("Failed to retrieve item, error: " + output)`. Exit code is relied on. **The shim therefore prints resolver stderr only when exitCode != 0** (resolver's stderr is empty on success with `-q --no-warnings` anyway).
- Default args (used when customLoadArgs/customPlaybackArgs unset):
  - load/search/playlist: `-q --no-warnings --flat-playlist --skip-download -J <target>`
  - `--playlist-items 1:<N>` is inserted before the target if the identifier contains `list=` (N = `mixPlaylistLoadLimit` if it contains `list=RD`, else `playlistLoadLimit`)
  - search: target is `ytsearch<searchLimit>:<query>`
  - playback: `-q --no-warnings -f bestaudio -J <track uri>`
- Handled identifiers: prefix `ytsearch:` ONLY (not `ytmsearch:`), and URLs matching `https?://(www.|m.|music.|)youtube.com/.*` or `https?://(www.)?youtu.be/.*`. Source name reported as "youtube".
- Config keys (`plugins.lavasrc.ytdlp`): `path`, `searchLimit` (10), `mixPlaylistLoadLimit` (25), `playlistLoadLimit` (default 1000), `customLoadArgs` (string array), `customPlaybackArgs` (string array). Source enabled with `plugins.lavasrc.sources.ytdlp: true`.

## 2. ytsearch: routing (backend ytdlp)
Mirroring providers call `playerManager.loadItem("ytsearch:...")`; the only registered manager that handles `ytsearch:` is the LavaSrc ytdlp one (built-in youtube is off). Providers `ytsearch:"%ISRC%"`, `ytsearch:%QUERY%`, `scsearch:%QUERY%` work unchanged. Booted: `/v4/info` lists sourceManagers `...,spotify,applemusic,youtube,http`; a `ytsearch:test` loadtracks reached the shim (error text from the shim propagated). Full end-to-end search not tested (no resolver). **Do not use `ytmsearch:` with backend ytdlp** (not handled).

## 3. Lavalink / image
- Latest release 4.2.2 (2026-03-06), https://github.com/lavalink-devs/Lavalink/releases/tag/4.2.2 . Tag `ghcr.io/lavalink-devs/lavalink:4.2.2` IS the glibc variant (eclipse-temurin 18 jammy, glibc 2.35); alpine variants are separate tags (`*-alpine`). Index digest `sha256:87ae53e60dc147c9dddb28e126ce503a26bc8d1477ed8d99543614677882afff` (pinned in Dockerfile).
- User `lavalink` uid/gid 322, WORKDIR `/opt/Lavalink`, entrypoint `java -jar Lavalink.jar`. Config: `/opt/Lavalink/application.yml` (CWD; confirmed working). Plugins dir default `./plugins` = `/opt/Lavalink/plugins`.
- DAVE: introduced in 4.2.0 (libdave via koe). Server-side needs no config; it needs a DAVE-capable client lib and sends voice state `channelId` (bot concern). 4.2.2 updates libdave to 0.1.3.
- Logs go to `./logs/` by default (not checked under read-only rootfs; mount an emptyDir at `/opt/Lavalink/logs` to be safe).
- Observed: `GET /version` and `/v4/info` require `Authorization: <password>`. Boot ~3s, ~5s to listening.

## 4. LavaSrc release / Maven
- Latest 4.8.3 (2026-05-22). `com.github.topi314.lavasrc:lavasrc-plugin:4.8.3`, repo `https://maven.lavalink.dev/releases` (also https://maven.topi.wtf/releases). sha256 published: `4ec389bdae64fd381ee62fcdb902e15d9402823b1ad0b982bd5633619a07c1b3` (Dockerfile verifies it).
- **Apple Music gotcha:** if `applemusic: true`, `mediaAPIToken` must be a JWT-shaped string (else Lavalink FAILS TO BOOT: "Invalid token provided must have 3 parts"); if empty, LavaSrc scrapes music.apple.com at boot (needs egress, brittle). Chart should set `applemusic: false` when no token is supplied. Spotify with empty client id was not tested; same advice.

## 5. youtube-source plugin
- Latest tag 1.18.2 (2026-07-27) `dev.lavalink.youtube:youtube-plugin:1.18.2`, release repo `https://maven.lavalink.dev/releases`. Snapshots (fixes live here: newest 2026-09-17, commit `2be8e542d3f6f178e048dca565892684c2e40177`, "fix: cipher: close embed response ...") at `https://maven.lavalink.dev/snapshots`, version = full 40-char commit hash (no `-SNAPSHOT` suffix in Lavalink config). Snapshot jar URL verified HTTP 200.
- Lavalink dependency entry: `dependency: "dev.lavalink.youtube:youtube-plugin:<ver-or-hash>"` + `snapshot: true|false`.
- Config (`plugins.youtube`, source: plugin/YoutubeConfig.java on main + README): `enabled`, `allowSearch`, `allowDirectVideoIds`, `allowDirectPlaylistIds`, `clients` (list), `clientOptions.<CLIENT>.{playback,videoLoading,playlistLoading,searching}`, `remoteCipher.{url,password,userAgent}`, `oauth.{enabled,refreshToken,skipInitialization}`, `pot.{token,visitorData}` (BOTH required, affects WEB/WEBEMBEDDED only; not needed with OAuth).
- Recommended clients (README): `MUSIC, ANDROID_VR, WEB, WEBEMBEDDED`. Boot log confirmed these map to WEB_REMIX, ANDROID_VR, WEB, WEB_EMBEDDED_PLAYER. `ytsearch:` and `ytmsearch:` handled when allowSearch.
- Env placeholders: unset `${VAR}` has no default and breaks binding, so optional ones (oauth/pot) are commented out in the reference config; chart should render them only when set.

## 6. Plugin loading semantics (Lavalink 4.2.2 PluginManager.kt)
https://github.com/lavalink-devs/Lavalink/blob/4.2.2/LavalinkServer/src/main/java/lavalink/server/bootstrap/PluginManager.kt
- EVERY `*.jar` in the plugins dir is loaded, whether or not declared. `lavalink.plugins` entries only trigger downloads (only if the list is non-empty). For a declared plugin, existing jars with the same manifest name but a different version are DELETED and the declared version downloaded. An update check hits `maven-metadata.xml` on the same repo (warn only).
- Hence: LavaSrc baked, not declared (no network needed); youtube-plugin NOT baked, declared (a baked copy would be loaded in addition/deleted). Pre-placed same-version jar is not re-downloaded.
- Plugin dir must be writable by uid 322 for downloads. If the chart mounts an emptyDir over `/opt/Lavalink/plugins`, it hides the baked LavaSrc: copy from `/opt/Lavalink/baked-plugins/` in an init container (provided in the image).
- Verified live: backend=plugin config downloaded 1.18.2 from maven.lavalink.dev and loaded both plugins (`/v4/info` plugins list), remote cipher log line printed.

## 7. kikkia/yt-cipher (https://github.com/kikkia/yt-cipher)
- Image: `ghcr.io/kikkia/yt-cipher` — only the `master` tag is published (branch tag, amd64+arm64). Pin by digest: `ghcr.io/kikkia/yt-cipher:master@sha256:4c5ec381ff57336cfc24822d2b526a5ad7cd0171f61065a1bbc87bb736842449` (resolved 2026-10-14). No releases/tags upstream.
- Distroless (`gcr.io/distroless/cc-debian12`, user `nonroot`), no shell/curl: use httpGet/tcpSocket probes. Port **8001** (env `PORT`, `HOST` default 0.0.0.0).
- Env: `API_TOKEN` (password; clients send header `Authorization: <token>`; must equal Lavalink `remoteCipher.password` / `YTCIPHER_PASSWORD`), `OVERRIDE_PLAYER_VARIANT=IAS` (recommended in compose; README prose says `OVERRIDE_SCRIPT_VARIANT`, the config list and compose say `OVERRIDE_PLAYER_VARIANT`), `MAX_THREADS`, `PREPROCESSED_CACHE_SIZE` (150), `IGNORE_SCRIPT_REGION`, `OVERRIDE_PLAYER_ID`.
- No dedicated health endpoint. Unauthenticated: `GET /metrics` (Prometheus, 200) — use as readiness/liveness httpGet, or tcpSocket 8001. `GET /` serves docs page. API: `POST /decrypt_signature`, `/get_sts`, `/resolve_url`.
- Writes a player cache in `/app/player_cache` (owned by nonroot); needs egress to youtube.com (player scripts).

## 8. Shim
Behavior per spec §6; deviation: resolver stderr is forwarded only when exitCode != 0 (see section 1). HTTP non-200 from resolver (e.g. 400 allowlist rejection) -> message on stderr + exit 1. Client timeout 35s. Unit tests cover these.
