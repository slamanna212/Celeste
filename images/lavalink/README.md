# celeste-lavalink

Official Lavalink 4.2.2 (glibc) + LavaSrc 4.8.3 baked in + a static `yt-dlp` shim at `/usr/local/bin/yt-dlp`
that forwards argv to the Celeste resolver (`POST $RESOLVER_URL/v1/exec`). See `VERIFICATION.md` for evidence.

- `shim/` Go (stdlib) shim. `cd shim && go vet ./... && go test ./...`
- `config/application.ytdlp.yml`, `config/application.plugin.yml` canonical reference configs (Helm templates these; mount at `/opt/Lavalink/application.yml`).
- Build: `docker build -t celeste-lavalink:dev images/lavalink` (args `LAVASRC_VERSION`, `LAVASRC_SHA256`).

Runtime env: `LAVALINK_PASSWORD`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `APPLE_MUSIC_MEDIA_API_TOKEN` (must be a JWT-looking token), `RESOLVER_URL` (shim), `_JAVA_OPTIONS=-Xmx768m`;
plugin backend adds `YTCIPHER_PASSWORD` (+ optional OAuth/PO token vars). Port 2333; runs as uid 322.

Backend `plugin` downloads youtube-plugin at startup from maven.lavalink.dev; backend `ytdlp` needs no Maven egress.
