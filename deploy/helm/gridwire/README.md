# Gridwire Helm chart

Deploys the **Gridwire portal** and the **companion ingestion worker** to
Kubernetes with configurable values and clean upgrades. See the repository
[`DEPLOYMENT.md`](../../../DEPLOYMENT.md) for the full on-premise guide.

> The chart deploys the two Gridwire runtime tiers only. Provision the
> Postgres-based backend (database + auth + REST) separately — see
> DEPLOYMENT.md → "Self-host the backend".

## Prerequisites

- Kubernetes 1.27+ and Helm 3.
- Portal & worker images pushed to a registry your cluster can pull:
  ```bash
  docker build -t YOUR_REGISTRY/gridwire-portal:1.0.0 .
  docker build -t YOUR_REGISTRY/gridwire-worker:1.0.0 ./worker
  docker push YOUR_REGISTRY/gridwire-portal:1.0.0
  docker push YOUR_REGISTRY/gridwire-worker:1.0.0
  ```
- An ingress controller + a TLS certificate (cert-manager or a manual Secret).

## Install

Recommended: keep secrets in a pre-created Secret, not in values.

```bash
kubectl create namespace gridwire

# 1. Create the config/secret from your .env
kubectl -n gridwire create secret generic gridwire-env --from-env-file=.env

# 2. Install, pointing the chart at that Secret
helm install gridwire ./deploy/helm/gridwire -n gridwire \
  --set config.existingSecret=gridwire-env \
  --set image.registry=YOUR_REGISTRY/ \
  --set ingress.host=data.your-company.com \
  --set ingress.tlsSecretName=gridwire-portal-tls
```

Or manage everything through a private `my-values.yaml`:

```bash
cp deploy/helm/gridwire/values.yaml my-values.yaml   # then edit
helm install gridwire ./deploy/helm/gridwire -n gridwire --create-namespace -f my-values.yaml
```

## Upgrade

```bash
# Bump image tags in values, then:
helm upgrade gridwire ./deploy/helm/gridwire -n gridwire -f my-values.yaml
```

Rolling updates are zero-downtime for the portal (multiple replicas). The worker
uses a `Recreate` strategy because only one poller may run at a time.

## Key values

| Key | Default | Purpose |
| --- | --- | --- |
| `config.existingSecret` | `""` | Name of a pre-created Secret with all env vars (recommended) |
| `image.registry` | `""` | Registry prefix, e.g. `registry.corp/` |
| `portal.replicaCount` | `2` | Portal replicas (stateless) |
| `portal.autoscaling.enabled` | `false` | Enable HPA for the portal |
| `worker.pollCron` | `*/5 * * * *` | Ingestion poll schedule |
| `worker.persistence.enabled` | `false` | Persist ingest state across restarts |
| `ingress.host` | `data.your-company.com` | Portal hostname |
| `ingress.tlsSecretName` | `gridwire-portal-tls` | TLS Secret for the host |

Run `helm show values ./deploy/helm/gridwire` for the complete list.

## Uninstall

```bash
helm uninstall gridwire -n gridwire
```
