# syntax=docker/dockerfile:1

# ---- build the yt-dlp shim (static Go binary) ------------------------------
FROM golang:1.25 AS shim
WORKDIR /src
COPY shim/go.mod ./
COPY shim/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/yt-dlp .

# ---- fetch the LavaSrc plugin jar and verify its checksum ------------------
FROM golang:1.25 AS plugins
ARG LAVASRC_VERSION=4.8.3
# sha256 published next to the jar on the Maven repo (…/lavasrc-plugin-<ver>.jar.sha256)
ARG LAVASRC_SHA256=4ec389bdae64fd381ee62fcdb902e15d9402823b1ad0b982bd5633619a07c1b3
ARG LAVASRC_REPO=https://maven.lavalink.dev/releases
RUN mkdir -p /out/plugins \
 && curl -fsSL -o /out/plugins/lavasrc-plugin-${LAVASRC_VERSION}.jar \
      ${LAVASRC_REPO}/com/github/topi314/lavasrc/lavasrc-plugin/${LAVASRC_VERSION}/lavasrc-plugin-${LAVASRC_VERSION}.jar \
 && echo "${LAVASRC_SHA256}  /out/plugins/lavasrc-plugin-${LAVASRC_VERSION}.jar" | sha256sum -c -

# ---- final image: upstream Lavalink (glibc / Debian-Ubuntu jammy, NOT alpine)
# 4.2.2 index digest resolved 2026-10 via `docker buildx imagetools inspect`.
FROM ghcr.io/lavalink-devs/lavalink:4.2.2@sha256:87ae53e60dc147c9dddb28e126ce503a26bc8d1477ed8d99543614677882afff

# Upstream user is lavalink (uid/gid 322) and stays the runtime user.
# Plugins dir (Lavalink default ./plugins == /opt/Lavalink/plugins) holds LavaSrc.
# It must stay writable by uid 322 because `lavalink.plugins` dependency entries
# (youtube-plugin) are downloaded into it at startup.
COPY --from=plugins --chown=322:322 /out/plugins/ /opt/Lavalink/plugins/
# Pristine copy for chart init containers that mount an emptyDir over
# /opt/Lavalink/plugins (e.g. readOnlyRootFilesystem): `cp /opt/Lavalink/baked-plugins/*.jar /opt/Lavalink/plugins/`
COPY --from=plugins --chown=322:322 /out/plugins/ /opt/Lavalink/baked-plugins/
COPY --from=shim --chmod=0755 /out/yt-dlp /usr/local/bin/yt-dlp

# Default config location is /opt/Lavalink/application.yml (CWD); the chart mounts it there.
EXPOSE 2333
