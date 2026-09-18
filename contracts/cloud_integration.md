# Cloud 集成基线

本文档把 SD-WAN Client 方案映射到当前 `candy-cloud` 实现，防止客户端项目重新定义一套与 Cloud 不兼容的认证和设备协议。

## 当前可复用能力

| 能力 | 当前 Cloud 合同 | 客户端使用方式 |
|---|---|---|
| 人类用户登录 | `/identity/v1/auth/login` | Flutter 发送 email/password；把 email 作为当前版本的登录用户名 |
| 会话刷新 | `/identity/v1/auth/refresh` | Agent 保存并轮换 opaque refresh credential |
| 登出 | `/identity/v1/auth/logout` | Agent 先撤销 Cloud Session，再关闭数据面 |
| 密码安全 | `cloud-identity` 的 Argon2id | 直接复用，不在 Client 实现密码校验 |
| 节点 enrollment | `/auth/v1/enrollment/*` | 只供 Cloud 管理的 OpenWrt/Linux 节点使用 |
| 设备证书续期 | `/auth/v1/device-certificates/renew` | 仅在终端设备采用同一 Device CA 模型后复用 |
| Grant | `/auth/v1/access-grants` | 复用 Grant 的签名和验证模型，不直接复用 Node Pool 语义 |
| Runtime 同步 | `/auth/v1/runtime/*` | 当前是 Site/Segment Runtime 合同，不直接作为终端 Projection |
| 终端访问策略发布 | `/v1/tenants/{tenant_id}/client-access-policies` | 仅供已认证 Cloud 管理面发布 tenant 级终端资源和模式权限 |
| 终端策略设备绑定 | `/v1/tenants/{tenant_id}/client-access-policy-bindings` | 仅供已认证 Cloud 管理面把策略绑定到具体终端设备 |
| 终端策略读取 | `/v1/tenants/{tenant_id}/client-users/{user_id}/client-devices/{client_device_id}/access-policy` | 管理面读取有效绑定；终端专用读取/注册接口仍待完成 |
| 终端设备注册 | `/v1/client/devices` | 客户端用人类会话注册本地生成的 Ed25519 公钥；幂等重放；无绑定策略时返回 `grant = null` |
| 终端 Client Grant 签发 | `/v1/client/devices/{device_id}/grant` | 客户端换取 Cloud 签名的 Terminal Client Grant；同一 `request_id` 字节级重放 |

当前 Cloud 已实现用户名密码的安全基础：密码哈希、短期 Access Token、轮换 Refresh Token、撤销和会话检查。当前登录字段是 `email`，因此 Client v1 的“用户名”在协议层映射为 Cloud email；如果产品必须支持非 email 用户名，应新增独立的唯一 `username` 字段和迁移任务，不能让客户端私自改变请求字段。

## 终端客户端的缺口

现有 enrollment 流程面向节点加入：使用管理员创建的单次 activation credential，建立节点设备证书和 Site/Segment 绑定。它不能直接替代终端客户端注册，因为终端客户端首先由人类会话授权，且不一定拥有 Site、Attachment 或固定路由域。

终端客户端需要单独定义以下 Cloud 流程：

```text
Human Session
  -> 注册终端公钥和安装实例
  -> Cloud 绑定 tenant/user/device/device_key
  -> Cloud 根据用户、设备和租户策略生成 Client Device Grant
  -> Cloud 计算主节点、备用节点和 PolicyProjection
  -> Client 验证并执行 Projection
```

当前已完成策略管理侧的发布、设备绑定和有效策略读取，并已实现终端设备注册
（`POST /v1/client/devices`）和 Terminal Client Grant 签发
（`POST /v1/client/devices/{device_id}/grant`）。终端路由把 tenant/user 完全取自会话，
请求体没有任何可用于切换租户或用户的字段。这些接口仍不等价于节点 enrollment 接口，
终端客户端不能调用节点 enrollment 或站点 runtime 接口。

注册与签发是两个步骤，因为策略只能绑定到已存在的设备行：设备先注册，管理面再绑定
策略，然后客户端才能取到 Grant。首个注册响应在策略未绑定时返回 `grant = null`，
客户端必须保持未连接并按退避重试，UI 显示 `wait_for_policy`。

Terminal Client Grant 与节点 Grant 完全分离：独立的
`cloud-client-grant` 签名域（`candy/sdwan/client-grant/v1`）、独立的签名密钥、
独立的 entitlement 校验路径，不复用 `/v1/access-grants` 的 Node Pool 信任域或密钥。

Cloud 数据层提供终端授权快照和候选节点选路的内部能力：快照按同一
`organization_id/tenant_id/user_id/client_device_id` 读取 active 用户、终端设备、active
设备公钥、策略 generation/content hash 和完整资源集合；候选节点只来自租户下 active 且
具备有效 `private.tun.connect` entitlement 和 active `CANDY_QUIC_UDP` endpoint 的节点。
Cloud 会稳定地产生 1 个主节点和最多 2 个备用节点，并按偏好区域、区域名、节点 ID、
endpoint ID 排序。授权快照与候选节点选路已在 Grant 签发路径中生效：客户端拿到的节点
集合全部由 Cloud 选定，客户端不能自行选择或新增节点。PolicyProjection 的终端 HTTP
接口仍未实现，在此之前客户端拿到 Grant 后不得自行推导资源权限。

这条流程必须明确：

- 用户会话只负责调用 Cloud API，不直接作为 SD-WAN Peer 凭据；
- 终端设备密钥在本地生成，Cloud 只接收公钥；
- 终端 Device Grant 与节点 enrollment Grant 分开建模，至少在 `service_class`、audience 和撤销范围上区分；
- 终端 Projection 与当前 `runtime_configuration_v1` Site/Segment projection 分开建模，避免把站点路由字段误用于终端流量；
- 节点选路结果带租约，客户端只在 Cloud 下发的主备集合内切换；
- Node/Core 使用同一个 Grant 和 Projection 对终端业务流量执行二次授权；
- Cloud 撤销用户、设备或 Grant 后，新会话被拒绝，已有会话按合同的 drain 时限关闭。

## 集成顺序

1. Client 先调用现有 `/identity/v1/auth/login`，不调用注册接口；
2. Client 用人类会话调用 `POST /v1/client/devices` 注册本地生成的设备公钥，保存
   device identity；`grant = null` 时保持未连接并重试；
3. 管理面把 Client Access Policy 绑定到该设备后，Client 调用
   `POST /v1/client/devices/{device_id}/grant` 获取签名的 Terminal Client Grant；
4. Client 通过独立的终端配置同步接口获取 `PolicyProjection`（尚未实现）；
5. Core/Node 完成终端 Grant 的数据面校验后，才允许发布客户端数据面；
6. 现有节点 enrollment 和 Site/Segment Runtime 同步继续服务原有 OpenWrt/Linux 节点，不因终端客户端改造而改变既有语义。

## 禁止事项

- 不把 `/auth/v1/enrollment/challenges` 当作终端用户注册接口；
- 不把 `/auth/v1/runtime/configuration` 的 Site/Segment 文档直接映射为终端 Projection；
- 不把人类 Access Token 直接塞入 QUIC Peer 认证；
- 不让客户端根据本地测速选择 Cloud 未授权节点；
- 不在 Client 仓库复制 Cloud 的用户、角色和完整策略数据库。
