# 合同兼容矩阵

## 版本字段

客户端状态和发布物必须同时记录：

```text
ui_version
agent_version
core_version
protocol_schema_version
policy_schema_version
```

## 当前基线

| Consumer | Contract | Version | 兼容规则 |
|---|---|---:|---|
| Cloud | Password/Auth API | v1 | 新增可选字段；认证语义不得静默改变 |
| Cloud/Client | PolicyProjection | v1 | 未知必需字段拒绝；未知可选字段可忽略 |
| Client/Node | Device Grant/Peer auth | v1 | 认证上下文必须包含版本和 generation |
| Agent/Flutter | Agent API | v1 | 请求和响应带 `api_version`；不兼容时返回 `version_incompatible` |
| Agent/Flutter | AgentStatus | v1 | 状态枚举扩展必须先更新 UI 映射 |
| Client/Cloud | Telemetry event | v1 | 未知事件字段可忽略，错误码必须来自注册表 |

## 不兼容变更

下列变化必须提升主版本或建立新 endpoint：

- 删除必需字段；
- 改变字段类型或枚举含义；
- 改变签名输入或 canonicalization；
- 改变 fail-closed/fail-open 语义；
- 改变节点授权或撤销时限；
- 改变 Agent IPC 的权限模型。

不允许通过“兼容解析”继续运行高权限、安全和授权语义不明确的配置。

## Projection 签名合同

签名输入必须明确、可复现：

```text
signed_payload = Projection 的全部字段，排除 signature 和 content_hash
canonical_bytes = RFC 8785 JCS(signed_payload)
content_hash = SHA-256(canonical_bytes)
signature = Ed25519.Sign(signing_key, "candy/sdwan/policy-projection/v1" || content_hash)
```

验证顺序：验证 signing key id、签名、content hash、audience、时间窗、generation、节点租约和本地版本兼容性。实际实现使用的 canonical JSON 库必须在 Cloud、Core 和测试工具中保持一致。

## 时间和缓存

- `not_before` 之前不能应用；
- `stale_until` 之后不能继续使用；
- `grant_expires_at` 之后不能建立或保持新的 Peer 会话；
- `assignment_lease_until` 之后不能使用对应节点；
- 客户端时间不可信时必须执行受控的时间偏差策略，并记录 `clock_skew`；
- 用户退出、设备撤销或收到撤销通知时，短期授权立即失效。
