# SD-WAN Client

面向 Windows、macOS 和 Android 的 SD-WAN 终端客户端设计与研发任务。

## 文档

- [技术实现方案](./TECHNICAL_DESIGN.md)
- [详细任务清单](./TASK_BREAKDOWN.md)
- [Cloud 集成基线](./contracts/cloud_integration.md)
- [M0 执行状态](./TASK_STATUS.md)

## 当前基线

- UI：Flutter 三端跨平台方案；
- 控制中心：Cloud 统一负责用户认证、设备授权、策略计算和节点选路；
- 认证 MVP：Cloud 预注册用户名密码；
- 认证扩展：代码层预留 OIDC、SAML、企业登录和 MFA；
- 客户端：验证并执行 Cloud 签名下发的 Projection；
- 数据面：客户端直接连接 Cloud 授权的 SD-WAN Node；
- 权限执行：客户端调度与 Node/Core 数据面校验双重执行。

M1 当前已冻结终端 Cloud 控制合同：见 [`contracts/client_control.md`](./contracts/client_control.md) 和 [`contracts/client_control.schema.json`](./contracts/client_control.schema.json)。该合同与节点 enrollment、Node Grant、`runtime_configuration_v1` 分离。

## 目录约定

```text
sdwan-client/
  flutter-ui/
  platform-bridge/
  client-agent/
  client-core/
  contracts/
  docs/
```

当前目录保存设计和任务基线，实际代码目录按 M0 合同冻结任务建立。

## M0 本地验证

需要 Node.js 20+ 和 npm：

```sh
npm ci
./scripts/check-m0.sh
```

启动合同级 Cloud/Node 模拟环境：

```sh
npm run dev:env
```

可用故障注入变量：`SDWAN_TEST_FAULTS=cloud-offline,node-offline`、`SDWAN_TEST_DELAY_MS=200`、`SDWAN_TEST_DROP_PERCENT=10`、`SDWAN_TEST_CLOCK_OFFSET_SECONDS=120`。该环境只模拟投影获取、撤销和 Peer 授权检查，不承载业务数据包，也不使用生产凭据。
