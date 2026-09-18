# 任务执行状态

## M0：合同、边界和基础设施

| 任务 | 状态 | 证据 |
|---|---|---|
| SDW-001 架构和职责基线 | 已完成 | `TECHNICAL_DESIGN.md`、`docs/decisions/ADR-001-control-plane-authority.md` |
| SDW-002 版本化合同和兼容矩阵 | 已完成 | `contracts/*.schema.json`、`contracts/agent_api.md`、`contracts/compatibility.md`、Ajv 2020-12 校验和 Agent 请求/响应/能力 schema |
| SDW-003 错误码和状态模型 | 已完成 | `contracts/error_codes.json`、`contracts/error_registry.schema.json`、`contracts/agent_status.schema.json`、`contracts/status_event.schema.json`、`contracts/telemetry_event.schema.json`；状态组合、转换事件、错误码去重和遥测引用拒绝测试 |
| SDW-004 开发、签名和测试环境 | 已完成（M0 范围） | `scripts/dev_env.mjs`、`scripts/tests/m0.test.mjs`、`.github/workflows/m0.yml`、`scripts/check_test_key_isolation.mjs`、`scripts/check-m0.sh`；合同级 mock Cloud/Node、撤销、丢包/延迟/断网/时间偏移注入、CI、依赖审计和测试凭据隔离 |

## M1：Cloud MVP 当前状态

| 任务 | 状态 | 证据/缺口 |
|---|---|---|
| SDW-101 预注册用户和密码认证 | 部分已有 | `candy-cloud/cloud-identity` 已有 Argon2id、login、refresh、logout 和撤销；当前登录标识是 email，客户端专属预注册入口仍需确认 |
| SDW-102 设备注册和设备撤销 | 终端注册已实现，降级路径已建模，撤销/轮换 HTTP 待实现 | 现有 `/auth/v1/enrollment/*` 面向节点 activation credential；终端注册已通过 `POST /v1/client/devices` 用人类会话绑定公钥，撤销设备返回 `410`；设备无 active key 时返回 `409`，但把设备置为 suspended/revoked 的管理面接口和 key rotation 流程尚未实现 |
| SDW-103 资源和模式权限模型 | 策略发布、设备绑定、管理读取和授权快照已完成，终端消费进行中 | Cloud 已新增独立 `client_access_policies`、`client_access_policy_bindings` 表、`cloud-db::client_access` 和 `ClientAuthorizationSnapshot`；策略支持资源集合、policy/global 模式、全局出口能力、tenant generation、用户/设备绑定、幂等发布和审计；快照会校验 active 用户/设备/key、策略 generation 和 content hash；尚未接入终端专用读取和 Projection 发布器 |
| SDW-104 PolicyProjection 生成、签名和发布 | 站点合同已有，终端合同待对接 | `runtime_configuration_v1` 是 Site/Segment projection；终端 `PolicyProjection` 已在本目录冻结，尚未接入 Cloud 发布器 |
| SDW-105 Cloud 节点健康和授权选路 | 候选查询、确定性选路和签发期租约已完成，租约持久化待实现 | `cloud-db::client_routing` 只返回租户下 active、具备有效 `private.tun.connect` entitlement 和 active QUIC endpoint 的节点；选路按偏好区域、区域名、节点 ID、endpoint ID 稳定排序，最多返回 1 主 + 2 备，并保证节点不重复；Grant 签发时按 `CLIENT_GRANT_NODE_LEASE_SECS`（1 小时）写入 `assignment_lease_until`，远短于 24 小时 Grant 生命周期，使节点退服由刷新处理；主备 assignment lease 的持久化跟踪仍待实现 |
| SDW-106 Cloud 控制通道和配置回执 | Runtime 能力已有，终端接口待实现 | 现有 `/auth/v1/runtime/*` 可参考；不能直接复用为终端配置接口 |
| SDW-107 终端设备注册和 Client Grant/Projection 接口 | 注册与 Client Grant 签发 HTTP 已接入，Projection 签发待实现 | 客户端侧：`contracts/client_control.md`、`contracts/client_control.schema.json`、`contracts/examples/client_*.json`；Cloud 侧已加入 `0038_terminal_client_control.sql`、`0039_terminal_client_registration_idempotency.sql`、`0040_terminal_client_access_policies.sql`，`cloud-db::client_control`/`client_access`/`client_routing` repository 和策略发布、绑定、读取路由，并完成真实 MySQL migration 验证 |

### SDW-107 本轮进展明细

**终端 HTTP 接口（`crates/cloud-api/src/client_api.rs`）**

- `POST /v1/client/devices`：注册或幂等重放终端设备公钥。`tenant_id`/`user_id` 只来自会话，
  响应信封拒绝未知字段，因此请求体没有任何可用于切换租户或用户的字段；新注册返回 `201`，
  幂等重放返回 `200`，撤销设备返回 `410` 且 body 带 `status = "revoked"`。
- `POST /v1/client/devices/{device_id}/grant`：签发或字节级重放 Terminal Client Grant。
  `None`（未注册）→ `404`，`Revoked` → `410`，`Suspended` → `409`，`device_key_id` 不匹配 → `403`。
- `public_key` 必须 base64url 解码为恰好 32 字节；31 字节截断和 64 字节私钥形态都被拒绝。
- `platform` 只接受 `windows`/`macos`/`android`。
- 会话抽取在请求体之前完成：未认证调用者即使发送畸形 body 也只得到 `401`，
  不会泄露 Cloud 校验了哪些字段。
- body 解析失败统一映射为合同错误信封（`INVALID_JSON`/`INVALID_REQUEST`），
  不再泄漏 axum 默认的 `422` 纯文本。

**签发编排（`crates/cloud-api/src/client_issuance.rs`）**

- 先查幂等重放（返回存储的原始字节，绝不重新签名），再取授权快照、Cloud 侧选路、
  签名、`write_grant` 做 generation compare-and-set、读回校验绑定。
- 请求指纹排除 `grant_id`/`generation`/`issued_at`/`expires_at`，包含策略 generation/hash、
  设备 key 和节点集合，因此同一 `request_id` 用于实质不同的请求会 conflict，而合法重试通过。
- 错误语义：`Unavailable`/`NoActiveNode` → `503`，`PolicyNotBound`/`IdempotencyConflict`/
  `GenerationConflict` → `409`，`NotOwned` → `403`；Cloud 故障绝不报成客户端错误。

**签名 crate（`crates/cloud-client-grant`）**

- 独立签名域 `candy/sdwan/client-grant/v1` 与独立签名密钥，不复用 Node Grant 信任域。
- 签名 = `Ed25519.Sign(key, DOMAIN || SHA256(JCS(payload)))`；token = `base64url(JCS(envelope))`，
  与存储字节完全相同。
- 测试含与 Client 冻结向量 `contracts/examples/signature_vector.json` 的跨语言一致性验证，
  以及 `to_envelope_bytes`/`from_envelope_bytes` 往返字节一致性。

**测试**

- `crates/cloud-api/tests/client_plane.rs`：9 个路由测试，全部在触达数据库前失败验证
  （未认证 401、畸形 body、请求体身份伪造字段、api_version/message_type/request_id、
  platform、public_key、会话无法映射 user_id、缺平面时 503、路径与 body device_id 不一致）。
- `crates/cloud-db/tests/client_control.rs`：12 个测试，覆盖平台/状态枚举映射、
  设备绑定完整性、lookup 状态不可折叠、generation 边界（0 / `i64::MAX` / 上溢）、
  指纹/信封/时间窗约束、只读路径的 scope 先行校验。
- `crates/cloud-client-grant/tests/client_grant.rs`：9 个测试。

**验证状态**：`cargo test --workspace` 全部通过（0 失败）；`cargo clippy --workspace
--all-targets -- -D warnings` 零告警；`./scripts/check-m0.sh` 通过。

**尚未完成**：PolicyProjection 生成器与 `GET .../projection`、receipt、heartbeat、revoke
HTTP；Core/Node 独立终端 Grant 验证路径；主备节点 assignment lease 持久化；Flutter UI。

现有 Cloud 身份单元测试基线：在 `/Users/hyc/Documents/candy/candy-cloud` 执行 `cargo test -p cloud-identity --lib`，9 个测试通过。

## 当前验证

执行：

```sh
./scripts/check-m0.sh
```

通过条件：schema 和 fixture 为有效 JSON，并且 Projection 的 audience、时间窗、generation、主备节点租约、模式和全局出口约束一致；关键越权和失效输入会被拒绝。

当前门禁使用 Ajv 2020-12 执行真实 JSON Schema 校验，并使用 RFC 8785 JCS、SHA-256 和 Ed25519 固定向量执行签名验证；语义测试覆盖 audience、时间窗、generation/授权边界、节点唯一性、状态组合、Agent payload 边界、错误码/遥测引用、撤销路径和故障注入。`npm audit --audit-level=high` 为 M0 依赖门禁；模拟环境明确不承载业务数据面。

## M0 未包含的后续工作

1. 以 `PolicyProjection` 合同实现 Cloud Projection 生成器、持久化、`GET .../projection`、
   receipt、heartbeat 和 revoke HTTP；
2. 主备节点 assignment lease 持久化，使节点退服可由刷新与租约过期共同处理；
3. 在 Rust Core 中实现与 Cloud 一致的 Client Grant 签名输入、时间窗和 audience 验证，
   并保持与现有 Node Grant 验证路径完全分离；
4. 冻结 Agent API 后创建 Flutter 和三端（Windows/macOS/Android）平台适配代码；
5. M0 之后再接入真实测试 Cloud/Node、真实 QUIC/TLS 和真实 TUN 流量验收。
