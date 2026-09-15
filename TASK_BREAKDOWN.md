# SD-WAN Client 研发任务清单

## 1. 使用规则

本清单是 `TECHNICAL_DESIGN.md` 的执行拆解。任务完成必须同时满足技术要求和验收要求；只有代码合并、单元测试通过或页面可打开，不能单独作为完成依据。

每项任务都有明确边界：

- Cloud 决定用户身份、权限、策略、模式授权和节点分配；
- Client 验证并执行 Cloud 下发的结果；
- SD-WAN Node/Core 在数据面再次执行授权；
- Flutter 只负责跨平台界面和用户意图；
- Agent 负责系统 VPN、TUN、路由、DNS、进程生命周期和本地 IPC；
- 任何未列入任务范围的能力都不应在实现过程中顺带加入。

## 2. 岗位角色

| 角色 | 主要责任 |
|---|---|
| 产品经理 PM | 用户流程、版本范围、业务验收和需求变更控制 |
| 总体架构师 SA | Cloud/Client/Node 边界、接口审查、技术决策 |
| Cloud 后端工程师 BE | 用户、设备、授权、策略、节点调度和 Cloud API |
| Rust/Core 工程师 CORE | Projection 验证、Peer、数据面和恢复机制 |
| Flutter 工程师 FLT | 三端共用 UI、状态展示和调用 Agent |
| Windows 工程师 WIN | Windows Service、Wintun、路由和安装包 |
| macOS 工程师 MAC | Network Extension、Keychain 和系统签名发布 |
| Android 工程师 AND | VpnService、前台服务、Keystore 和生命周期 |
| 安全工程师 SEC | 威胁建模、认证、授权、密钥、隐私和安全测试 |
| 测试工程师 QA | API、协议、平台、真实流量、恢复和发布验收 |
| SRE/运维工程师 SRE | Cloud 运行、节点健康、遥测、告警和灰度发布 |
| 技术文档/发布工程师 DOC | API 文档、运行手册、版本说明和交付清单 |

一个任务可以有多个协作角色，但必须指定一个直接负责人。PM 负责范围确认，SA 负责接口和边界评审，QA 负责最终验收证据。

## 3. 里程碑和完成定义

| 里程碑 | 目标 | 退出条件 |
|---|---|---|
| M0 合同冻结 | API、状态、错误码和安全边界可实现 | 关键接口评审通过，禁止无审批改字段 |
| M1 Cloud MVP | 用户、设备、策略和节点授权闭环 | 测试客户端可获得签名 Projection |
| M2 Client Core | 客户端能验证配置并建立数据面 | 策略模式真实流量通过，失败可回滚 |
| M3 Windows/macOS | 桌面端可安装、连接、恢复 | 两个平台通过网络切换和重启验收 |
| M4 Android | Android VPN 闭环 | 前台服务、网络切换和休眠恢复通过 |
| M5 运营发布 | 全局模式、遥测、升级和灰度 | 发布门禁、回滚和监控全部可用 |

通用完成定义：代码审查通过、接口文档更新、自动化测试通过、关键日志和遥测可观察、失败路径有证据、无超出边界的隐式行为。

## 4. M0：合同、边界和基础设施

### SDW-001 架构和职责基线

- 负责人：SA；协作：PM、SEC、BE、CORE、FLT、QA。
- 内容：冻结 Cloud、Client Agent、Rust Core、Node/Core、Flutter 的职责和调用方向。
- 技术要求：绘制控制面/数据面时序图；明确 Cloud 是认证、授权、策略计算和节点选路中心；定义客户端 fail-closed/fail-open 仅由 Cloud Projection 指定。
- 输出：架构决策记录、模块边界、依赖图、术语表。
- 验收：SA 和 QA 能根据文档判断每个新增需求归属；不存在 Client 自行授权或选未授权节点的接口。
- 边界：不实现代码，不引入 OIDC、SAML、MFA 和多路径传输。

### SDW-002 版本化合同和兼容矩阵

- 负责人：SA；协作：BE、CORE、FLT、QA。
- 内容：定义 Cloud API、Projection、Agent API、Core Process API 的版本规则。
- 技术要求：所有消息有 `schema_version`；定义向后兼容、未知字段、未知错误码、generation 和 content hash 规则。
- 输出：`contracts/` 下的 schema、示例和兼容矩阵。
- 验收：旧客户端收到新字段能安全忽略；不兼容版本在 preflight 阶段明确拒绝；schema 可自动校验。
- 边界：不实现业务 API，不改变现有 Candy wire protocol。

### SDW-003 错误码和状态模型

- 负责人：SA；协作：CORE、FLT、QA、SRE。
- 内容：定义 identity、control plane、policy、node assignment、data plane、traffic 六类状态及聚合显示状态。
- 技术要求：每个状态转换带 reason code、时间戳、generation 和可恢复性；定义 `action_required` 和 `unavailable` 的用户动作。
- 输出：状态机、错误码表、UI 映射表、遥测映射表。
- 验收：认证成功但策略未同步时不能显示 connected；TUN 失败、策略拒绝、节点不可用可区分。
- 边界：不在本任务中实现重连或 UI。

### SDW-004 开发、签名和测试环境

- 负责人：SRE；协作：QA、SEC、BE、CORE。
- 内容：建立本地 Cloud、测试 Node、模拟网络和三端构建环境。
- 技术要求：密钥分环境管理；测试环境可注入丢包、延迟、断网、节点故障和时间偏移；禁止使用生产凭据。
- 输出：环境说明、启动脚本、测试数据和 CI 基础流水线。
- 验收：新开发者可以按文档启动最小闭环；CI 能运行 schema、单元和安全扫描。
- 边界：不部署生产 Cloud，不制作正式发布证书。

## 5. M1：Cloud MVP

### SDW-101 预注册用户和密码认证

- 负责人：BE；协作：SEC、QA、PM。
- 内容：管理员创建用户、用户名密码登录、登出、密码重置和账号禁用。
- 技术要求：Argon2id；TLS；失败限速和临时锁定；短期 Access Token；Refresh Token 轮换、撤销和重放检测；防用户名枚举。
- 验收：正确密码登录成功；错误密码不泄露账号存在性；刷新 Token 后旧 Token 失效；禁用用户无法建立新会话。
- 边界：不实现自助注册、OIDC、SAML、企业登录和 MFA，只实现 `AuthProvider` 扩展接口。

### SDW-102 设备注册和设备撤销

- 负责人：BE；协作：SEC、CORE、QA、平台工程师。
- 内容：接收客户端公钥、绑定用户/租户/设备、签发和撤销 Device Grant。
- 技术要求：服务端验证用户会话；设备 ID 不可由客户端任意迁移；Grant 绑定 tenant、user、device、device_key_id、有效期和权限；撤销可按用户、设备和租户执行。
- 验收：改写设备或租户字段会失败；撤销后新 Peer 被 Node 拒绝；设备私钥不出端；Grant 过期不能建立新数据面。
- 边界：不负责系统密钥存储实现，不负责资源路由执行。

### SDW-103 资源和模式权限模型

- 负责人：BE；协作：PM、SA、SEC、QA。
- 内容：定义资源、用户角色、设备限制、策略模式/全局模式权限和 Internet 出口能力。
- 技术要求：权限判定集中在 Cloud；默认拒绝；全局模式需要租户、用户、设备、节点和出口能力同时满足；权限变更产生审计记录。
- 验收：无全局权限的用户无法得到 global Projection；未授权资源不出现在 Projection；权限撤销会生成新 generation 或撤销 Grant。
- 边界：不在客户端增加本地管理员策略，不实现动态脚本策略。

### SDW-104 PolicyProjection 生成、签名和发布

- 负责人：BE；协作：SA、SEC、CORE、QA。
- 内容：根据身份、设备、资源和模式生成设备专属 Projection。
- 技术要求：包含 `projection_id`、`audience`、`generation`、`content_hash`、`not_before`、`stale_until`、主备节点、模式能力、DNS、underlay 排除和 `degraded_behavior`；使用可轮换的 Cloud signing key。
- 验收：签名可独立验证；跨租户、跨设备、代次回退、过期、重复节点和默认路由缺少排除项时拒绝发布。
- 边界：Cloud 不向客户端下发完整租户策略数据库；不让客户端自行计算节点。

### SDW-105 Cloud 节点健康和授权选路

- 负责人：BE；协作：SRE、SA、QA、CORE。
- 内容：汇总节点在线状态、RTT、丢包、负载、地域和资源位置，生成主节点和有序备用节点。
- 技术要求：选路结果带 `assignment_lease_until`；只选择租户和资源授权范围内的节点；节点撤销立即从新 Projection 移除。
- 验收：输入健康数据可得到确定性选路；租约过期后客户端不能继续使用该分配；未授权节点永远不出现在结果中。
- 边界：客户端不进行未授权节点发现；本任务不实现任意多路径聚合。

### SDW-106 Cloud 控制通道和配置回执

- 负责人：BE；协作：CORE、SRE、QA。
- 内容：客户端拉取 Projection、心跳、撤销通知、回执和遥测上传接口。
- 技术要求：控制通道与业务数据面独立；支持配置 received/verified/staged/committed/rejected 回执；接口幂等；控制面地址进入 underlay 排除。
- 验收：Cloud 掉线不影响测试数据面在有效租约内运行；配置拒绝和回滚可查询；控制连接不会进入自身 TUN。
- 边界：不承载业务数据包，不实现 Node 转发。

### SDW-107 终端设备注册和 Client Grant/Projection 接口

- 负责人：BE；协作：SA、SEC、CORE、QA、SRE。
- 内容：在现有人类会话和节点 enrollment 之外，定义终端客户端公钥注册、Device Grant、Client Projection、节点分配和撤销接口。
- 技术要求：终端设备注册必须由有效 Cloud Session 发起；设备公钥本地生成；Grant 与节点 Grant、Site/Segment Runtime 配置分开建模；Projection 绑定 tenant/user/device/device_key、模式、资源、主备节点、generation、content hash、时间窗和租约；所有写操作幂等并可审计。
- 输出：Cloud OpenAPI、数据库变更、权限矩阵、Projection 发布器和撤销时序图。
- 验收：客户端无法注册到其他租户；重复请求幂等；撤销用户/设备/Grant 后新 Peer 被拒绝且已有连接按时关闭；终端 Projection 不包含未授权资源和节点；与现有节点 enrollment、Grant 和 Runtime 配置测试通过。
- 边界：不改变现有 OpenWrt/Linux 节点 enrollment 和 `runtime_configuration_v1` 语义；不实现 OIDC/SAML/MFA；不把 Cloud 放入业务数据路径。

## 6. M2：Rust Client Core 和数据面

### SDW-201 Projection 验证和本地版本仓库

- 负责人：CORE；协作：SEC、BE、QA。
- 内容：实现 Projection schema、签名、audience、generation、时间窗、content hash 和 staging/active/rollback。
- 技术要求：规范化序列化；拒绝未知必需字段、签名 key 不信任、时间回拨、代次回退、跨设备绑定和过期配置；原子文件替换并恢复损坏状态。
- 验收：篡改任何授权字段都会失败；重启后 active 配置不损坏；失败配置不会替换 active；`stale_until` 到期自动停止受保护流量。
- 边界：不决定权限，不修改 Cloud 策略，不直接操作系统路由。

### SDW-202 QUIC/TLS 和 Peer 认证

- 负责人：CORE；协作：SEC、Node 工程师、QA。
- 内容：基于 TLS 1.3 建立控制和数据通道，使用 Device Grant、TLS exporter 和 nonce 完成 Peer 认证。
- 技术要求：服务端证书校验或 pinning；0-RTT 默认关闭；认证证明不可重放；明确 transport、authentication、policy rejected、fallback 错误。
- 验收：修改 Grant、nonce、tenant、device 或 generation 会被拒绝；重复 nonce 被拒绝；TLS 验证失败不发送业务数据。
- 边界：不实现自定义密码学、不改变 Cloud 用户密码认证。

### SDW-203 会话、策略执行和 DNS Projection

- 负责人：CORE；协作：SA、QA。
- 内容：将 TUN 流量转换为统一 Session，执行 Cloud 下发的域名/IP/端口资源匹配和 DNS 行为。
- 技术要求：客户端规则只做快速调度；拒绝未授权资源；DNS 结果和路由决定一致；连接、UDP 会话和队列有界；不得把控制面送入 TUN。
- 验收：策略模式只保护授权资源；未授权资源被拒绝；DNS 无泄漏；TCP、UDP 和必要 ICMP 真实流量可验证。
- 边界：不增加本地策略编辑器，不支持客户端自定义企业资源。

### SDW-204 主备故障切换和恢复

- 负责人：CORE；协作：BE、SRE、QA。
- 内容：实现 Cloud 授权主备集合内的重连、drain、切换和恢复。
- 技术要求：按优先级尝试；重新完成 Peer 认证；绑定 projection_id/generation/Grant；失败使用指数退避；新 Projection 到达后有序关闭旧连接；保留可诊断错误。
- 验收：主节点断开后在目标时间内切到授权备用节点；备用节点全部失败时不连接未知节点；Cloud 撤销后现有流量在有界时间内停止；重启能恢复或安全停止。
- 边界：不实现 Cloud 选路算法，不承诺跨不同出口透明迁移已有 TCP/NAT 流。

### SDW-205 Core 状态、指标和本地控制 API

- 负责人：CORE；协作：FLT、Agent 工程师、QA。
- 内容：输出六类内部状态、聚合状态、阶段、错误码、计数和 Core Process API。
- 技术要求：状态原子发布；指标按 PID、boot、generation 和 connection epoch 隔离；敏感字段脱敏；API 有版本和权限。
- 验收：UI 能区分 connecting、connected、degraded、action_required 和 unavailable；Core 崩溃前最后状态可诊断；不会输出 Token、密钥或完整业务地址。
- 边界：不实现 Flutter 页面，不负责系统通知。

## 7. M3：Flutter 三端共用 UI

### SDW-301 Flutter 工程和设计系统

- 负责人：FLT；协作：PM、SA。
- 内容：建立 Windows/macOS/Android 共用工程、主题、路由、状态管理、国际化和无障碍基础。
- 技术要求：UI 与 Agent API 解耦；禁止在 Dart 中实现路由、策略、节点和密钥逻辑；状态由版本化 DTO 驱动。
- 验收：三端共享同一套主要页面和状态映射；平台差异只通过 bridge；断开、加载和错误状态无闪烁误导。
- 边界：不实现 VPN 权限和后台服务。

### SDW-302 登录、设备注册和账号页面

- 负责人：FLT；协作：BE、平台工程师、QA。
- 内容：用户名密码登录、登出、设备名称、登录失效和必要重试。
- 技术要求：密码仅传给受保护的 Cloud API；Token 由 Agent 或安全存储管理；UI 不保存密码和私钥；支持 Cloud 返回的 `action_required`。
- 验收：成功登录后能完成设备注册；登出后策略和短期 Grant 清除；错误信息不泄露账号是否存在。
- 边界：不实现自助注册、OIDC/SAML 页面和 MFA 页面。

### SDW-303 主状态页和连接控制

- 负责人：FLT；协作：CORE、Agent 工程师、QA。
- 内容：显示连接摘要、策略版本、Cloud 状态、保护资源数量和连接开关。
- 技术要求：只调用 `connect`、`disconnect`、`getStatus` 等 Agent 意图 API；不得根据 UI 本地状态宣称 connected。
- 验收：状态与后台真实状态一致；重启 UI 不影响后台连接；Core/Agent 错误显示用户可执行动作。
- 边界：不展示节点列表、路由表、QUIC 参数和完整诊断日志。

### SDW-304 模式切换页面

- 负责人：FLT；协作：BE、CORE、QA。
- 内容：策略模式和全局模式开关、权限不可用提示和切换进度。
- 技术要求：切换必须请求 Cloud 新 Projection；全局模式由 Cloud 授权；切换期间显示 connecting/applying，不提前显示成功。
- 验收：无权限时开关不可用；Cloud 拒绝时旧模式保持；切换成功后流量按真实 Projection 验证。
- 边界：不在客户端写入 `global=true` 绕过 Cloud。

## 8. M3/M4：平台 Agent

### SDW-401 Agent 守护进程、本地 IPC 和权限模型

- 负责人：Agent 平台负责人；协作：WIN、MAC、AND、SEC、FLT。
- 内容：定义并实现 `prepare/commit/rollback/protect_control_socket/observe_network_changes` 能力和本地 IPC。
- 技术要求：IPC 版本化、最小权限、请求鉴权、请求幂等；UI 只能提交意图；Agent 管理 Core 生命周期和状态订阅。
- 验收：普通 UI 进程不能直接修改路由；未授权 IPC 请求失败；Agent 重启可恢复或清理孤儿网络资源。
- 边界：不允许 UI 直接调用系统 VPN API，不实现平台特定页面。

### SDW-402 Windows 网络适配

- 负责人：WIN；协作：CORE、SEC、QA、SRE。
- 内容：Windows Service、Wintun、路由/DNS、控制连接保护、服务恢复和安装卸载。
- 技术要求：服务 ACL；underlay 排除；原子路由提交和回滚；服务异常自动恢复；签名安装包。
- 验收：策略和全局模式真实流量正确；TUN 失败无黑洞路由；断网/切网/睡眠/服务重启后状态正确；卸载清理自有资源。
- 边界：不实现 Cloud 权限和节点选路，不修改第三方路由。

### SDW-403 macOS 网络适配

- 负责人：MAC；协作：CORE、SEC、QA。
- 内容：Network Extension、NEPacketTunnelProvider、Keychain、权限提示和签名公证。
- 技术要求：扩展生命周期独立于 Flutter；控制连接 `exclude`；Keychain access group 正确；系统升级和扩展重启安全。
- 验收：首次授权、拒绝授权、撤销授权均有正确状态；切网、睡眠、重启恢复；策略/全局流量和 DNS 验证通过；应用签名和公证可安装。
- 边界：不使用未授权系统扩展，不实现 macOS 独有的策略编辑功能。

### SDW-404 Android VPN 适配

- 负责人：AND；协作：CORE、SEC、QA、FLT。
- 内容：VpnService、Foreground Service、Keystore、ConnectivityManager 和通知。
- 技术要求：控制 socket 使用 `protect`；正确处理 Android 版本权限；前台服务可恢复；网络变化不泄漏 DNS；支持 Always-on 的 Cloud 策略限制。
- 验收：用户授权/拒绝 VPN 均可恢复；Wi-Fi/蜂窝切换、休眠、进程重启通过；VPN 未连接时无残留路由；Keystore 私钥不可导出。
- 边界：不依赖 Android root，不提供自定义代理配置编辑器。

## 9. M4：安全、遥测、升级和运维基础

### SDW-501 双侧授权执行

- 负责人：SEC；协作：CORE、Node 工程师、BE、QA。
- 内容：实现 Node/Core 对 Device Grant、Projection、资源、端口、模式、租户和 generation 的数据面二次校验。
- 技术要求：每个新会话检查有效期和撤销；Grant 撤销关闭已有绑定会话；拒绝结果不能泄露策略细节；审计事件不含业务内容。
- 验收：篡改客户端规则后仍无法访问未授权资源；改写 node、mode、tenant、device 或 generation 的请求被拒绝；撤销在目标时间内生效。
- 边界：不把 Cloud 的完整策略数据库复制到 Node，不允许 Node 自行扩大授权范围。

### SDW-502 错误遥测和隐私

- 负责人：SRE；协作：SEC、CORE、BE、QA、FLT。
- 内容：客户端事件采集、批量、限流、去重、ack、Cloud 接收和告警。
- 技术要求：事件等级；fatal/撤销/策略拒绝及时上报；普通事件 10 至 60 秒批量；设备和事件配额；环形缓存；敏感字段禁止上报。
- 验收：高并发错误不会造成遥测风暴；重复事件可去重；ack 后可删除；抓包和日志扫描确认没有 Token、密码、私钥、完整 URL、五元组和业务内容。
- 边界：不上传默认关闭的用户行为分析，不以遥测失败阻断业务数据面。

### SDW-503 签名升级、A/B 和回滚

- 负责人：SRE；协作：SEC、WIN、MAC、AND、CORE、QA。
- 内容：Flutter、Agent、Core 的签名 manifest、兼容矩阵、inactive slot、自检和回滚。
- 技术要求：校验目标平台、摘要、签名、最低版本和回滚信息；新版本必须先通过控制面、Projection 和数据面健康检查；保留上一可用版本。
- 验收：篡改安装包拒绝安装；版本不兼容在切换前拒绝；升级失败自动恢复旧版本；用户数据、设备密钥和撤销状态按策略保留。
- 边界：不自动升级 Cloud 数据库，不绕过系统签名要求。

### SDW-504 Cloud 和节点运行监控

- 负责人：SRE；协作：BE、CORE、QA。
- 内容：控制面成功率、认证失败、Projection 拒绝、节点健康、数据面阶段和客户端错误告警。
- 技术要求：区分 registered/authenticated/online/active/degraded/failed；按租户、平台、版本和错误码聚合；告警有抑制和恢复条件。
- 验收：模拟 Cloud 掉线、节点分区、策略签名错误和大规模重连能产生可定位告警；告警不包含秘密和业务内容。
- 边界：不把客户端本地指标直接当作 Cloud 事实，必须标明采集时间和来源。

## 10. M5：QA 和发布验收任务

### SDW-601 合同和安全自动化测试

- 负责人：QA；协作：SEC、BE、CORE。
- 内容：schema、签名、时间窗、重放、audience、generation、撤销和错误码测试。
- 技术要求：每个拒绝路径有断言；覆盖字段篡改、未知必需字段、时间回拨、重复 nonce 和错误权限组合。
- 验收：CI 稳定运行；任何授权边界回归都会阻断合并；测试报告保留输入、结果和版本。
- 边界：不以 mock 成功代替真实流量验收。

### SDW-602 三端系统和生命周期测试

- 负责人：QA；协作：WIN、MAC、AND、FLT。
- 内容：权限、安装、启动、停止、网络切换、睡眠、重启、升级和卸载。
- 技术要求：使用受支持系统版本矩阵；记录平台、Agent、Core、UI 版本；检查残留 TUN、路由、DNS 和进程。
- 验收：三端均能完成登录、连接、模式切换、断开和恢复；失败状态能对应到明确错误码。
- 边界：模拟器测试不能替代至少一轮真实设备测试。

### SDW-603 真实 SD-WAN 流量和故障测试

- 负责人：QA；协作：CORE、SRE、Node 工程师。
- 内容：策略模式、全局模式、TCP、UDP、DNS、节点主备、Cloud 中断和策略到期。
- 技术要求：使用真实 TUN/QUIC/Node 路径；注入丢包、延迟、MTU、节点断连、Cloud 分区和 ACK 丢失；采集数据面阶段和遥测。
- 验收：授权资源可达、未授权资源不可达；无 DNS 泄漏；主备切换只使用授权节点；无黑洞路由；超出 stale lease 后受保护流量停止。
- 边界：本地单元测试、模拟 loopback 或仅建立 QUIC 连接不能标记本任务通过。

### SDW-604 发布门禁和交付包

- 负责人：DOC；协作：QA、SRE、SEC、PM。
- 内容：版本说明、已知限制、安装包、签名摘要、兼容矩阵、测试报告、回滚手册和运维手册。
- 技术要求：所有平台产物可追溯到 commit、构建环境和 manifest；未通过的测试标记 skipped/blocked，不能标成 passed。
- 验收：PM、SA、SEC、QA、SRE 联合签字；能按文档安装、连接、回滚和定位常见错误。
- 边界：不把未完成的 OIDC/SAML/MFA、iOS、Linux 桌面或企业 MDM 功能写入本版本已交付能力。

## 11. 依赖关系

```text
SDW-001/002/003
       -> SDW-101/102/103
       -> SDW-104/105/106
       -> SDW-201/202/203/204/205
       -> SDW-401/402/403/404
       -> SDW-301/302/303/304
       -> SDW-501/502/503/504
       -> SDW-601/602/603/604
```

其中：

- SDW-104、SDW-201 和 SDW-501 必须使用同一份 Projection 合同；
- SDW-105 的节点分配结果是 SDW-204 的唯一切换范围；
- SDW-401 是三个平台 Agent 的共同接口，平台实现不能绕过；
- SDW-003 是 UI 状态、Core 状态和遥测状态的共同来源；
- SDW-603 通过前置自动化测试后，才能作为发布证据。

## 12. 明确排除项

本版本不包含：

- OIDC、SAML、企业登录和 MFA 的实际登录流程；
- 客户端自助注册和客户端自定义企业策略；
- 客户端自主节点发现和未授权节点测速选路；
- Cloud 承载业务数据面；
- 客户端修改 Node/Core 授权范围；
- iOS 客户端；
- 多路径聚合、动态路由协议和自定义密码学；
- 透明迁移不同公网出口下已有 TCP/NAT 连接。

任何新增范围都必须由 PM 创建变更项，由 SA 评估接口、安全和验收影响后进入后续版本。
