{{/* Chart name. */}}
{{- define "celeste.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Base name for every resource: the release name, so Services are <release>-bot, <release>-lavalink, ... (docs/contracts.md). */}}
{{- define "celeste.fullname" -}}
{{- default .Release.Name .Values.fullnameOverride | trunc 52 | trimSuffix "-" }}
{{- end }}

{{- define "celeste.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Selector labels. Call with (dict "root" . "component" "bot"). */}}
{{- define "celeste.selectorLabels" -}}
app.kubernetes.io/name: {{ include "celeste.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Full label set. Call with (dict "root" . "component" "bot"). */}}
{{- define "celeste.labels" -}}
{{ include "celeste.selectorLabels" . }}
helm.sh/chart: {{ include "celeste.chart" .root }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/part-of: celeste
{{- end }}

{{/* Labels for chart-wide objects that belong to no single component. */}}
{{- define "celeste.commonLabels" -}}
app.kubernetes.io/name: {{ include "celeste.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ include "celeste.chart" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: celeste
{{- end }}

{{/* Image reference for our own images. Call with (dict "root" . "image" .Values.bot.image). Tag precedence: component tag, global image.tag, appVersion. */}}
{{- define "celeste.image" -}}
{{- $tag := .image.tag | default .root.Values.image.tag | default .root.Chart.AppVersion -}}
{{- printf "%s/%s:%s" .root.Values.image.registry .image.repository $tag -}}
{{- end }}

{{- define "celeste.pullSecretName" -}}
{{- printf "%s-ghcr-pull" (include "celeste.fullname" .) -}}
{{- end }}

{{- define "celeste.imagePullSecrets" -}}
{{- if .Values.image.pullSecret.enabled }}
imagePullSecrets:
  - name: {{ include "celeste.pullSecretName" . }}
{{- end }}
{{- end }}

{{/* Reference to the ESO store. */}}
{{- define "celeste.secretStoreRef" -}}
secretStoreRef:
  name: {{ .Values.externalSecrets.storeName }}
  kind: {{ .Values.externalSecrets.storeKind }}
{{- end }}

{{/* Name of the CNPG cluster; its generated app Secret is <cluster>-app. */}}
{{- define "celeste.pgName" -}}
{{- printf "%s-postgres" (include "celeste.fullname" .) -}}
{{- end }}

{{/* True when the plugin backend's yt-cipher is deployed. */}}
{{- define "celeste.ytCipherEnabled" -}}
{{- if and (eq .Values.youtube.backend "plugin") .Values.ytCipher.enabled -}}true{{- end -}}
{{- end }}

{{/* Fail early on an invalid backend. */}}
{{- define "celeste.validate" -}}
{{- if not (has .Values.youtube.backend (list "ytdlp" "plugin")) -}}
{{- fail "youtube.backend must be 'ytdlp' or 'plugin'" -}}
{{- end -}}
{{- if and (eq .Values.youtube.backend "plugin") (not .Values.ytCipher.enabled) -}}
{{- fail "youtube.backend=plugin requires ytCipher.enabled=true (the rendered config points the plugin at yt-cipher)" -}}
{{- end -}}
{{- end }}

{{/* Common hardened container securityContext. */}}
{{- define "celeste.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end }}

{{/* Optional scheduling knobs. Call with the component values map. */}}
{{- define "celeste.scheduling" -}}
{{- with .nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{- define "celeste.monitoringPeer" -}}
- namespaceSelector:
    matchLabels:
      kubernetes.io/metadata.name: {{ . }}
{{- end }}
