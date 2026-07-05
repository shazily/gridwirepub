{{/* Common helpers for the Gridwire chart */}}

{{- define "gridwire.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "gridwire.labels" -}}
app.kubernetes.io/name: gridwire
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Name of the Secret env vars are sourced from */}}
{{- define "gridwire.secretName" -}}
{{- if .Values.config.existingSecret -}}
{{- .Values.config.existingSecret -}}
{{- else -}}
{{- printf "%s-env" (include "gridwire.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* Fully-qualified image ref for a component */}}
{{- define "gridwire.image" -}}
{{- $tag := .tag | default .root.Chart.AppVersion -}}
{{- printf "%s%s:%s" .root.Values.image.registry .repository $tag -}}
{{- end -}}
