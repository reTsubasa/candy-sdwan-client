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

当前已完成策略管理侧的发布、设备绑定和有效策略读取；这些接口不等价于终端客户端注册接口，终端客户端仍不能直接调用节点 enrollment 或站点 runtime 接口。

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
2. Cloud 新增终端设备注册和客户端 Grant/Projection 接口后，Client 才保存 device identity；
3. Client 通过独立的终端配置同步接口获取 `PolicyProjection`；
4. Core/Node 完成终端 Grant 的数据面校验后，才允许发布客户端数据面；
5. 现有节点 enrollment 和 Site/Segment Runtime 同步继续服务原有 OpenWrt/Linux 节点，不因终端客户端改造而改变既有语义。

## 禁止事项

- 不把 `/auth/v1/enrollment/challenges` 当作终端用户注册接口；
- 不把 `/auth/v1/runtime/configuration` 的 Site/Segment 文档直接映射为终端 Projection；
- 不把人类 Access Token 直接塞入 QUIC Peer 认证；
- 不让客户端根据本地测速选择 Cloud 未授权节点；
- 不在 Client 仓库复制 Cloud 的用户、角色和完整策略数据库。
