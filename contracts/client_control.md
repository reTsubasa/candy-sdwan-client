# Client Control API v1

This contract is separate from node enrollment and site-runtime configuration.
All endpoints require a valid Cloud human session unless explicitly stated otherwise.
Cloud derives `tenant_id` and `user_id` from the session; values supplied by a client
must never be used to switch tenant or user context.

## Endpoints

| Method | Endpoint | Purpose | Idempotency |
|---|---|---|---|
| `POST` | `/v1/client/devices` | Register or replay a terminal public key | `request_id` + session + device key |
| `POST` | `/v1/client/devices/{device_id}/grant` | Issue/replay a terminal Client Grant | `request_id` + device + request fingerprint |
| `GET` | `/v1/client/devices/{device_id}/projection` | Return the current signed PolicyProjection | `If-None-Match` by content hash |
| `PUT` | `/v1/client/devices/{device_id}/projection/receipt` | Report received/verified/staged/committed/rejected | `request_id` |
| `POST` | `/v1/client/devices/{device_id}/heartbeat` | Refresh liveness and request revocation state | `request_id` |
| `POST` | `/v1/client/devices/{device_id}/revoke` | Revoke device key and active Client Grant | `request_id` |

## Trust and binding rules

- The session subject owns the device. A request naming another tenant or user is rejected.
- The device generates the Ed25519 key pair locally. Cloud stores only the public key.
- `device_id`, `device_key_id`, `grant_id`, `projection_id`, `generation`, and content hash are all bound in the signed Grant/Projection.
- A terminal Client Grant is not a node enrollment credential and is not interchangeable with the existing `/v1/access-grants` Node Grant.
- A terminal Projection is not site-runtime configuration; it contains only the device's authorized resources, mode capabilities, node lease set, DNS behavior, and underlay exclusions.
- Cloud persistence must enforce the same organization/tenant/user/device/key binding at database level; handlers must not rely on a caller-supplied ID tuple alone.
- Revocation removes the device/key from new Projection output, rejects new Peer authorization at Node/Core, and closes existing sessions within the bounded drain interval.

## Status receipt

The state progression is `received -> verified -> staged -> committed`. `rejected` is terminal for that projection generation. A receipt with a different device key, projection hash, or generation is rejected and audited.

## HTTP behavior

- Unknown JSON fields are rejected on requests.
- Replaying the same `request_id` with a different request fingerprint returns conflict.
- Cloud does not carry business traffic; these endpoints are control-plane only.
- `401` means the human session is absent/expired; `403` means the device is not owned or authorized; `409` means an idempotency or generation conflict; `410` means the device/grant is revoked; `503` means the control plane cannot safely produce a signed result.
