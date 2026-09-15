# ADR-001：Cloud 统一控制面权威

状态：Accepted

## 决策

Cloud 是用户身份、设备授权、资源访问权限、策略模式/全局模式权限和节点选路的唯一权威来源。

客户端只验证并执行 Cloud 签发的 `PolicyProjection`。SD-WAN Node/Core 对 Device Grant 和 Projection 在数据面再次执行授权检查。

## 原因

客户端运行在用户设备上，不能作为最终的访问控制边界。本地规则用于快速调度和减少无效流量；最终资源授权必须在服务端数据面再次检查，防止修改客户端后访问未授权资源。

Cloud 不承载业务数据面。客户端根据 Cloud 的节点分配直接连接授权 Node，Node 使用 Grant 和 Projection 验证业务会话。

## 强制约束

- 客户端不能选择 Cloud 未下发的节点；
- 客户端不能增加资源、端口、模式或默认路由权限；
- 缓存 Projection 只能使用到签名的 `stale_until`；
- 节点分配只能使用到 `assignment_lease_until`；
- 用户退出、设备撤销或 Grant 撤销必须关闭相关数据面；
- Projection 的签名输入和 canonicalization 必须跨 Cloud/Core 一致；
- 任何不兼容或无法验证的高权限配置必须拒绝应用。

## 后果

Cloud 需要维护用户、设备、Grant、Projection、节点健康和撤销状态。客户端需要实现签名验证、版本仓库、状态机和受限故障切换。Node/Core 需要保留 Grant 到资源权限的运行时映射。
