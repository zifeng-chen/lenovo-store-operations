# Lenovo Store Operations

联想门店运营工具套件，将三个业务彼此独立的门店工具统一到一个入口、一个服务进程和一个维护仓库中：

1. 电脑商品标签管理与打印；
2. 电脑、手机、平板及周边商品的价格标签管理与打印；
3. 客户付款后的存根、小票合成及付款凭证打印。

项目默认通过 `http://localhost:8900` 提供统一 Portal、三个独立 SPA 和全部 API。

> 本项目只统一入口、部署、健康检查和维护方式，不合并三个业务的数据模型。每个模块继续使用独立的前端应用、API 命名空间、SQLite 数据库和打印样式，避免商品、价格和付款凭证之间产生错误关联。

## 模块说明

| 模块 | 业务用途 | Portal 路由 | 独立 SPA | API | 数据库 | 打印规格 |
| --- | --- | --- | --- | --- | --- | --- |
| 电脑商品标签 | 管理电脑 SKU、名称、配置、颜色和备注 | `/computer-labels` | `/modules/computer-labels/` | `/api/computer-labels` | `data/computer-labels/database.sqlite` | 46mm × 45mm，A4 纵向，24 张/页 |
| 商品价格标签 | 管理电脑、手机、平板及周边商品的品类、名称和价格 | `/price-labels` | `/modules/price-labels/` | `/api/price-labels` | `data/price-labels/database.sqlite` | 70mm × 28mm，A4 横向，28 张/页 |
| 付款凭证打印 | 将商务存根和购物小票合成到一张 A4，识别并记录付款金额 | `/receipt-assistant` | `/modules/receipt-assistant/` | `/api/receipt-assistant` | `data/receipt-assistant/database.sqlite` | 存根 + 小票，A4 打印或 PNG 下载 |

### 电脑商品标签

- 商品新增、编辑、删除和批量删除；
- 按 SKU、名称和配置实时模糊搜索；
- 复制现有商品后新增；
- “保存”和“保存并新增”两种录入流程；
- 每个商品可设置独立打印数量；
- Excel 导入、Excel 导出；
- SQLite 数据库备份与恢复；
- 46mm × 45mm 标签预览和 A4 批量打印。

电脑商品标签不保存销售价格，其 SKU 模型不会与价格标签模块合并。

### 商品价格标签

- 商品和品类管理；
- 商品搜索、品类筛选和当前筛选结果全选；
- JSON 全量导出；
- JSON 导入前校验和单事务全量恢复；
- Lenovo Logo、价格格式化和商品名称字号自适应；
- 70mm × 28mm 标签预览和 A4 横向批量打印。

该模块覆盖电脑、手机、平板和周边商品价格，不要求电脑 SKU，也不复用电脑商品标签数据库。

### 付款凭证打印

- 商务存根和购物小票两张图片上传或拖放；
- A4 Canvas 合成、预览、打印和 PNG 下载；
- 百度 OCR 自动识别付款金额；
- OCR 结果人工覆盖保护；
- OCR 凭据配置和识别历史；
- 销售金额保存、撤销和恢复；
- 今日统计和最近 30 天销售趋势；
- OCR 请求超时、重试、并发限制和频率限制；
- OCR 凭据使用 AES-256-GCM 加密保存。

付款凭证只记录付款与打印信息，不关联商品标签或价格标签数据。

## 系统架构

```text
Browser
  |
  | http://localhost:8900
  v
Express 5 unified server
  |-- /                         Portal SPA
  |-- /modules/computer-labels  Computer Label SPA
  |-- /modules/price-labels     Price Label SPA
  |-- /modules/receipt-assistant Receipt Assistant SPA
  |-- /api/computer-labels      Computer Label API
  |-- /api/price-labels         Price Label API
  `-- /api/receipt-assistant    Receipt Assistant API
         |
         |-- data/computer-labels/database.sqlite
         |-- data/price-labels/database.sqlite
         |-- data/receipt-assistant/database.sqlite
         `-- data/secrets/receipt-ocr.key
```

Portal 通过同源 iframe 加载三个独立 SPA。这样既保留统一导航，也能隔离三套 `@page`、`@media print` 和页面样式，防止打印规则互相污染。

## 前端视觉与打印隔离

四个前端通过 `@lenovo-store/shared/theme.css` 使用同一套屏幕设计令牌，统一字体、画布、色板、间距、圆角、阴影、卡片、表单和按钮。Portal 将模块工具栏与 iframe 组合成一个完整工作区，三个业务应用仍可通过各自地址独立开发和打开。

共享主题遵循以下边界：

- 只在 `@media screen` 中提供界面样式，不定义 `@page` 或共享 `@media print`；
- 每个 SPA 主动导入主题，Portal 不向 iframe 注入 CSS；
- 电脑商品标签继续由模块自身维护 46mm × 45mm 标签和 A4 纵向打印规则；
- 商品价格标签继续维护独立的字号测量 DOM、70mm × 28mm 标签和 A4 横向打印规则；
- 付款凭证继续通过 Canvas 合成图片，并在临时隔离 iframe 中打印 A4；
- 统一的是屏幕操作体验，不是三种打印文档的几何尺寸或业务模型。

## 技术栈

- Node.js `22.21.1`；
- npm workspaces；
- Vue `3.5.13`；
- Vite `7.3.6`；
- Element Plus `2.14.4`；
- Express `5.1.0`；
- better-sqlite3 `12.0.0`；
- Multer `2.2.0`；
- SheetJS `0.20.3`。

## 目录结构

```text
lenovo-store-operations/
├── apps/
│   ├── web/                    # 统一 Portal
│   ├── computer-labels/        # 电脑商品标签 SPA
│   ├── price-labels/           # 商品价格标签 SPA
│   ├── receipt-assistant/      # 付款凭证 SPA
│   └── server/                 # Express 服务和三个独立后端模块
├── packages/
│   └── shared/                 # 模块元数据与前端共享屏幕主题
├── data/
│   ├── computer-labels/        # 电脑商品标签数据库
│   ├── price-labels/           # 商品价格标签数据库
│   ├── receipt-assistant/      # 付款凭证数据库
│   └── secrets/                # OCR 加密密钥
├── scripts/
│   └── migrate-legacy-data.js  # 旧项目数据一次性迁移脚本
├── package.json
└── package-lock.json
```

`data` 下的数据库、WAL/SHM 文件和密钥均被 `.gitignore` 排除，不会提交到 GitHub。

## 环境要求

- macOS 或兼容的 Node.js 运行环境；
- Node.js `22.21.1`，最低要求 `22.12.0`；
- npm；
- 浏览器允许打印预览、Canvas 和文件下载；
- 使用 OCR 时需要有效的百度 OCR API Key 和 Secret Key。

推荐使用仓库中的 `.nvmrc`：

```bash
nvm install
nvm use
node --version
```

预期 Node.js 版本为 `v22.21.1`。

## 安装与生产运行

```bash
npm ci
npm run build
npm start
```

服务默认监听：

```text
http://localhost:8900
```

可通过环境变量修改监听地址和端口：

```bash
HOST=127.0.0.1 PORT=8900 npm start
```

统一服务需要先完成 `npm run build`，因为 Express 会直接托管四个应用的 `dist` 目录。

### 常用入口

- Portal：`http://localhost:8900/`
- 系统状态：`http://localhost:8900/system`
- 电脑商品标签：`http://localhost:8900/computer-labels`
- 商品价格标签：`http://localhost:8900/price-labels`
- 付款凭证打印：`http://localhost:8900/receipt-assistant`
- 系统健康接口：`http://localhost:8900/api/system/health`

## 开发模式

```bash
npm run dev
```

该命令同时启动统一后端、Portal 和三个业务模块开发服务器：

| 服务 | 开发地址 |
| --- | --- |
| Portal | `http://localhost:5173/` |
| 电脑商品标签 | `http://localhost:5174/modules/computer-labels/` |
| 商品价格标签 | `http://localhost:5175/modules/price-labels/` |
| 付款凭证打印 | `http://localhost:5176/modules/receipt-assistant/` |
| API 服务 | `http://localhost:8900/` |

开发模式下应使用上表中的独立 Vite 地址调试业务模块。需要验证统一 Portal iframe、静态托管和生产路径时，请执行 `npm run build && npm start`，并通过 8900 端口访问。

## 旧项目数据迁移

迁移脚本使用 SQLite backup API 创建包含 WAL 中已提交数据的一致性快照，不会直接复制正在使用的数据库主文件。

### 默认源路径

| 数据 | 默认源文件 |
| --- | --- |
| 电脑商品标签 | 上级旧项目的 `backend/db/database.sqlite` |
| 商品价格标签 | `~/lenovo-price-label/data/database.db` |
| 付款凭证 | `~/Lenovo POS System/backend/db/database.sqlite` |
| OCR 密钥 | `~/Lenovo POS System/backend/.local/ocr-config.key` |

首次迁移前先安装依赖，但不要先启动新服务：

```bash
npm ci
npm run migrate:data
npm run build
npm start
```

迁移脚本会：

1. 确认三个源数据库和 OCR 密钥存在；
2. 拒绝覆盖任何已存在的目标数据库或密钥；
3. 使用 SQLite backup API 复制一致性快照；
4. 对源库和目标库执行记录数比对；
5. 对目标库执行 `PRAGMA integrity_check`；
6. 将 OCR 密钥权限设置为 `0600`；
7. 任一步骤失败时清理本轮创建的目标文件。

如果旧项目不在默认位置，可通过环境变量指定：

```bash
LEGACY_COMPUTER_DB="/absolute/path/computer.sqlite" \
LEGACY_PRICE_DB="/absolute/path/price.db" \
LEGACY_RECEIPT_DB="/absolute/path/receipt.sqlite" \
LEGACY_RECEIPT_OCR_KEY="/absolute/path/ocr-config.key" \
npm run migrate:data
```

迁移是一次性操作。目标文件已经存在时脚本会主动停止，这是防止覆盖现有业务数据的保护机制。

## 数据备份与恢复

三个模块必须分别备份，不应合并为一个数据库：

- 电脑商品标签：使用模块内的 Excel 导出或 SQLite 备份；SQLite 恢复会替换该模块数据库；
- 商品价格标签：使用模块内 JSON 导出；导入时先校验，确认后在单事务中全量恢复；
- 付款凭证：备份 `data/receipt-assistant/database.sqlite` 时，必须同时备份 `data/secrets/receipt-ocr.key`。

付款凭证数据库中的 OCR 凭据是密文。只有配套的 `receipt-ocr.key` 才能解密；丢失密钥后不能从数据库恢复原凭据，需要在页面重新配置。

备份或复制运行中的 SQLite 数据库时，不要只复制主 `.sqlite` 文件。应停止服务后复制数据库及相关 WAL/SHM 文件，或使用 SQLite backup API 生成一致性备份。

## OCR 配置与安全

付款凭证模块优先读取数据库中的加密 OCR 配置，也支持以下环境变量：

- `BAIDU_OCR_API_KEY`
- `BAIDU_OCR_SECRET_KEY`
- `OCR_CONFIG_ENCRYPTION_KEY`
- `BAIDU_OCR_ENDPOINT`

建议通过付款凭证页面配置 OCR 凭据。页面和配置查询接口只返回掩码状态，不返回明文 Secret Key。

本项目当前定位为门店内部工具，没有用户登录、权限控制或公网部署配置。默认 `HOST=0.0.0.0` 会允许局域网访问；请只在可信网络中运行。若需要公网部署，应在反向代理层增加 HTTPS、身份认证、访问控制和请求限制。

## npm 脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动四个前端开发服务器和统一后端 |
| `npm run build` | 构建 Portal 和三个业务 SPA |
| `npm start` | 启动 8900 统一生产服务 |
| `npm run check` | 构建检查三个业务 SPA并检查后端 JavaScript 语法 |
| `npm run migrate:data` | 一次性迁移三个旧项目数据库和 OCR 密钥 |

## 构建与健康检查

提交或部署前建议执行：

```bash
npm ci
npm run build
npm run check
npm audit
```

启动服务后检查：

```bash
curl http://127.0.0.1:8900/api/system/health
```

健康接口会报告每个模块的以下状态：

- API 是否挂载；
- SPA 构建产物是否存在；
- 数据目录是否存在；
- SQLite 数据库是否成功连接；
- 模块是否完成迁移。

## 打印验收

浏览器构建和 API 检查不能替代实体打印验收。首次部署或更换打印机后，应分别检查：

1. 电脑商品标签是否为 46mm × 45mm，A4 纵向且每页 24 张；
2. 商品价格标签是否为 70mm × 28mm，A4 横向且每页 28 张；
3. 价格标签中的长商品名称字号自适应是否与改造前一致；
4. 付款凭证是否在一张 A4 上正确显示存根和小票；
5. 付款凭证 PNG 下载结果是否与打印预览内容一致；
6. 浏览器打印缩放是否为 100%，是否关闭页眉页脚；
7. 打印机驱动的纸张尺寸、方向、边距和缩放是否与浏览器一致。

## 常见问题

### 8900 端口被占用

指定其他端口启动：

```bash
PORT=8910 npm start
```

对应的 Vite API 代理默认仍指向 8900。长期修改开发端口时，需要同步调整四个 `vite.config.js`。

### `better-sqlite3` 原生模块架构不匹配

确认终端使用 `.nvmrc` 指定的 Node.js，再重新安装依赖：

```bash
nvm use
rm -rf node_modules
npm ci
```

不要在 arm64 Node.js 与 Rosetta/x86_64 Node.js 之间复用同一份 `node_modules`。

### 数据迁移提示目标文件已存在

这是正常的覆盖保护。不要删除现有数据库后直接重试。应先确认目标数据是否需要保留并完成独立备份，再决定是否重新迁移。

### OCR 配置无法解密

确认以下文件来自同一套旧系统备份：

```text
data/receipt-assistant/database.sqlite
data/secrets/receipt-ocr.key
```

如果密钥不匹配或已丢失，请在付款凭证页面重新填写百度 OCR 凭据。

### 页面正常但打印尺寸不正确

确认浏览器缩放为 100%、关闭页眉页脚，并检查打印机驱动是否启用了“适合页面”或二次缩放。最终尺寸必须以实体打印样张为准。

## 项目状态

三个业务模块已完成迁移并统一运行在 8900 端口：

- 独立 SPA、API 和 SQLite 数据库已接入；
- 旧数据库及 OCR 密钥支持一致性迁移；
- Portal、健康检查、构建和生产静态托管已完成；
- Portal 和三个业务 SPA 已接入共享屏幕设计令牌，模块工作区、页头、卡片、表单和按钮风格保持一致；
- 三套打印实现继续独立维护，视觉统一不会合并或覆盖打印 CSS；
- 数据查询、导出、备份和 OCR 配置解密已通过无破坏冒烟验证；
- 实体标签和 A4 付款凭证仍需在实际打印机上验收。
