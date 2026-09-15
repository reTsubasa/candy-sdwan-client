# Agent API v1

## 目标

Agent API 是 Flutter UI 与本地后台服务之间的稳定边界。Flutter 发送用户意图，Agent 负责权限、系统 VPN、TUN、路由、DNS、Core 生命周期和状态订阅。

Flutter 不得直接修改系统网络，也不得保存用户密码、设备私钥、Refresh Token 或 Device Grant。

## 传输

| 平台 | IPC | 认证 |
|---|---|---|
| Windows | Named Pipe | Pipe ACL + 进程身份 |
| macOS | Unix Domain Socket / XPC bridge | 文件权限 + code signing identity |
| Android | Binder/应用内 Service | 同签名应用 UID + Binder 权限 |

所有请求携带。单帧使用 JSON UTF-8 编码，最大 64 KiB；超限返回 `request_too_large`，禁止截断。Transport 层必须提供 request/response correlation，并在 10 秒无响应后返回超时；取消只取消尚未提交的操作，不能中断已提交的系统网络变更。

```json
{
  "api_version": 1,
  "request_id": "uuid",
  "method": "get_status",
  "payload": {}
}
```

响应携带：

```json
{
  "api_version": 1,
  "request_id": "uuid",
  "method": "get_status",
  "ok": true,
  "payload": {}
}
```

失败响应：

```json
{
  "api_version": 1,
  "request_id": "uuid",
  "ok": false,
  "error": {
    "code": "tun_permission_required",
    "retryable": false,
    "user_action": "grant_permission"
  }
}
```

## 方法

| 方法 | 请求 | 行为 |
|---|---|---|
| `get_status` | 空 | 返回完整 `AgentStatus` |
| `connect` | 空 | 请求 Agent 应用当前 Cloud Projection |
| `disconnect` | 空 | 停止数据面并回滚自有网络资源 |
| `request_traffic_mode` | `{mode}` | 向 Cloud 请求新模式，不直接修改本地模式 |
| `get_identity` | 空 | 返回脱敏用户、租户、设备和认证状态 |
| `get_policy_status` | 空 | 返回 Projection ID、generation、状态和更新时间 |
| `get_diagnostics` | `{scope}` | 返回脱敏诊断摘要 |
| `logout` | 空 | 撤销 Cloud Session、关闭数据面并清理短期授权 |
| `subscribe_status` | 空 | 订阅状态变化；断线后以完整快照恢复 |
| `get_capabilities` | 空 | 返回 Agent API、平台和功能能力；UI 据此隐藏不可用能力 |
| `cancel` | `{target_request_id}` | 取消尚未提交的同一 IPC 请求 |

## 方法约束

- `connect`、`disconnect` 和 `request_traffic_mode` 必须幂等；
- `request_traffic_mode` 的成功只表示 Cloud 接受请求，最终成功以状态 `data_plane=connected` 为准；
- Agent 在 `committed` 前不得替换系统路由；
- IPC 断开不能停止后台数据面；
- Flutter 重启后必须通过 `get_status` 重新同步完整状态；
- Agent 返回的错误必须来自 `contracts/error_codes.json`；
- 未知的 `api_version` 或必需字段必须明确拒绝。
- Agent 启动后 UI 应先调用 `get_capabilities`；能力列表不是授权结果，global 是否可用仍以 Cloud Projection 和状态为准。
- `subscribe_status` 使用完整快照加增量事件；断线重连后必须先发完整快照，事件不得跨 `boot_id` 或旧 `generation` 继续解释。
- 请求超时、取消和重复 `request_id` 必须是可观测的独立阶段；重复请求返回第一次结果或明确 `request_in_progress`，不得重复提交路由变更。

## 版本与安全边界

- Windows Named Pipe、macOS UDS/XPC、Android Binder 只允许受信任 UI/服务身份访问；系统 ACL/签名校验在 Agent 层完成。
- IPC 帧不得携带密码、私钥、Refresh Token 或完整 Device Grant；登录凭据只经 Cloud TLS API 由 Agent 处理。
- `get_identity`、`get_policy_status` 和 `get_diagnostics` 默认脱敏，禁止返回节点私钥、Token、完整业务地址和五元组。
- 所有方法必须在方法名、`api_version` 和 payload 校验完成后再执行业务逻辑；未知字段在高权限请求中拒绝。

## 状态聚合

```text
display=connected       data_plane=connected 且 health=healthy/degraded
display=connecting      控制面、策略或数据面正在建立
display=action_required 需要登录、系统权限或升级
display=unavailable     授权、策略或数据面不可用
```

单个 `identity=authenticated`、`control_plane=online` 或 `policy=active` 都不能单独推导出 `display=connected`。
