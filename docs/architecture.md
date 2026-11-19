# 架构与交互逻辑

本文说明联想门店运营系统的进程结构、模块边界、请求链路、数据归属和在线更新流程。业务功能清单见 [README](../README.md)，接口细节见 [模块接口](modules.md)，部署与运维见 [Ubuntu 部署指南](ubuntu-deployment.md)。

## 1. 运行时拓扑

一个 Node.js 进程同时承担 Portal 静态托管、8 个业务 SPA 的静态托管、后端 API、样机 Agent 契约与 WebSocket，以及系统维护接口。生产环境只有 8900 一个对外端口。

```mermaid
flowchart TB
    subgraph Client["浏览器（门店电脑）"]
        Portal["Portal 工作台<br/>hash 路由"]
        Frames["8 个业务 iframe<br/>同源 /modules/*"]
        Print["浏览器打印 / Canvas 合成"]
    end

    subgraph Server["Express 5 统一服务 :8900"]
        Static["静态托管<br/>Portal dist + modules/* dist"]
        API["业务 API<br/>/api/{module}"]
        Sys["系统 API<br/>/api/system"]
        Agent["Agent 契约 + WebSocket<br/>/api/agents、/ws/agents、/ws/tasks"]
    end

    subgraph Store["持久化数据根 $LENOVO_STORE_DATA_DIR"]
        DB[("store.sqlite<br/>WAL 模式")]
        Key["secrets/receipt-ocr.key"]
        Up["sample-devices/uploads/"]
        Res["resources/<br/>agent、installer"]
    end

    Cloud["GitHub Releases<br/>签名发布包"]
    Updater["root systemd oneshot<br/>/usr/local/lib/lenovo-store-updater"]
    Release["releases/version-commit<br/>current / previous"]
    AgentPC["门店样机<br/>LanAgent.exe"]

    Portal -->|"点击板块"| Frames
    Frames --> Print
    Frames -->|"fetch /api/*"| API
    Frames -->|"维护操作"| Sys
    Portal -->|"健康与更新检测"| Sys
    Static --> Portal
    Static --> Frames
    API --> DB
    Sys --> DB
    Sys --> Key
    API --> Up
    API --> Res
    AgentPC -->|"每 15s 心跳"| Agent
    AgentPC <-->|"指令 / 结果"| Agent
    Agent --> DB
    Sys -->|"写 0600 单任务文件"| Updater
    Updater -->|"下载并验签"| Cloud
    Updater -->|"原子切换"| Release
    Updater -->|"重启服务"| Server
```

关键约束：

- **同源**：Portal 通过同源 iframe 加载业务 SPA，不存在跨域调用，也不需要 CORS；维护接口另有严格同源校验。
- **单端口**：样机 Agent 的 HTTP 契约与 WebSocket 复用同一个 `httpServer`，没有独立 Agent 端口。
- **故障隔离**：业务板块之间不共享数据模型，只共享一个 SQLite 文件和一进程一端口。

## 2. 模块分层与数据归属

```mermaid
flowchart LR
    Shared["packages/shared<br/>板块元数据 / 屏幕主题 / 品牌资源"]

    subgraph Frontend["apps/*（Vite + Vue 3）"]
        W["web<br/>Portal"]
        A1["computer-labels"]
        A2["price-labels"]
        A3["price-tags"]
        A4["receipt-assistant"]
        A5["sample-labels"]
        A6["sales-report"]
        A7["sample-devices"]
        A8["employee-badges"]
    end

    subgraph Backend["apps/server"]
        M1["computer-labels"]
        M2["price-labels"]
        M3["price-tags"]
        M4["receipt-assistant"]
        M5["sample-devices"]
        MS["system<br/>健康 / 备份 / 更新"]
    end

    DB[("store.sqlite")]

    Shared --> W
    Shared --> A1 & A2 & A3 & A4 & A5 & A6 & A7 & A8
    A1 --> M1
    A2 --> M2
    A3 --> M3
    A4 --> M4
    A5 -.->|"只读复用"| M1
    A6 -.->|"只读统计"| M4
    A7 --> M5
    A8 -.->|"无服务端调用"| A8
    M1 & M2 & M3 & M4 & M5 --> DB
    MS --> DB
```

| 板块 | 前端 | 其后端 | 数据归属 |
| --- | --- | --- | --- |
| 电脑标签打印 | 独立 SPA | `computer-labels` | `computer_*` |
| 外设价签打印 | 独立 SPA | `price-labels` | `price_*` |
| 价格展牌打印 | 独立 SPA | `price-tags` | `pricetag_*`，配件读 `price_products` |
| 付款凭证打印 | 独立 SPA | `receipt-assistant` | `receipt_*` + OCR 密钥文件 |
| 销售业绩报表 | 独立 SPA | `sales-report` | 无自有表，只读 `receipt_sales`、`receipt_sale_items` |
| 样机设备管理 | 独立 SPA | `sample-devices` | `sampledev_*` + 上传目录 |
| 出样标签打印 | 独立 SPA | 无 | 无，只读 `/api/computer-labels/products` |
| 员工工牌制作 | 独立 SPA | 无 | 无，全部状态在浏览器内存 |

## 3. 请求链路

### 3.1 页面加载

```mermaid
sequenceDiagram
    participant U as 浏览器
    participant E as Express :8900
    participant S as 业务 SPA

    U->>E: GET /
    E-->>U: Portal index.html（hash 路由）
    U->>E: GET /modules/price-tags/
    E-->>U: 该板块 index.html + assets
    Note over U,S: 旧直链 /price-tags 由服务端 308 跳到 /#/price-tags
    S->>E: GET /api/price-tags/cards
    E-->>S: { code, data, msg }
```

- Portal 使用 hash 路由，`#` 之后不发送到服务器，因此刷新永远请求根路径，不依赖反向代理的 SPA rewrite。
- 未知 API 返回 JSON 404，缺失资源与未知页面返回普通 404，不做全局 `index.html` 回退。

### 3.2 打印

打印完全在浏览器侧完成，服务端不参与渲染：

| 板块 | 打印实现 | 尺寸 |
| --- | --- | --- |
| 电脑标签打印 | 独立 `@page` + 毫米布局 | 46mm × 45mm，A4 纵向 24 张/页 |
| 外设价签打印 | 独立字号测量 DOM + `@page` | 70mm × 28mm，A4 横向 28 张/页 |
| 价格展牌打印 | 独立 `@page` + 卡片缩放 | 110mm × 110mm，A4 每页 2 张 |
| 付款凭证打印 | Canvas 合成 → 临时隔离 iframe | A4 单页存根 + 小票 |
| 员工工牌制作 | 隔离 iframe 打印文档 | 54mm × 85mm，A4 横向 5 × 2 |
| 出样标签打印 | 独立 `@page` | A4 横向 3 × 3，每页 9 枚 |

共享主题 `@lenovo-store/shared/theme.css` 只在 `@media screen` 中提供界面样式，不定义 `@page`、不定义共享 `@media print`，因此任何板块的打印规则都不会污染其他板块。销售业绩报表与样机设备管理为纯屏幕展示。

打印分割线等细线一律使用 `border-top` 绘制，不用背景色画线：浏览器默认不打印背景色，且亚像素高度在光栅化时可能被舍成 0。

### 3.3 样机指令下发

```mermaid
sequenceDiagram
    participant A as LanAgent.exe
    participant E as Express :8900
    participant D as store.sqlite
    participant P as Portal

    A->>E: POST /api/agents/heartbeat（15s）
    E->>D: 更新设备状态与 IP
    A->>E: WS /ws/agents/{id}?token=...
    E-->>A: 建立长连接
    P->>E: POST /api/sample-devices/tasks
    E->>D: 落库任务（待发）
    E-->>A: WS 推送指令
    A->>E: POST 结果 / WS /ws/tasks/{task_id}
    E->>D: 记录任务结果与审计
    E-->>P: 实时推送结果
```

只有心跳、没有 WebSocket 长连接时，设备显示在线但指令停留在待发状态。反向代理必须放行 `/ws/agents/` 与 `/ws/tasks/` 的 `Upgrade` 头。

## 4. 数据一致性

- 统一库固定为 `$LENOVO_STORE_DATA_DIR/store/store.sqlite`，使用 WAL 模式、`busy_timeout = 5000`、开启外键约束。
- 表名前缀由 `apps/server/src/db/unified-database.js` 的 `TABLE_PREFIX` 唯一决定，新增持久化模块必须同时登记前缀、备份映射和更新器白名单。
- 在线备份走 SQLite backup API，不能只复制主 `.sqlite` 文件——WAL 中已提交的数据不会进入副本。
- OCR 凭据在库中是密文，只有配套的 `receipt-ocr.key` 或环境密钥能解密。

备份、恢复与迁移的完整流程见 [Ubuntu 部署指南](ubuntu-deployment.md) 第 7、8 节。

## 5. 在线更新链路

```mermaid
sequenceDiagram
    participant P as Portal 系统状态页
    participant E as Express :8900
    participant U as root updater（systemd oneshot）
    participant G as GitHub Releases
    participant R as releases/

    P->>E: POST /api/system/update/check
    E->>G: 取稳定 Release（ETag / 缓存）
    E-->>P: 当前版本 vs 最新版本
    P->>E: POST /api/system/update/install {tag}
    E->>U: 写 0600 单任务文件（不执行 Shell）
    U->>G: 下载 manifest、签名、SHA256SUMS、发布包
    U->>U: 校验 Ed25519、SHA-256、tag/commit/结构 + 自更新代码
    U->>U: 外部一致性备份
    U->>R: 独立 builder 构建并 npm run check
    U->>R: 原子切换 current / previous
    U->>E: 重启并连续三次健康检查
    alt 健康检查失败
        U->>R: 自动回滚到 previous 并重新验证
    end
```

Web 服务永不执行 Shell、npm 或 systemctl，只写入受限任务文件；下载、验签、构建、切换、回滚全部在 root-owned oneshot 中完成。发布包安装前会先刷新更新器自身代码，因此更新逻辑的修复随当次升级即刻生效。

版本号规则、发布步骤和镜像配置见 [运维与发布](operations.md)。
