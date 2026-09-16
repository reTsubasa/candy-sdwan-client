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
| SDW-102 设备注册和设备撤销 | 节点能力已有，终端能力待实现 | 现有 `/auth/v1/enrollment/*` 面向节点 activation credential；终端用户会话绑定设备的接口尚未建立 |
| SDW-103 资源和模式权限模型 | 策略发布、设备绑定和管理读取 API 已完成，终端消费进行中 | Cloud 已新增独立 `client_access_policies`、`client_access_policy_bindings` 表、`cloud-db::client_access`，以及策略发布、设备绑定和有效策略读取接口；策略支持资源集合、policy/global 模式、全局出口能力、tenant generation、用户/设备绑定、幂等发布和审计；尚未接入终端专用读取和 Projection 发布器 |
| SDW-104 PolicyProjection 生成、签名和发布 | 站点合同已有，终端合同待对接 | `runtime_configuration_v1` 是 Site/Segment projection；终端 `PolicyProjection` 已在本目录冻结，尚未接入 Cloud 发布器 |
| SDW-105 Cloud 节点健康和授权选路 | 站点路径能力已有，终端选路待实现 | 现有路径/Peer/Runtime 遥测可复用；终端主备节点租约尚未发布 |
| SDW-106 Cloud 控制通道和配置回执 | Runtime 能力已有，终端接口待实现 | 现有 `/auth/v1/runtime/*` 可参考；不能直接复用为终端配置接口 |
| SDW-107 终端设备注册和 Client Grant/Projection 接口 | 设备注册、Grant/策略持久化和策略管理 HTTP 已完成，终端注册/签发/Projection 进行中 | 客户端侧：`contracts/client_control.md`、`contracts/client_control.schema.json`、`contracts/examples/client_*.json`；Cloud 侧已加入 `0038_terminal_client_control.sql`、`0039_terminal_client_registration_idempotency.sql`、`0040_terminal_client_access_policies.sql`，`cloud-db::client_control`/`client_access` repository 和策略发布、绑定、读取路由，并完成真实 MySQL migration 验证；尚未接入终端客户端注册 HTTP、Grant 签发服务和 Projection 发布器 |

现有 Cloud 身份单元测试基线：在 `/Users/hyc/Documents/candy/candy-cloud` 执行 `cargo test -p cloud-identity --lib`，9 个测试通过。

## 当前验证

执行：

```sh
./scripts/check-m0.sh
```

通过条件：schema 和 fixture 为有效 JSON，并且 Projection 的 audience、时间窗、generation、主备节点租约、模式和全局出口约束一致；关键越权和失效输入会被拒绝。

当前门禁使用 Ajv 2020-12 执行真实 JSON Schema 校验，并使用 RFC 8785 JCS、SHA-256 和 Ed25519 固定向量执行签名验证；语义测试覆盖 audience、时间窗、generation/授权边界、节点唯一性、状态组合、Agent payload 边界、错误码/遥测引用、撤销路径和故障注入。`npm audit --audit-level=high` 为 M0 依赖门禁；模拟环境明确不承载业务数据面。

## M0 未包含的后续工作

1. `SDW-107`：把终端客户端注册和 Projection 对接到现有 Cloud 身份、Grant 和 Runtime 边界；
2. 以 `PolicyProjection` 合同实现 Cloud 终端 Grant API；
3. 在 Rust Core 中实现相同的签名输入、时间窗和 audience 验证；
4. 冻结 Agent API 后创建 Flutter 和三端平台适配代码；
5. M0 之后再接入真实测试 Cloud/Node、真实 QUIC/TLS 和真实 TUN 流量验收。
