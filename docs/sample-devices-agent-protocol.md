# 样机 Agent 协议与设备管理

本文是「样机设备管理」板块（模块 id `sample-devices`）的接口契约手册，覆盖管理端 API、Agent 通信协议、数据模型、部署包结构和排障要点。阅读对象是维护这套系统的开发与运维人员。

样机设备管理由原 Python 项目 `batch-shutdown-assistant`（Python 管理端 + Go Agent）整体并入本系统，`v0.9.0` 起作为第六个业务板块运行，`v0.10.0` 起与管理端合并到同一个 8900 端口。原项目已停止维护，所有功能以本文为准。

## 1. 板块定位

- Portal 路由：`/#/sample-devices`
- 独立 SPA：`/modules/sample-devices/`
- 管理端 API：`/api/sample-devices`
- Agent 契约 API：`/api/agents`
- Agent WebSocket：`/ws/agents/{device_id}`、`/ws/tasks/{task_id}`
- 数据表：`store.sqlite` 中的 `sample_devices_*` 前缀表
- 端口：与管理端共用 8900，**不再有独立 Agent 端口**

该板块与其他五个板块的业务数据完全隔离，只共用同一个 SQLite 文件和同一套进程与端口。

## 2. 单端口架构

`v0.9.x` 及更早版本中，Agent 通信需要独立进程与独立端口，部署包里 `deploy.conf` 的 `server=` 必须写 Agent 端口。`v0.10.0` 起收敛为单端口，部署包里写的地址就是门户地址。

```text
Windows 样机（LanAgent.exe）
  |
  |  1. POST /api/agents/heartbeat   每 15 秒，HTTP
  |  2. WS   /ws/agents/{device_id}?token=...   长连接收指令
  v
Express 5 统一服务 :8900
  |-- /api/agents/*        Agent 契约（心跳 / 恢复 / 版本）
  |-- /api/sample-devices  管理端 CRUD 与任务下发
  |-- /ws/agents/*         Agent 指令通道
  |-- /ws/tasks/*          任务结果实时推送
  `-- /ws 与 HTTP 共用 httpServer
```

合并后有三个必须同时满足的约束，改动 `apps/server/src/server.js` 时不要破坏：

1. **挂载顺序**：Agent 契约路由必须挂在 `app.use('/api', 404 兜底)` 之前，否则 `/api/agents/*` 会被兜底 404 吃掉。
2. **数据库注入**：Agent 路由通过 `req.app.locals.sampleDevicesDb()` 取库，必须在挂载前执行 `app.locals.sampleDevicesDb = getSampleDevicesDatabase`。
3. **WS 绑定**：`createAgentWebSocketServer({ server: httpServer })` 必须使用 `app.listen()` 返回的同一个 `httpServer`，不能新建监听。

Agent 路径前缀 `/api/agents`、`/ws/agents`、`/ws/tasks` 会显式清空 `Access-Control-Allow-Origin`，避免向任意来源暴露管理端接口；这组路径有独立鉴权，不参与门户的同源 CORS 策略。

## 3. Agent 通信契约

### 3.1 心跳

```http
POST /api/agents/heartbeat
Authorization: Bearer <设备令牌>
X-Enroll-Secret: <注册密钥>
Content-Type: application/json
```

每 15 秒一次。请求体是设备自报信息，字段既可直接放顶层，也可放在 `device` 或 `info` 子对象下；服务端两者都读。

可上报字段：`hostname`、`ip`、`os_info`、`agent_version`、`cpu_model`、`cpu_cores`、`memory_total_mb`、`disk_total_gb`、`disk_free_gb`、`os_version`、`serial_number`、`mac_address`、`manufacturer`、`model`、`rearm_count`、`group_name`。

响应统一使用信封结构，业务字段全在 `data` 内：

```json
{
  "code": 0,
  "data": {
    "action": "ok",
    "device_id": 26,
    "token": "abc123",
    "commands": [
      { "command_id": "uuid", "task_id": 12, "task_type": "SHUTDOWN", "payload": null }
    ],
    "offline_selfdestruct_hours": 0
  },
  "msg": "success"
}
```

`action` 有四种取值，Agent 必须按 `data.action` 分支处理：

| action | 含义 | Agent 应做什么 |
| --- | --- | --- |
| `ok` | 已登记设备正常心跳 | 更新本地令牌（如有轮换），执行 `commands` |
| `created` | 首次注册成功，服务端已建记录 | 保存 `device_id` 与 `token`，之后用数字 `device_id` 连接 WS |
| `re-enrolled` | 令牌不一致但注册密钥有效，服务端重新收养 | 更新令牌，执行 `commands` |
| `deleted` | 设备已被管理端删除 | 停止心跳与 WS，按离线自毁配置处理 |

失败响应：`401` + `{"code":1,"data":null,"msg":"设备未登记"}` 表示设备未登记且注册密钥无效；`401` + `msg:"设备令牌无效"` 表示令牌不一致且无有效注册密钥。

> **改代码时的头号陷阱**：`device_id`、`token`、`commands` 都在 `data` 里。早期 Agent 直接在顶层解析响应，`json.Unmarshal` 对缺失字段不报错、只给零值，结果是 `device_id` 永远为空、WS 连不上、指令全部下不去，而日志里没有任何报错。解析必须先解信封再解 `data`，`v1.7.6` 已修复。

### 3.2 设备识别与收养

服务端按以下顺序解析心跳身份：

1. 请求体 `device_id` 精确匹配：数字按主键查；非数字按 `token`、`serial_number`、`mac_address` 查；
2. 未命中则按请求来源 IP 兜底，取最近心跳的一条；
3. 仍未命中视为新设备，必须携带有效 `X-Enroll-Secret`，否则拒绝。

匹配到记录后比对令牌：一致即 `ok`；不一致时若带有效注册密钥则 `re-enrolled`（原设备被删除的也会被收养并清空 `deleted_at`），否则 `401`。

### 3.3 IP 自动更正

设备 IP 每次心跳都会校正，规则如下：

- Agent 自报的 `ip` 优先，多网卡时比连接来源地址更准确；
- 只接受可用地址：必须是合法 IPv4，且排除 `127.x.x.x`、`169.254.x.x`、`0.0.0.0`；
- 自报地址不可用时退回连接来源 IP；
- 两者都不可用时**保留原 IP 不覆盖**，因此设备断网期间管理端仍能看到最后一次的有效地址；
- 网络恢复或换网后，下一次心跳即写入新 IP，无需人工修改。

### 3.4 WebSocket 指令通道

```text
ws://<服务器>:8900/ws/agents/{device_id}?token=<设备令牌>
```

握手阶段校验：设备存在、令牌一致、设备未被删除。不满足时分别返回 `401`、`401`、`410 Gone` 并断开。

`{device_id}` 三种写法都接受：自增数字主键、迁移前的 UUID（`legacy_id` 列）、令牌本身。这是为兼容迁移前的老 Agent 保留的，新装设备使用数字主键。

同一设备重连时，旧连接会被 `4002 Replaced by newer connection` 关闭，只保留最新一条。

服务端下发指令的 JSON：

```json
{ "id": "<command_id uuid>", "action": "shutdown", "params": {} }
```

`action` 一律小写。库里存的是大写任务类型，`sendCommand` 发送前统一转小写；Agent 按小写分发，大小写不一致会全部落入 default 分支静默忽略——这也是历史上"指令下发无反应"的原因之一。

Agent 回报结果：

```json
{ "command_id": "<uuid>", "status": "success", "output": "..." }
```

`command_id` 与 `id` 均可作为标识字段。`output` 超过 100000 字符会被截断并附注总长度。`SYSINFO` 任务若 `status` 为 `success` 且 `output` 是合法 JSON，服务端会把其中的硬件字段写回设备记录并更新时间戳。

### 3.5 Sysprep 恢复上报

```http
POST /api/agents/recover
Authorization: Bearer <设备令牌>
```

Sysprep 执行后设备身份被重置，重启后用它重新声明在线状态。请求体需带 `device_id`，可选 `hostname`（`hostname_locked` 时忽略）。设备不存在返回 `404`，令牌不一致返回 `401`。

### 3.6 最新 Agent 版本

```http
GET /api/agents/latest
```

返回最近一次心跳非空设备上报的 `agent_version`，用于管理端「远程升级」弹窗预填版本号。无缓存，始终读库。

## 4. 管理端 API

所有路径以 `/api/sample-devices` 为前缀，响应统一为 `{code, data, msg}`，`code=0` 表示成功。

### 4.1 设备

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/devices` | 设备列表，支持 `status`（`online`/`offline`）、`group`、`search`（主机名/IP/序列号）、`page`、`size` |
| `GET` | `/devices/stats` | 总数、在线数、离线数 |
| `GET` | `/devices/groups` | 已有分组名列表 |
| `POST` | `/devices` | 手工新增设备 |
| `PUT` | `/devices/:deviceId` | 修改主机名（同时锁定）、IP、分组 |
| `DELETE` | `/devices/:deviceId` | 删除单台，在线时先下发 `uninstall` |
| `POST` | `/devices/batch-delete` | 批量删除，在线设备逐台下 `uninstall` |
| `POST` | `/devices/batch-group` | 批量设置分组 |
| `POST` | `/devices/import/ip-range` | 按 IP 段批量导入，单次最多 1024 个 |
| `POST` | `/devices/import/csv` | 按行导入，返回新增/跳过/错误明细 |

列表排序固定为：在线置顶、离线沉底；同状态内按 IP 数值升序（无 IP 的排最后），再按主机名。IP 比较用整数换算，`192.168.2.9` 不会排到 `192.168.2.10` 后面。

`hostname` 被手动修改后会置 `hostname_locked=1`，此后 Agent 心跳上报的主机名不再覆盖它。

删除是软删除：写 `deleted_at`，从列表与统计中消失，记录保留。删除时若 Agent 在线会顺手下发 `uninstall`，响应里的 `uninstall_sent` 表示是否真的送达。

### 4.2 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/tasks` | 最近任务列表，`limit` 上限 200 |
| `GET` | `/tasks/:taskId` | 任务详情与每台设备的执行结果 |
| `POST` | `/tasks` | 创建任务并立即下发 |
| `POST` | `/tasks/:taskId/cancel` | 取消任务 |

创建任务的请求体：

```json
{
  "task_type": "SHUTDOWN",
  "device_ids": [3, 7],
  "params": {},
  "operator": "local-user"
}
```

`task_type` 大小写不敏感，内部统一归一到大写。

支持的任务类型与 `params`：

| 任务类型 | 界面名称 | params | 说明 |
| --- | --- | --- | --- |
| `STATUS` | 状态检查 | 无 | 探测 Agent 状态 |
| `SYSINFO` | 采集设备信息 | 无 | 结果 JSON 回写设备硬件字段 |
| `HOSTMSG` | 弹窗提示 | `{title, message}` | 在样机屏幕弹窗 |
| `SYSPREP` | Sysprep 关机 | 无 | 执行 Sysprep 后关机 |
| `SYSPREP_REBOOT` | Sysprep 重启 | 无 | 执行 Sysprep 后重启 |
| `REBOOT` | 重启 | 无 | 普通重启 |
| `SHUTDOWN` | 关机 | 无 | 普通关机 |
| `RESET_PWD` | 清空账户密码 | 无 | 清空本地账户密码 |
| `UPGRADE` | 远程升级 | `{version}` | 升级 Agent 到指定版本 |
| `FILE_PUSH` | 文件分发 | `{filename}` | 推送已上传到服务器的文件 |

任务与结果状态流转：

```text
任务: PENDING → DISPATCHED → RUNNING → COMPLETED / FAILED / CANCELLED
结果: pending → sent → running → success / failed / cancelled / timeout
```

- 设备离线时子任务保持 `pending`，父任务为 `DISPATCHED`，期间可以正常取消；
- 设备上线或 WS 重连时，`dispatchPendingCommands` 自动补发所有 `pending` 子任务；
- 父任务终态由 `syncParentTask` 聚合：全 `success` → `COMPLETED`；含 `cancelled` 且其余只允许是 `success` → `CANCELLED`；其余 → `FAILED`；
- `UPGRADE` 任务有 5 分钟超时保护，超时的子任务置 `timeout` 并把父任务置 `FAILED`，避免升级失败的设备让任务永久挂起。

### 4.3 审计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/audit` | 分页审计日志，`page`、`size`（上限 200）、`action` |
| `GET` | `/audit/actions` | 已出现过的动作名列表 |

已记录的动作：`device.enrolled`、`device.re-enrolled`、`device.create`、`device.update`、`device.delete`、`device.batch-delete`、`device.batch-group`、`device.import-ip-range`、`device.import-csv`、`heartbeat.rejected`、`recover.rejected`、`task.create`、`task.cancel`、`agent.upload`、`file.upload`、`deploy.package`。

### 4.4 部署包与上传

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/deploy/server-url` | 返回当前应写入部署包的服务器地址 |
| `POST` | `/deploy/generate-token` | 预生成设备记录与令牌 |
| `POST` | `/deploy/package` | 生成 `LanAgent-Deploy.zip` |
| `GET` | `/uploads` | 已上传文件列表 |
| `POST` | `/uploads/agent` | 上传 `LanAgent.exe`，校验 PE 头 |
| `GET` | `/uploads/agent/latest` | 服务器上 Agent 的版本与大小 |
| `GET` | `/uploads/agent/latest/download` | 下载当前 Agent |
| `POST` | `/uploads/file` | 上传分发用文件 |
| `GET` | `/uploads/download/:filename` | 下载分发文件 |

上传上限 500MB；Agent 上传只接受 `.exe` 且必须是有效 Windows PE 文件。

## 5. 部署包结构

`POST /deploy/package` 生成的 ZIP 内含：

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `LanAgent.exe` | `LENOVO_STORE_AGENT_EXE`，未设置时为 `<projectRoot>/agent/LanAgent.exe` | Agent 本体 |
| `deploy.conf` | 服务端生成 | `server=<门户地址>`、`enroll=<注册密钥>` |
| `安装请阅读此文档.txt` | `LENOVO_STORE_INSTALLER_DIR/安装说明.txt` | 读不到外部文件时回退内置文案 |
| `uninstall.bat` | 内置 | 卸载脚本 |
| `reinstall.bat` | `LENOVO_STORE_INSTALLER_DIR/reinstall.bat` | 覆盖安装脚本，文件不存在则不打包 |
| `reset-password.bat` | `LENOVO_STORE_INSTALLER_DIR/reset-password.bat` | 重置密码脚本，同上 |

`deploy.conf` 里的 `server=` 现在写的是门户地址（8900），不是独立的 Agent 端口——这一条在单端口改造后已经变过，手工改配置时不要按旧文档写成其他端口。

**改文案不需要发版**：安装说明与两个 bat 脚本都在 `installerDir` 下按文件读取，直接替换 `/var/lib/lenovo-store-operations/resources/installer/` 里的文件即可，下次生成部署包时生效。只有 `LanAgent.exe` 本身更新才需要替换 `resources/agent/LanAgent.exe`，或在管理端重新上传。

这两个路径**不在仓库内**，属于持久化数据目录下的外部资源。生产部署应显式配置 `LENOVO_STORE_AGENT_EXE=/var/lib/lenovo-store-operations/resources/agent/LanAgent.exe` 与 `LENOVO_STORE_INSTALLER_DIR=/var/lib/lenovo-store-operations/resources/installer`；不配置时代码回退到 `<projectRoot>/agent` 与 `<projectRoot>/installer`，而这两个目录随 release 切换，放进去的文件会在升级后丢失。

## 6. 数据模型

所有表在统一库 `store.sqlite` 内，通过 `tableName('sample-devices', ...)` 生成带模块前缀的表名。

### 6.1 devices

主键 `id INTEGER AUTOINCREMENT`。字段分三组：

- 身份：`hostname`、`hostname_locked`、`ip`、`group_name`、`token`（唯一索引）、`legacy_id`（迁移前 UUID）
- 状态：`status`（`ONLINE`/`OFFLINE`）、`last_heartbeat`、`deleted_at`
- 硬件：`agent_version`、`cpu_model`、`cpu_cores`、`memory_total_mb`、`disk_total_gb`、`disk_free_gb`、`os_version`、`serial_number`、`mac_address`、`manufacturer`、`model`、`sysinfo_updated_at`、`rearm_count`、`os_info`

`ensureDeviceColumns` 在启动时补齐后加的列（当前是 `legacy_id`），因为 `CREATE TABLE IF NOT EXISTS` 不会修改已存在表的结构。新增列时同步在这里加 `ALTER TABLE`，否则老库升级后会因缺列报错。

### 6.2 tasks / task_results

`tasks` 记任务头：`task_type`、`target_count`、`status`、`payload`（JSON 字符串）、`created_by`、时间戳、`note`（跳过设备时写原因）。

`task_results` 记每台设备的执行：`task_id`、`device_id`、`command_id`（唯一索引）、`status`、`message`、`output`、`exit_code`、时间戳。`command_id` 唯一索引保证 Agent 重复回报不会产生重复行。

### 6.3 audit_logs / settings

`audit_logs`：`action`、`device_id`、`task_id`、`detail`、`source_ip`、`created_at`。

`settings`：键值表，`getSetting`/`setSetting` 读写，`updated_at` 随写更新。

## 7. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LENOVO_STORE_ENROLL_SECRET` | 空 | 注册密钥。为空时新设备无法注册、部署包无法生成，启动会打印警告 |
| `LENOVO_STORE_HEARTBEAT_WINDOW` | `90` | 心跳超时窗口（秒），超过即判离线 |
| `LENOVO_STORE_OFFLINE_SELF_DESTRUCT_HOURS` | `0` | 下发给 Agent 的离线自毁小时数，`0` 关闭 |
| `LENOVO_STORE_AGENT_EXE` | `<projectRoot>/agent/LanAgent.exe` | Agent 可执行文件路径；生产应指向 `resources/agent/` |
| `LENOVO_STORE_INSTALLER_DIR` | `<projectRoot>/installer` | 部署包内脚本与说明目录 |

`LENOVO_STORE_ENROLL_SECRET` 未配置时，管理端「生成部署包」直接返回 500；这是有意的失败快，避免发出装不上也注册不上的包。

## 8. 在线升级的模块白名单

`/usr/local/lib/lenovo-store-updater/updater.mjs` 里的 `CURRENT_MODULE_IDS` 是硬编码白名单：

```js
const CURRENT_MODULE_IDS = ['computer-labels', 'price-labels', 'receipt-assistant',
                            'employee-badges', 'sales-report', 'sample-labels', 'sample-devices']
const CURRENT_SQLITE_MODULE_IDS = new Set(['computer-labels', 'price-labels',
                                           'receipt-assistant', 'sample-devices'])
```

新增或改名板块时，必须同步发布包内 `ops/updater/updater.mjs` 的白名单并重装更新器，否则新版本会因为健康检查里模块集合不符而判定失败并自动回滚，表现为"升级总是回滚到上一个版本"。`sample-devices` 曾因为漏加白名单导致 `v0.9.0` 首次在线升级回滚。

## 9. 排障

### 9.1 下发指令无任何反应

按顺序排查：

1. **WS 是否连上**。管理端设备列表的"长连接在线"标记来自 `socket_connected`，只有该标记为真才能下发指令；离线或只有心跳没有 WS 时，指令会停留在 `pending` 等设备上线。
2. **看 Agent 日志有没有 `[ws] connected`**。没有就说明 WS 握手没过，检查路径里的 `device_id` 是否为空——空值的典型原因是心跳响应按顶层解析，见 3.1 的信封陷阱。
3. **看令牌是否一致**。握手 401 时服务端不建立连接，Agent 侧通常只表现为重连循环。
4. **看动作名大小写**。服务端已统一转小写；若自行改造过 `sendCommand`，确认没有把大写动作名发出去。
5. **看设备是否被删除**。`deleted_at` 非空的设备握手返回 `410 Gone`。

### 9.2 设备在线但 IP 是错的

Agent 多网卡时可能上报回环或链路本地地址。服务端有 `isUsableDeviceIp` 过滤，只接受可用 IPv4；若管理端显示的是连接来源地址而非 Agent 自报地址，说明 Agent 上报的地址被判为不可用，检查样机是否只接了被禁用的网段。

### 9.3 设备断网后显示离线，但 IP 还在

这是预期行为：不可用地址不覆盖已知 IP，断网期间保留最后一次有效地址，恢复联网后下一次心跳自动更正。

### 9.4 部署包安装后不注册

- 检查 `deploy.conf` 里的 `server=` 是否是可访问的门户地址、`enroll=` 是否与服务端 `LENOVO_STORE_ENROLL_SECRET` 一致；
- 服务端返回 `401 设备未登记` 说明注册密钥不匹配；
- 服务器未配置 `LENOVO_STORE_ENROLL_SECRET` 时，部署包根本无法生成，先补配置再重新打包。

### 9.5 心搏正常但硬件信息一直是"未采集"

硬件字段只由 `SYSINFO` 任务回写，心跳里的 `cpu_model` 等字段也会写入但 Agent 通常只在启动时采集一次。下发一次「采集设备信息」任务，看结果 `output` 是否为合法 JSON；解析失败时服务端静默跳过，不会报错。

### 9.6 删除设备后原机又自己回来了

删除时若 Agent 不在线，`uninstall` 没送达，样机重启后仍会心跳。带有效注册密钥的心跳会把已删除设备重新收养（`re-enrolled`）并清空 `deleted_at`。要彻底清理，先让设备在线再删除，或到样机上执行 `uninstall.bat`。

## 10. 与旧项目的关系

原 `batch-shutdown-assistant` 项目（Python FastAPI 管理端 + Go Agent，独立端口）的样机管理功能已全部并入本板块，包括设备台账、任务下发、Sysprep、远程升级、文件分发、审计日志与部署包生成。差异如下：

| 项目 | 旧项目 | 本系统 |
| --- | --- | --- |
| 管理端 | Python FastAPI，独立端口 | Node.js Express，与门户同端口 |
| 数据库 | 独立 SQLite 文件 | 统一 `store.sqlite`，模块前缀隔离 |
| 设备主键 | UUID | 自增整数，UUID 存 `legacy_id` 兼容 |
| 鉴权 | 设备令牌 | 设备令牌 + 注册密钥 |
| 备份 | 独立备份 | 并入统一 `.lsbackup`（设备表 + 任务表） |
| Agent | 同名 Go Agent | 同一 Agent，`v1.7.6` 起修复信封解析 |

Agent 本体仍是同一个 Windows 可执行文件，升级以本系统「远程升级」任务下发的版本为准。
