# Chart verification log (2026-10-14)

Everything below was read from upstream docs/source or observed locally. Companion logs:
`images/lavalink/VERIFICATION.md`, `apps/resolver/VERIFICATION.md`.

## CloudNativePG (`postgresql.cnpg.io/v1` Cluster)
Sources: <https://github.com/cloudnative-pg/cloudnative-pg/tree/main/docs/src> (`applications.md`, `networking.md`, `labels_annotations.md`, `security.md`, `postgresql_conf.md`, `cloudnative-pg.v1.md`).
- `bootstrap.initdb.database` / `owner` = `celeste`. CNPG generates Secret `<cluster>-app` (basic-auth) with keys incl. `username`, `password`, `host`, `port`, `dbname`, `pgpass`, `uri`, `jdbc-uri`, `fqdn-uri`, `fqdn-jdbc-uri`. The bot reads `uri`.
- `spec.inheritedMetadata.{labels,annotations}`: "Metadata that will be inherited by all objects related to the Cluster". CNPG's e2e suite (`tests/e2e/pvc_inherited_metadata_test.go`) asserts it is applied to PVCs as well as pods. `storage.pvcTemplate` is a bare `PersistentVolumeClaimSpec` (no metadata), so it cannot carry annotations; `inheritedMetadata` is the mechanism.
- Pod labels for selectors: `cnpg.io/cluster: <cluster>` (also `cnpg.io/instanceRole`, `app.kubernetes.io/name: postgresql`).
- Ports (security.md table): 5432 PostgreSQL, 8000 instance-manager status (**required** by the operator), 9187 metrics. Operator namespace default `cnpg-system`, operator pod label `app.kubernetes.io/name: cloudnative-pg` (upstream `samples/networkpolicy-example.yaml` uses exactly this namespace+pod selector with ports 8000 and 5432).
- Local auth: CNPG's default `pg_hba` starts with `local all all peer`; `unix_socket_directories = '/controller/run'`; the pod spec sets `PGHOST` to the socket dir. A `pg_dump` exec'd in the `postgres` container runs as the container user (`postgres`), so peer auth works with no password.
- `monitoring.enablePodMonitor` is marked **deprecated** in the current API reference, so the chart renders its own `PodMonitor` (`postgres.monitoring.podMonitor.enabled`, port `metrics`) instead.
- Resources via `spec.resources` (requests cpu+mem, memory limit only).

## k8up (owner runs chart 4.9.0 / operator 2.x)
Sources: <https://docs.k8up.io/k8up/references/annotations.html>, <https://docs.k8up.io/k8up/how-tos/application-aware-backups.html>, source `restic/kubernetes/pod_list.go`, `operator/backupcontroller/executor.go` (k8up-io/k8up master).
- `k8up.io/backupcommand` (Pod): command exec'd in the pod, stdout is stored. The command string is shell-quote-split and exec'd directly, so a pipeline/env needs `sh -c '...'`.
- `k8up.io/file-extension` (Pod): extension of the stored file (chart: `.dump`).
- `k8up.io/backupcommand-container` (Pod): container to exec in. Without it k8up uses `containers[0]`; the chart sets `postgres`.
- Only one pod per owner reference is dumped (single instance anyway).
- PVC opt-out: `k8up.io/backup: "false"` **on the PVC** (`listAndFilterPVCs` reads it from PVC annotations; unannotated RWO/RWX PVCs are backed up). The pod lister (`ListPods`) only looks at the backupcommand annotation and never reads `k8up.io/backup`, so putting `k8up.io/backup: "false"` in `inheritedMetadata` (which lands on both pods and PVCs) excludes the PVC without disabling the dump.
- Caveat to confirm after first deploy (cannot be tested without a cluster): `kubectl get pvc -l cnpg.io/cluster=<r>-postgres -o yaml` must show `k8up.io/backup: "false"`. If it does not, annotate the PVC by hand (`kubectl annotate pvc <r>-postgres-1 k8up.io/backup=false`); CNPG does not strip foreign annotations.

## External Secrets Operator
- `external-secrets.io/v1` `ExternalSecret`: `spec.refreshInterval`, `secretStoreRef{name,kind}`, `target{name,creationPolicy,template{type,data}}`, `data[]{secretKey,remoteRef{key}}`. Validated with kubeconform `-strict` against the datree CRDs-catalog schema (not skipped).
- GHCR pull secret: `target.template.type: kubernetes.io/dockerconfigjson`, `data[".dockerconfigjson"] = "{{ .dockerconfig }}"`, where `.dockerconfig` is the key fetched from AKV. The AKV secret must therefore contain the whole dockerconfigjson document.

## Metrics
- Lavalink `/metrics`: `RequestAuthorizationFilter` (4.2.2) explicitly lets `metricsConfig.endpoint` through without authorization ("Collecting metrics is anonymous"), so the ServiceMonitor needs no `authorization` block. Every other route needs `Authorization: <password>`; hence TCP probes.
- Bot `/metrics` on 9090, resolver `/metrics` on 8080 (resolver README), yt-cipher `/metrics` on 8001 (unauthenticated; also used for probes).

## Local container checks (docker, rendered chart config)
- Lavalink `celeste-lavalink:dev`, `--read-only --user 322 --cap-drop ALL`, tmpfs on `/tmp` (needs `exec`; Docker tmpfs defaults to noexec which breaks the Netty/udpqueue natives, Kubernetes emptyDir is not noexec), `/opt/Lavalink/logs`, `/opt/Lavalink/plugins` seeded from `/opt/Lavalink/baked-plugins` by `cp`:
  - rendered ytdlp config: "Lavalink is ready", `/v4/info` OK (sourceManagers include applemusic, youtube[ytdlp], spotify), `/metrics` anonymous 200.
  - rendered plugin config: youtube-plugin 1.18.2 downloaded into the tmpfs and loaded next to lavasrc 4.8.3.
  - Apple Music token must be JWT-shaped even for a dummy value (`Input byte[] should at least have 2 bytes for base64`); the chart omits the block when `lavalink.appleMusic.enabled=false`.
- bgutil 2.0.2: ENTRYPOINT is `node build/main.js`, so `args: ["--host","127.0.0.1"]` binds loopback only ("Started POT server on 127.0.0.1:4416"); works with `--read-only --user 10001` and a /tmp tmpfs. Without `--host` the server binds `::1` and `127.0.0.1` only, the image's CMD adds `--host 0.0.0.0`. No kubelet probes (they cannot reach loopback).
- yt-cipher (digest in values): starts read-only as uid 65532 only when `/home/nonroot/.cache` is writable (it creates `/home/nonroot/.cache/yt-cipher/player_cache`); the chart mounts an emptyDir there. Default thread count = host cores (24 observed), so the chart sets `MAX_THREADS=4`.
