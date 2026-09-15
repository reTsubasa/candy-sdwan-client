# SD-WAN Client 技术实现方案

执行任务拆解见 [TASK_BREAKDOWN.md](./TASK_BREAKDOWN.md)。该清单是本方案的研发执行基线，包含岗位、技术要求、验收标准、依赖和范围边界。

## 1. 项目定位

SD-WAN Client 面向 Windows、macOS 和 Android 终端，为用户提供一个极简的企业网络接入客户端。

客户端目标：

- 用户登录后自动获得 Cloud 授权的企业资源访问能力；
- 支持策略模式和全局模式两种流量调度方式；
- 通过系统 VPN/TUN 接管终端流量；
- 自动完成策略同步、节点连接、故障恢复和软件升级；
- 只向用户展示连接状态、模式开关和必要错误；
- 将结构化错误遥测上报到 Cloud，便于运营和故障定位。

核心原则：

> Cloud 是统一控制中心，负责用户认证、权限判断、策略计算和节点选路；客户端只负责验证并执行 Cloud 下发的结果。

业务流量不必经过 Cloud。Cloud 负责控制面，客户端根据 Cloud 授权直接连接指定的 SD-WAN 节点。

## 2. 总体架构

```text
                    Cloud Control Center
       用户认证 | 设备管理 | 权限 | 策略 | 节点选路 | 遥测
                              |
                   HTTPS/mTLS 控制通道
                              |
  +-----------------------------------------------------------+
  |              Flutter 跨平台 UI                            |
  | Windows / macOS / Android                                 |
  +--------------------------+--------------------------------+
                             | Platform Channel / FFI
  +--------------------------v--------------------------------+
  |                  Client Agent                             |
  | 本地 IPC | 密钥存储 | 生命周期 | TUN | 路由 | DNS         |
  +--------------------------+--------------------------------+
                             | Core Process API
  +--------------------------v--------------------------------+
  |                  Rust Client Core                         |
  | Projection 验证 | 数据面 | QUIC/TLS | Peer | 重连 | 遥测   |
  +--------------------------+--------------------------------+
                             |
                   Cloud 授权的 SD-WAN Node
                         业务数据面
```

客户端建议保持以下模块边界：

```text
sdwan-client/
  flutter-ui/                 # 三端共用 UI、状态和交互
  platform-bridge/            # Windows/macOS/Android 系统能力桥接
  client-agent/                # 后台服务、IPC、TUN、路由、DNS
  client-core/                 # Rust 数据面和协议实现
  contracts/                   # Cloud API、Projection、状态和错误码
  docs/                        # 设计、测试和发布文档
```

## 2.1 专家复核结论

原始方案可以作为产品方向，但还不能直接作为研发基线。复核发现以下问题：

| 问题 | 影响 | 修正 |
|---|---|---|
| Projection 只有普通签名和 generation | 可能把另一台设备、另一租户或另一种模式的配置错误应用到当前设备 | 增加 `projection_id`、`audience`、`content_hash`、`not_before`、`stale_until`、签名 key id 和配置类型 |
| Cloud 选路与本地恢复边界不够明确 | 客户端可能自行选择未授权节点，或 Cloud 变更后继续使用旧节点 | Cloud 下发主节点和有序备用集合；客户端只在集合内切换，并受租约和撤销约束 |
| “最后有效配置”没有明确期限 | Cloud 撤销权限或用户退出后可能继续访问资源 | 缓存配置只能在签名的 `stale_until` 之前使用；退出、撤销和设备密钥失效立即停止数据面 |
| 用户会话、设备身份和 SD-WAN Peer 身份混在一起 | Token 泄漏、会话过期和 Peer 重连的处理边界不清 | 分离 Cloud 会话、设备密钥、短期 Device Grant 和每条 Peer 的传输认证 |
| Flutter 与系统 VPN 的调用边界过于抽象 | Android、macOS 和 Windows 生命周期不同，容易让 UI 直接承担系统权限逻辑 | 定义版本化 Agent API；Flutter 只能发起意图，Agent 返回状态和用户动作 |
| 只有“连接/断开”状态 | 用户无法区分登录成功、策略未同步、节点不可用和 TUN 失败 | 定义身份、控制面、策略、节点分配、数据面和流量六个独立状态 |
| 遥测只定义字段，没有采样、去重和隐私边界 | 网络异常时可能造成遥测风暴，或上传过多敏感信息 | 增加事件等级、限流、去重、批量、脱敏和本地保留上限 |
| 更新和恢复只在实施阶段出现 | Core、Agent、Flutter 版本不兼容时可能导致断网 | 采用签名 manifest、兼容矩阵、A/B 安装和可验证回滚 |
| 资源权限只在客户端执行 | 本机管理员可以修改客户端规则，绕过资源授权 | Client 做调度，Node/Core 根据 Cloud Grant 在数据面再次强制执行 |

以下章节中的定义以本复核结论为准。

## 3. 三端跨平台 UI

### 3.1 技术选择

UI 采用 Flutter：

- Windows：Flutter Desktop；
- macOS：Flutter macOS；
- Android：Flutter Android；
- 复用页面、状态管理、主题、国际化和错误展示；
- 通过 Platform Channel 或 FFI 调用各平台 Agent。

Flutter 不负责 TUN、路由、DNS、节点选择、策略判断或密钥存储。

### 3.2 UI 页面

第一版只提供：

1. 登录页；
2. 主状态页；
3. 模式切换；
4. 账号和设备信息；
5. 必要的诊断信息页。

主页面示例：

```text
状态：已连接
账号：alice@example.com
设备：MacBook Pro
策略：企业办公策略 v42

[ 连接开关 ]

流量模式： [ 策略模式 ] [ 全局模式 ]

已保护资源：3 个
Cloud：已连接
策略更新时间：2 分钟前
```

不向普通用户展示节点列表、路由表、CIDR、QUIC 参数、MTU、Peer 或 DNS 规则。

## 4. Cloud 控制中心

Cloud 负责以下全部控制面能力：

- 用户认证和会话；
- 租户、角色和设备管理；
- 资源访问权限；
- 策略模式/全局模式权限；
- 策略计算和设备专属配置生成；
- 节点健康评估和主备节点选路；
- 设备撤销和强制下线；
- 策略版本、有效期和回滚；
- 客户端错误遥测接收、聚合和告警。

Cloud 生成设备专属的 `PolicyProjection`，客户端不保存和解释完整的企业策略数据库。

Cloud 还必须保存每个 Projection 的发布记录和撤销状态。客户端收到新配置后先验证签名和适用范围，再写入版本化的本地 staging 区；只有 Agent 和 Core 都报告预检查成功，才将其提升为 active。

客户端规则不是最终授权边界。SD-WAN Node/Core 必须验证同一个 Cloud `DeviceGrant` 和 `PolicyProjection`，并在数据面再次检查目标资源、端口、模式、租户、设备和 generation。客户端被篡改时，节点仍然拒绝未授权流量。Cloud 撤销 Grant 后，节点拒绝新会话，并关闭与该 Grant 绑定的已有会话。

## 5. 用户认证方案

### 5.1 MVP：Cloud 预注册用户 + 用户名密码

第一阶段不实现 OIDC、SAML、企业登录和 MFA 的具体业务流程，只在代码层预留统一接口。

```text
管理员在 Cloud 创建用户
        |
用户通过 Flutter 输入用户名和密码
        |
Cloud 完成认证、租户和角色检查
        |
客户端本地生成设备密钥
        |
Cloud 绑定用户、设备和租户
        |
Cloud 下发设备授权、策略和节点分配
```

用户不开放自助注册。初始密码可以由管理员设置、通过一次性临时密码下发，或由管理员生成重置流程。

### 5.2 Cloud API

```http
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/session
POST /api/v1/devices/register
POST /api/v1/devices/revoke
POST /api/v1/devices/heartbeat
GET  /api/v1/client-manifest
```

登录接口只返回会话信息，不直接返回业务策略：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 900,
  "user_id": "...",
  "tenant_id": "...",
  "device_registration_required": true
}
```

### 5.3 安全要求

- Cloud 仅保存 Argon2id 密码哈希；
- 全程使用 TLS 1.3；
- Access Token 短时有效；
- Refresh Token 轮换并支持撤销；
- 登录失败限速和临时锁定；
- 防止用户名枚举；
- 客户端不保存用户密码；
- Windows 使用 DPAPI，macOS 使用 Keychain/Secure Enclave，Android 使用 Keystore；
- 设备密钥在终端生成，私钥不可导出；
- SD-WAN 连接使用当前 TLS 会话、nonce 和设备密钥完成设备认证。

认证对象分为三层：

```text
Cloud Session       用户调用 Cloud API 的短期会话
Device Key          设备本地生成的长期密钥，用于证明设备身份
Device Grant        Cloud 针对租户、用户、设备和有效期签发的短期授权
Peer Authentication 每条 SD-WAN 连接使用 Grant、TLS exporter 和 nonce 完成认证
```

Cloud Session 过期不应直接删除设备密钥；设备密钥撤销则必须停止所有数据面连接。Refresh Token 只能用于恢复 Cloud Session，不能直接作为 SD-WAN Peer 凭据。

### 5.4 认证扩展接口

Cloud 统一抽象：

```text
AuthProvider
  PasswordAuthProvider      # 第一阶段实现
  OidcAuthProvider           # 预留
  SamlAuthProvider           # 预留
  EnterpriseAuthProvider    # 预留
  MfaProvider                # 预留
```

统一输出：

```text
AuthenticatedPrincipal
  user_id
  tenant_id
  roles
  auth_source
  session_id
  assurance_level
```

第一阶段使用：

```text
auth_source = password
assurance_level = password
```

## 6. 设备注册和授权

设备密钥由客户端生成，然后向 Cloud 注册公钥：

```text
用户认证成功
  -> 生成 device_keypair
  -> 上传 device_id、platform、public_key
  -> Cloud 校验用户和租户
  -> Cloud 签发 Device Grant
  -> 客户端保存 Grant 和私钥
```

Cloud 需要能够独立撤销：

- 用户会话；
- 单台设备；
- 用户全部设备；
- 某个租户或策略；
- 某个节点授权。

## 7. 策略和节点选路

### 7.1 PolicyProjection

```json
{
  "schema_version": 1,
  "projection_id": "...",
  "projection_type": "device_client",
  "tenant_id": "...",
  "user_id": "...",
  "device_id": "...",
  "audience": {
    "tenant_id": "...",
    "device_id": "...",
    "device_key_id": "..."
  },
  "generation": 42,
  "content_hash": "sha256:...",
  "not_before": 1790000000,
  "stale_until": 1790003600,
  "issued_at": 1790000000,
  "traffic_mode": "policy",
  "mode_capabilities": ["policy", "global"],
  "selected_node": {
    "node_id": "...",
    "endpoint": "...",
    "priority": 1,
    "node_key_id": "...",
    "transport": "quic",
    "assignment_lease_until": 1790003600
  },
  "standby_nodes": [
    {
      "node_id": "...",
      "endpoint": "...",
      "priority": 2,
      "node_key_id": "...",
      "transport": "quic",
      "assignment_lease_until": 1790003600
    }
  ],
  "allowed_resources": [
    {
      "name": "internal-git",
      "domains": ["git.example.com"],
      "cidrs": ["10.20.0.0/16"],
      "ports": [443]
    }
  ],
  "dns_projection": {},
  "signing_key_id": "cloud-policy-2026-01",
  "signature": "..."
}
```

客户端在应用前验证：

- Cloud 签名；
- `schema_version` 和 `projection_type`；
- tenant、user、device 绑定；
- `audience.device_key_id` 与本地密钥一致；
- generation 不回退；
- 当前时间位于 `not_before` 和 `stale_until` 约束内；
- `content_hash` 与规范化内容一致；
- 节点是否属于授权集合；
- 主备节点的 `assignment_lease_until` 未过期；
- 资源和路由是否存在冲突；
- underlay 排除规则是否完整。

### 7.2 节点选路

节点选路完全由 Cloud 完成。Cloud 综合节点在线状态、RTT、丢包率、负载、地域、租户约束、资源位置和主备关系，生成主节点及备用节点列表。

客户端只允许：

- 连接 Cloud 下发的主节点；
- 在已授权的备用节点中故障切换；
- 上报本地运行指标；
- 等待 Cloud 下发新的节点分配。

客户端不能根据本地测速选择未授权节点，也不能修改资源和节点绑定。

客户端故障切换规则：

1. 主节点失败后，只能按 Cloud 下发的备用节点优先级尝试；
2. 每次切换都要带上同一个 `projection_id`、generation 和 Device Grant；
3. 备用节点必须重新完成 Peer 认证，不能只凭 endpoint 建立连接；
4. 备用节点全部失败时进入 `DEGRADED`，不得自动发现或连接其他节点；
5. Cloud 下发新 Projection 或撤销 Grant 后，旧节点连接必须在有界时间内 drain 并关闭。

节点侧必须执行对应的授权检查：

```text
Peer Handshake
  -> 验证 Device Grant、设备密钥和租户
  -> 验证 projection_id、generation、content_hash
  -> 加载该 Grant 的资源访问集合
  -> 每个会话检查资源、端口、模式和有效期
  -> 通过后才建立数据流
```

客户端侧规则用于减少无效流量和提供快速失败；Node/Core 侧规则用于防止客户端被篡改后绕过 Cloud 授权。

## 8. 流量模式

### 8.1 策略模式

- Cloud 下发的资源进入 SD-WAN；
- 未授权企业资源拒绝访问；
- 普通互联网流量走本地网络；
- DNS 按 Cloud 下发的 DNS Projection 执行；
- `stale_until` 到期后，受保护资源 fail-closed；普通流量是否继续走本地网络由 Cloud 下发的 `degraded_behavior` 决定。

### 8.2 全局模式

全局模式是 Cloud 授权的运行模式，不是客户端绕过策略的本地开关。

Cloud 需要确认：

- 用户有全局模式权限；
- 设备有全局模式权限；
- 租户允许全局模式；
- 分配的节点支持 Internet 出口；
- DNS 出口已经配置。

所有用户流量通过 SD-WAN，但控制面、认证服务、底层连接和必要系统流量保留 underlay 排除。

全局模式必须在 Projection 中明确标识出口能力、DNS 出口、underlay 排除集合和降级行为。客户端不能仅根据一个本地 `global=true` 标志创建默认路由。

节点侧同样必须确认 `global` 已包含在 Device Grant 的模式权限中，并确认该节点具备 Cloud 分配的出口能力。客户端只创建 Cloud 已明确授权的默认路由。

## 9. 模式切换和配置应用

```text
用户点击模式切换
  -> 客户端向 Cloud 请求新模式
  -> Cloud 校验权限和节点能力
  -> Cloud 生成新的 PolicyProjection
  -> 客户端验证签名和 generation
  -> 预建立节点连接
  -> 预检查 TUN、DNS 和路由
  -> 原子切换流量
```

新配置应用失败时保留最后一个有效配置，不清空当前网络状态。

配置应用采用以下事务：

```text
received -> verified -> staged -> preflight_ok -> peers_ready -> committed
                                      \-> rejected / rolled_back
```

`committed` 前不得替换系统路由。Core 崩溃、TUN 失败、节点未达到最小就绪数或版本不兼容时，Agent 回滚到上一份仍在 `stale_until` 内的配置；超过期限则停止受保护流量并显示可操作错误。

## 10. 平台实现

| 平台 | 系统网络能力 | 后台实现 | 本地安全存储 |
|---|---|---|---|
| Windows | Wintun、IP Helper API | Windows Service | DPAPI |
| macOS | Network Extension、NEPacketTunnelProvider | Packet Tunnel Provider | Keychain/Secure Enclave |
| Android | VpnService、ConnectivityManager | Foreground Service | Android Keystore |

平台层负责 TUN、路由、DNS、网络切换、睡眠恢复和控制连接防递归；Rust Core 只接收 TUN 描述符并处理数据面。

平台层必须实现统一的 `PlatformNetworkAdapter` 能力契约：

```text
prepare(desired_state) -> PreparedNetwork
commit(prepared_network) -> NetworkLease
rollback(network_lease)
protect_control_socket(socket)
observe_network_changes() -> NetworkEvent
```

Windows Service、macOS Packet Tunnel Provider 和 Android `VpnService` 分别实现该契约。Flutter 只调用 Agent 的意图接口，例如 `connect`、`disconnect` 和 `requestTrafficMode`，不能直接调用系统路由或 VPN API。Agent 负责权限请求、生命周期和恢复，并返回 `permission_required`、`network_ready`、`tun_ready` 等结构化状态。

## 11. 本地控制接口

桌面端通过 Named Pipe/Unix Domain Socket 与 Agent 通信，Android 通过 Binder 或应用内 Service 通信。

```text
getStatus()
connect()
disconnect()
requestTrafficMode(mode)
getIdentity()
getPolicyStatus()
getDiagnostics()
logout()
```

本地状态至少拆分为：

```text
identity
control_plane
policy
node_assignment
data_plane
traffic
health
```

状态转换必须保留原因码和时间戳。例如 `identity=authenticated` 不得推导出 `data_plane=connected`；只有 Cloud 控制通道在线、Projection 有效、必要 Peer 已认证、TUN 已提交并完成路由检查后，数据面才可标记为 `connected`。

建议对外只暴露一个聚合状态，同时保留可诊断的内部状态：

```text
display = connected       当 data_plane=connected 且 health=healthy/degraded
display = connecting      当控制面或数据面正在建立
display = action_required 当需要登录、系统权限或升级
display = unavailable     当授权、策略或数据面不可用
```

## 12. 错误遥测

客户端上报结构化事件：

```text
event_id
timestamp
app_version
core_version
platform
device_id_hash
policy_generation
component
phase
error_code
retry_count
network_type
```

允许上报：连接状态、重连次数、RTT、丢包率、TUN 错误、策略应用结果、节点连接结果和 Core 崩溃摘要。

禁止上报：业务内容、密码、Token、私钥、完整 URL、完整五元组、原始策略签名和完整用户日志。

遥测通过独立控制通道发送，失败时限量缓存并指数退避，不能影响业务数据面。

遥测规则：

- `fatal`、认证撤销、策略拒绝和数据面完全中断事件立即上报；
- 普通状态事件按设备和 `event_id` 去重，并以 10 至 60 秒批量发送；
- 重连和链路指标采用固定上限采样，单设备单小时设置事件配额；
- 本地缓存使用环形队列，超过大小直接丢弃最旧的非关键事件；
- 事件中只保留资源类别、节点逻辑 ID 和哈希后的设备 ID，不上传业务内容和完整地址；
- Cloud 返回 `ack_id`，客户端按 ack 删除已确认事件，避免重复上报造成误判。

## 12.1 版本、升级和回滚

Flutter UI、Agent 和 Core 必须有独立版本号，同时发布一个兼容矩阵：

```text
ui_version
agent_version
core_version
protocol_schema_version
policy_schema_version
```

升级包由签名 manifest 描述，至少包含组件版本、目标平台、文件摘要、最低 Agent 版本、最低 Core 版本和回滚信息。安装流程为：下载、校验签名、安装到 inactive slot、启动自检、执行健康检查、切换 active pointer。新版本在规定时间内不能建立控制面或恢复最后有效数据面时，自动切回上一 slot。

用户退出登录时，Agent 需要撤销当前 Cloud Session、关闭数据面、删除短期 Grant 和本地策略缓存；设备密钥是否删除由“移除设备”操作决定。管理员撤销设备时，Cloud 应通过心跳和 Peer 控制通道通知客户端，客户端在通知失败时仍以 Grant 的有效期和本地撤销清单为准。

## 13. 可靠性和安全验收

第一阶段必须验证：

- 用户名密码认证、Token 轮换和 Cloud 注销；
- 设备注册、设备撤销和私钥保护；
- Projection 签名错误、过期和 generation 回退；
- Cloud 离线时的缓存策略边界；
- 策略模式和全局模式真实流量；
- DNS 泄漏和控制面递归；
- Windows/macOS/Android 网络切换和睡眠恢复；
- Core 崩溃、自动重启和路由回滚；
- 主节点故障及 Cloud 授权备用节点切换；
- 更新失败和版本回滚；
- 遥测脱敏和错误码完整性。

还必须加入以下矩阵：

| 类别 | 关键场景 | 成功条件 |
|---|---|---|
| 授权边界 | 改写 device_id、tenant_id、generation、mode 或 node_id | Projection 被拒绝，旧配置保持不变 |
| 撤销 | Cloud 撤销用户、设备和 Grant | 新连接被拒绝，现有数据面在有界时间内关闭 |
| 控制面中断 | Cloud 暂时不可用、长期不可用、策略到期 | 按 `stale_until` 和 `degraded_behavior` 执行，不无限期使用旧授权 |
| 选路 | 主节点失败、备用节点失败、Cloud 发布新节点 | 只使用授权节点，切换可观测，禁止隐式节点发现 |
| 路由事务 | TUN 创建失败、路由提交失败、Core 崩溃 | 不产生黑洞路由，能够回滚或安全停止 |
| 三端生命周期 | 网络切换、睡眠、重启、权限撤销 | 控制连接和数据面分别恢复，状态准确 |
| 版本兼容 | UI/Agent/Core/Projection 不匹配 | 预检查拒绝并提示可执行的升级动作 |
| 隐私遥测 | 高并发错误、重复发送、敏感字段注入 | 限流、去重、脱敏和确认删除均生效 |

## 14. 实施阶段

### Phase 1：合同和 Cloud MVP

- Cloud 用户、密码认证和会话；
- 设备注册和设备撤销；
- `PolicyProjection`、签名和 generation；
- 主节点/备用节点分配；
- Flutter 工程和三端基础页面；
- OIDC/SAML/MFA 接口预留。
- Projection 签名验证、stale lease 和配置事务；
- 版本化 Agent API 和六类独立状态；

### Phase 2：Windows/macOS

- Agent 和本地 IPC；
- TUN、路由和 DNS；
- 策略模式；
- 节点连接、重连和故障恢复；
- Cloud 授权主备集合内的有界故障切换；
- 错误遥测。

### Phase 3：Android

- `VpnService`；
- 前台服务；
- 网络切换和休眠恢复；
- Android Keystore；
- Always-on VPN 企业策略支持。

### Phase 4：全局模式和运营能力

- 全局模式权限控制；
- Internet 出口能力；
- Cloud 节点动态调度；
- 灰度升级和 A/B 回滚；
- 运维告警和远程诊断。

## 15. 最终职责边界

| 能力 | Cloud | Client |
|---|---:|---:|
| 用户认证 | 是 | 展示登录 |
| 用户和设备权限 | 是 | 执行 |
| 资源访问授权 | 是 | 执行 |
| 策略计算 | 是 | 验证、编译、应用 |
| 节点选路 | 是 | 连接、按授权主备恢复 |
| TUN/系统路由 | 否 | 是 |
| 数据包转发 | 否 | 是 |
| 健康指标采集 | 汇总分析 | 采集上报 |
| 软件发布 | 是 | 验证安装和回滚 |

最终产品形态：

```text
用户只看到：登录、连接、模式、状态、必要错误

系统自动完成：认证、授权、策略同步、节点连接、路由、DNS、重连、恢复、升级和遥测
```
