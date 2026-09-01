# 联想门店运营系统

联想门店运营系统将四个业务边界彼此独立的门店工具统一到一个品牌、一个入口、一个服务进程和一个维护仓库中：

1. 仓库货品标签：管理并打印仓库电脑 SKU、配置和颜色标签；
2. 周边货品价签：管理并打印电脑、手机、平板及周边商品价格标签；
3. 付款凭证打印：合成客户付款后的商务存根和购物小票，辅助识别并记录金额；
4. 员工工牌制作：批量制作员工工牌并完成 A4 排版与打印。

项目默认通过 `http://localhost:8900` 提供统一 Portal 和四个独立 SPA。Portal 工作台首页集中展示全部业务板块，并在“业务板块”标题右侧提供当前项目的 GitHub 仓库入口；该入口会在新标签页中打开，不影响当前工作台。前三个业务板块拥有独立 API 与 SQLite 数据库；员工工牌板块完全在浏览器内运行，不创建 API、数据库或本地持久化数据。

> 本项目只统一联想品牌、入口、部署、健康检查和维护方式，不合并各业务的数据模型。三个既有业务继续使用独立前端、API、SQLite 数据库和打印流程；员工工牌使用独立的浏览器内 A4 打印流程，不接触其他板块数据。

## 更新记录

每次功能、配置、部署方式或文档更新都必须同步维护 GitHub 仓库文档，并按 `YYYY-MM-DD` 记录更新日期和主要内容。最新更新与完整历史请查看 [CHANGELOG.md](CHANGELOG.md)。

当前最新记录：`2026-08-20`，将周边货品价签的新增品类操作移入商品录入上方的独立品类管理容器，提升入口辨识度和操作便利性。

## 板块说明

| 业务板块 | 业务用途 | Portal 路由 | 独立 SPA | API | 数据库 | 当前输出能力 |
| --- | --- | --- | --- | --- | --- | --- |
| 仓库货品标签 | 管理电脑 SKU、名称、配置、颜色和备注 | `/computer-labels` | `/modules/computer-labels/` | `/api/computer-labels` | `$LENOVO_STORE_DATA_DIR/computer-labels/database.sqlite` | 46mm × 45mm，A4 纵向，24 张/页 |
| 周边货品价签 | 管理电脑、手机、平板及周边商品的品类、名称和价格 | `/price-labels` | `/modules/price-labels/` | `/api/price-labels` | `$LENOVO_STORE_DATA_DIR/price-labels/database.sqlite` | 70mm × 28mm，A4 横向，28 张/页 |
| 付款凭证打印 | 将商务存根和购物小票合成到一张 A4，识别并记录付款金额 | `/receipt-assistant` | `/modules/receipt-assistant/` | `/api/receipt-assistant` | `$LENOVO_STORE_DATA_DIR/receipt-assistant/database.sqlite` | 存根 + 小票，A4 打印或 PNG 下载 |
| 员工工牌制作 | 批量录入员工姓名、岗位和二维码，生成 A4 工牌排版 | `/employee-badges` | `/modules/employee-badges/` | 无 | 无 | 54mm × 85mm，A4 横向，10 张/页 |

仅在 `npm run dev`、`NODE_ENV=development` 或测试模式下，未设置 `LENOVO_STORE_DATA_DIR` 才会使用仓库内的 `data/`；生产启动缺少该变量会直接失败，防止新 release 静默创建空库。

### 仓库货品标签

- 商品新增、编辑、删除和批量删除；
- 按 SKU、名称和配置实时模糊搜索；
- 复制现有商品后新增；
- “保存”和“保存并新增”两种录入流程；
- 每个商品可设置独立打印数量；
- Excel 导入、Excel 导出；
- SQLite 数据库备份与恢复；
- 46mm × 45mm 标签预览和 A4 批量打印。

电脑商品标签不保存销售价格，其 SKU 模型不会与价格标签模块合并。

### 周边货品价签

- 商品和品类管理；
- 桌面端使用占满视口的左右工作台：左侧固定放置搜索、自动换行的多行品类筛选、当前结果全选、独立品类管理、商品录入和 JSON 备份恢复，右侧商品列表占满剩余空间并独立滚动，表头始终可见；布局已针对 1920 × 1080 Portal 内嵌区域压缩，常用工具无需滚动即可完整显示；
- “新增品类”位于商品录入上方的独立品类管理卡片中；展开后可直接输入、保存或取消，新增成功后会自动选中该品类用于商品录入；
- 搜索和品类筛选只改变当前显示结果，当前结果全选不会清除其他筛选条件下已加入打印队列的商品；
- 900px 及以下自动切换为单列自然滚动，避免手机和平板出现多层滚动区域；
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
- 今日统计，以及最近 30 天销售额趋势；趋势图使用 ECharts 单根平滑实线，不显示常驻数据点、第二条笔数线、面积填充或双 Y 轴，销售笔数保留在汇总和悬浮信息中；
- 趋势图支持悬停或触屏查看完整日期、销售额和有效笔数，可切换近 7/14/30 天，并可点击绘图区任意日期查看明细；
- 图表获得焦点后支持 `←`、`→` 逐日移动，`Home`、`End` 跳到首末日期，`Enter` 或空格打开详情；原生日期下拉保留为完整的键盘和无障碍兜底；
- 趋势详情弹窗显示当日有效销售额、有效笔数、全部记录、撤销记录、记录时间和状态，并可直接撤销或恢复；同一记录操作期间按钮会锁定，避免重复提交；
- 趋势区域支持手动刷新和响应式重绘；刷新失败时保留上一次可用图表并显示重试入口，零销售时仍可选择日期查看已撤销记录；
- OCR 请求超时、重试、并发限制和频率限制；
- OCR 凭据使用 AES-256-GCM 加密保存。

付款凭证只记录付款与打印信息，不关联商品标签或价格标签数据。

### 员工工牌制作

- 可连续添加多名员工，并在打印列表中编辑或删除；
- 每名员工默认打印 1 份，可在打印列表中独立设置 1–99 份；列表同时显示员工人数、工牌总张数和 A4 页数；
- 分页按所有员工的份数总和计算，每 10 张一页；例如 1 人 × 10 份为 1 页，1 人 × 11 份为 2 页；
- 员工姓名最长 20 个字符，岗位最长 30 个字符，姓名、岗位和二维码均为必填；长文本会自动缩小字号以完整容纳；
- 支持点击选择或拖放 PNG、JPG、WEBP、SVG 二维码图片；图片限制为 5MB，并在显示前执行浏览器解码校验；
- 每名员工可独立选择“默认工牌”或“联想红工牌”，主题随员工记录进入实时预览和打印，编辑时可切换；
- 默认工牌按参考设计使用纯白底：上方显示姓名和岗位，下方显示 30mm 二维码及“联想官方体验店”“企业微信”两行文案；文案下沿距 85mm 裁切底边约 1mm，减少无效底部留白；
- 联想红工牌保留原 Lenovo 红色背景、姓名岗位分割线、二维码下移和“联想官方体验店”“请您添加企业微信”文案；原始背景文件保持不变，渲染时向四周扩展 2mm，使素材内置白边和阴影位于裁切区外；
- 同一员工的多份工牌复用同一个二维码 Object URL，不复制图片数据，也不改变原有释放生命周期；
- 单张工牌裁切格固定为 54mm × 85mm，0.1mm 内缩轮廓线只作为裁切边界，不进入工牌盒模型；
- 打印文档使用完整的 297mm × 210mm A4 横向页面，按 5 列 × 2 行排列；每张 54mm × 85mm 工牌之间保留 2mm 横纵裁剪通道，总网格为 278mm × 172mm，物理边距左右各 9.5mm、上下各 19mm；
- 右侧实时预览使用显式 297:210 A4 页面和绝对定位的 278mm × 172mm 网格，不依赖 padding 盒模型；每个裁切格显式保持 54:85，并等比显示 2mm 裁剪通道，裁切线加深，页码不参与纸张阴影；10 张工牌可完整显示，预览区域受限时提供滚动；
- 桌面端工作区取消固定最大宽度，左右卡片等高拉伸并占满页头下方空间；左侧保持适合录入的宽度，右侧自动使用 1080P 屏幕的全部剩余宽度；
- 打印使用隔离 iframe，等待字体、背景和二维码图片加载完成后再打开浏览器打印窗口；
- 页面关闭或刷新后数据自动消失，不调用 API，不使用 localStorage、sessionStorage、IndexedDB 或数据库。

二维码通过临时 Object URL 在浏览器内显示。替换、删除、清空或离开页面时会主动释放对应 URL。员工资料不会发送到服务器，也不会进入其他三个板块。打印时必须选择 A4、横向、实际大小（100%），关闭“适合页面”和页眉页脚；实体尺寸以灰色裁切边界为准，不以联想红背景的阴影边缘为准，并应在首张样张上复核 54mm × 85mm。

## 系统架构

```text
Browser
  |
  | http://localhost:8900
  v
Express 5 unified server
  |-- /                          Portal SPA
  |-- /modules/computer-labels   仓库货品标签 SPA
  |-- /modules/price-labels      周边货品价签 SPA
  |-- /modules/receipt-assistant 付款凭证打印 SPA
  |-- /modules/employee-badges   员工工牌制作 SPA（纯浏览器状态）
  |-- /api/computer-labels       仓库货品标签 API
  |-- /api/price-labels          周边货品价签 API
  |-- /api/receipt-assistant     付款凭证 API
  `-- /api/system                健康检查与统一备份恢复 API
         |
         |-- $LENOVO_STORE_DATA_DIR/computer-labels/database.sqlite
         |-- $LENOVO_STORE_DATA_DIR/price-labels/database.sqlite
         |-- $LENOVO_STORE_DATA_DIR/receipt-assistant/database.sqlite
         `-- $LENOVO_STORE_DATA_DIR/secrets/receipt-ocr.key
```

Portal 通过同源 iframe 加载四个独立 SPA。四套打印实现分别维护自己的纸张方向、毫米尺寸、分页和资源加载流程；员工工牌使用独立 iframe 打印 A4 横向页面，不向其他模块注入打印样式。

## 前端视觉与打印隔离

五个前端（Portal + 四个业务 SPA）通过 `@lenovo-store/shared/theme.css` 使用同一套屏幕设计令牌，并共享用户指定的红色联想 SVG Logo，统一字体、画布、色板、间距、圆角、阴影、卡片、表单和按钮。Portal 将板块工具栏与 iframe 组合成一个完整工作区，四个业务 SPA 仍可通过各自地址独立开发和打开。

共享主题遵循以下边界：

- 只在 `@media screen` 中提供界面样式，不定义 `@page` 或共享 `@media print`；
- 每个 SPA 主动导入主题，Portal 不向 iframe 注入 CSS；
- 电脑商品标签继续由模块自身维护 46mm × 45mm 标签和 A4 纵向打印规则；
- 商品价格标签继续维护独立的字号测量 DOM、70mm × 28mm 标签和 A4 横向打印规则；
- 付款凭证继续通过 Canvas 合成图片，并在临时隔离 iframe 中打印 A4；
- 员工工牌通过独立 DOM/CSS 打印文档维护 54mm × 85mm 工牌、A4 横向 5×2 网格和裁切边界；
- 统一的是屏幕操作体验，不是四种打印文档的几何尺寸或业务模型。

## 技术栈

- Node.js `22.21.1`；
- npm workspaces；
- Vue `3.5.13`；
- Vite `7.3.6`；
- Element Plus `2.14.4`；
- Apache ECharts `6.1.0`（付款凭证销售趋势）；
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
│   ├── receipt-assistant/      # 付款凭证打印 SPA
│   ├── employee-badges/        # 员工工牌制作 SPA（无持久化）
│   └── server/                 # Express 服务和三个持久化后端模块
├── packages/
│   └── shared/                 # 板块元数据、共享屏幕主题与联想 Logo
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

Ubuntu 生产服务器建议先阅读 [Ubuntu 部署、数据持久化与备份恢复指南](docs/ubuntu-deployment.md)。该指南包含首次部署、systemd 服务、仓库内数据无损外迁、日常升级、定时备份、冷恢复、回滚和“升级后数据为空”的应急排查步骤；以下内容保留为快速参考。

生产环境必须将数据目录放在 Git checkout、release 目录和容器临时层之外。以下示例中的目录应由实际服务账号拥有并保持持久化：

```bash
export LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations
export LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations
npm ci
npm run build
npm start
```

`LENOVO_STORE_DATA_DIR` 必须是代码目录之外的绝对路径；显式指向项目 checkout、符号链接回项目目录或文件系统根目录都会拒绝启动。只有开发和测试模式允许回退到仓库内 `data/`，`npm start` 漏配变量会直接失败。systemd、PM2、Docker 或服务器面板中必须永久配置此变量，容器部署还必须把该目录挂载为持久卷。

服务默认监听：

```text
http://localhost:8900
```

可通过环境变量修改监听地址和端口：

```bash
HOST=127.0.0.1 PORT=8900 LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations npm start
```

统一服务需要先完成 `npm run build`，因为 Express 会直接托管四个应用的 `dist` 目录。启动日志会输出当前实际使用的数据根目录及其来源。

### 现有服务器一次性无损迁移

如果服务器目前仍使用仓库内 `data/`，应在下一次拉取或切换 release 前完成一次迁移：

1. 停止 Node/PM2/systemd/容器服务，确保没有 SQLite 写入；
2. 将当前仓库的整个 `data/` 目录额外备份到独立位置；
3. 创建代码目录之外的持久化目录，并将 `data/` 内全部内容原样复制过去，付款凭证数据库与 `secrets/receipt-ocr.key` 必须成对迁移；
4. 为实际服务账号设置目录读写权限，并在进程管理器中永久配置 `LENOVO_STORE_DATA_DIR`；
5. 拉取代码、执行 `npm ci && npm run build`，然后启动服务；
6. 从启动日志确认实际数据目录，再检查健康接口及三个板块的记录数量和最新记录。

示例（请将 `<repo>` 和 `<service-user>` 替换为服务器实际值；目标或 staging 已存在时命令会停止，不会合并覆盖）：

```bash
# 先停服，再执行复制；不要在SQLite仍写入时只复制主数据库文件
TARGET=/var/lib/lenovo-store-operations
STAGING="${TARGET}.staging"
test ! -e "$TARGET" || { echo "目标已存在，停止迁移：$TARGET" >&2; exit 1; }
test ! -e "$STAGING" || { echo "staging已存在，停止迁移：$STAGING" >&2; exit 1; }
sudo install -d -m 0750 -o <service-user> -g <service-user> "$(dirname "$TARGET")"
sudo cp -a <repo>/data "$STAGING"
sudo test -f "$STAGING/computer-labels/database.sqlite"
sudo test -f "$STAGING/price-labels/database.sqlite"
sudo test -f "$STAGING/receipt-assistant/database.sqlite"
sudo chown -R <service-user>:<service-user> "$STAGING"
sudo mv "$STAGING" "$TARGET"
```

迁移成功并完成独立备份前不要删除旧 `data/`。以后可以更换 checkout、切换 release 或重建应用容器，但所有版本必须指向同一个外部持久化目录。部署脚本禁止使用会删除 ignored 文件的 `git clean -fdx` 处理数据目录。

### 常用入口

Portal 使用 hash 路由，`#` 后的业务路径只由浏览器解析，刷新时服务器始终收到根路径请求：

- Portal：`http://localhost:8900/`
- 系统状态：`http://localhost:8900/#/system`
- 仓库货品标签：`http://localhost:8900/#/computer-labels`
- 周边货品价签：`http://localhost:8900/#/price-labels`
- 付款凭证打印：`http://localhost:8900/#/receipt-assistant`
- 员工工牌制作：`http://localhost:8900/#/employee-badges`
- 系统健康接口：`http://localhost:8900/api/system/health`

服务器仍兼容 `/system`、`/computer-labels`、`/price-labels`、`/receipt-assistant` 和 `/employee-badges` 旧直链，并使用 `308` 跳转到对应 hash 地址；新链接统一使用 hash 地址，避免部署环境未配置 history rewrite 时刷新落入 API 404。

### 反向代理与刷新

生产反向代理应将 `/`、`/assets/`、`/modules/` 和 `/api/` 保留原始路径转发到统一服务的 `8900` 端口，不要把未命中的页面路径改写到 `/api`，也不要对 API 或缺失的 JavaScript/CSS 使用全局 `index.html` 回退。代理必须保留原始 `Host`，并设置正确的 `X-Forwarded-Proto`；服务仅信任回环代理提供的转发协议，用于统一维护接口的严格同源校验。Portal 的 hash 路由不依赖代理层 SPA rewrite；未知 API 始终返回 JSON 404，缺失资源和未知页面返回普通页面 404。

如果部署后仍返回英文 `{"code":1,"data":null,"msg":"Not Found"}`，说明请求未进入当前 Express 服务或服务器仍运行旧版本；请核对反向代理 upstream、实际启动命令、部署提交哈希和进程重启状态。

## 开发模式

```bash
npm run dev
```

该命令同时启动统一后端、Portal 和四个业务板块开发服务器：

| 服务 | 开发地址 |
| --- | --- |
| Portal | `http://localhost:5173/` |
| 仓库货品标签 | `http://localhost:5174/modules/computer-labels/` |
| 周边货品价签 | `http://localhost:5175/modules/price-labels/` |
| 付款凭证打印 | `http://localhost:5176/modules/receipt-assistant/` |
| 员工工牌制作 | `http://localhost:5177/modules/employee-badges/` |
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

首次迁移前先安装依赖，但不要先启动新服务。生产目标应通过外部数据根目录指定：

```bash
npm ci
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations npm run migrate:data
npm run build
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations npm start
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
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations \
LEGACY_COMPUTER_DB="/absolute/path/computer.sqlite" \
LEGACY_PRICE_DB="/absolute/path/price.db" \
LEGACY_RECEIPT_DB="/absolute/path/receipt.sqlite" \
LEGACY_RECEIPT_OCR_KEY="/absolute/path/ocr-config.key" \
npm run migrate:data
```

迁移是一次性操作。目标文件已经存在时脚本会主动停止，这是防止覆盖现有业务数据的保护机制。

## 数据备份与恢复

系统状态页 `http://localhost:8900/#/system` 提供统一数据保护入口。员工工牌不保存数据；其余三个板块一次生成一个 `.lsbackup` 文件，恢复时上传同一个文件并逐个选择模块：

1. 点击“下载全部数据库备份”，输入服务器维护令牌后下载文件；
2. 备份包含仓库货品标签、周边货品价签和付款凭证打印三套 SQLite 一致性快照；本机密钥模式下还会包含配套 OCR 密钥；
3. 恢复时选择 `.lsbackup` 并点击“上传并检查”；上传只检查格式、长度、SHA-256、SQLite 完整性、表结构、业务字段和记录数，不会立即覆盖数据；
4. 核对备份编号、创建时间和各表记录数，在目标模块点击“恢复此模块”；
5. 二次确认弹窗中完整输入“恢复”。每次只在一个 SQLite 事务中覆盖一个模块，没有“一键恢复全部”；
6. 用完后点击“清除”。服务端恢复会话最长保留 30 分钟，过期后必须重新上传。

`.lsbackup` 最大 1GB。它是无压缩的 `LSOBKP01` 单文件容器，不依赖 ZIP/TAR 解包；清单拒绝未知模块、重复或重叠条目、长度越界、尾随数据和摘要不一致。SHA-256 与数据库检查用于发现损坏，**不能证明文件来源**，只应恢复从受信任服务器下载并保存在受控位置的文件。备份可能包含可用于解密百度 OCR 凭据的密钥，禁止上传到公共网盘、群聊或工单附件。

如果源服务使用 `OCR_CONFIG_ENCRYPTION_KEY`，统一包不会导出该环境密钥，只记录密钥指纹；目标服务必须配置相同环境密钥才能恢复付款凭证。密钥不匹配时，检查结果只会把付款凭证标为“不兼容”，仓库货品标签和周边货品价签仍可独立恢复。本机密钥模式则使用包内源密钥解密 OCR 配置，再使用目标服务器当前有效密钥重新加密，不会覆盖目标服务器密钥文件。

现有单模块入口继续保留：

- 仓库货品标签：板块内 Excel 导入导出和 SQLite `.db` 备份恢复；
- 周边货品价签：板块内 JSON 导入导出，导入前校验并在单事务中全量恢复；
- 付款凭证打印：当前使用系统状态页统一入口恢复；
- 员工工牌制作：页面刷新或关闭后自动清空，没有数据库备份。

统一维护 API 要求 `X-Lenovo-Store-Maintenance: 1` 和 `Authorization: Bearer <LENOVO_STORE_MAINTENANCE_TOKEN>`。生产环境缺少至少 24 个字符的 `LENOVO_STORE_MAINTENANCE_TOKEN` 时服务会拒绝启动；非生产环境未配置令牌时，仅服务器本机回环请求可操作。页面令牌只保存在当前页面内存，不写入浏览器持久化存储。

服务器定时和部署前备份仍推荐使用在线备份命令，并将备份目录放在数据根目录之外：

```bash
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations \
LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations \
npm run backup:data
```

该命令通过 SQLite backup API 分别创建三个一致性快照，执行 `PRAGMA integrity_check`，记录各表数量、文件大小和 SHA-256，同时备份当前实际使用的 32 字节 OCR 加密密钥并验证它能够解密快照中的凭据，最后生成 `manifest.json`。无论运行时密钥来自本机文件还是 `OCR_CONFIG_ENCRYPTION_KEY`，备份内都统一保存为权限 `0600` 的 `secrets/receipt-ocr.key`；无法确认可恢复时整个备份会失败。备份先写入 staging 目录，全部成功后再发布为时间戳目录，不会覆盖已有备份。`LENOVO_STORE_BACKUP_DIR` 必须是绝对普通目录，不能是符号链接，也不能与代码目录或数据目录重叠。

付款凭证数据库中的 OCR 凭据是密文。只有配套的 `receipt-ocr.key` 才能解密；丢失密钥后不能从数据库恢复原凭据，需要在页面重新配置。

不要在 SQLite 正在写入时只复制主 `.sqlite` 文件，否则 WAL 中已提交的数据可能丢失。优先使用 `npm run backup:data`；手工冷备份时必须先停服，再复制完整数据目录。每次部署前应先生成一份外部备份，并定期在隔离目录做恢复演练。

## OCR 配置与安全

付款凭证模块优先读取数据库中的加密 OCR 配置，也支持以下环境变量：

- `BAIDU_OCR_API_KEY`
- `BAIDU_OCR_SECRET_KEY`
- `OCR_CONFIG_ENCRYPTION_KEY`
- `BAIDU_OCR_ENDPOINT`

建议通过付款凭证页面配置 OCR 凭据。页面和配置查询接口只返回掩码状态，不返回明文 Secret Key。

本项目当前定位为门店内部工具，没有完整的用户账号系统或公网部署配置。统一备份恢复使用独立维护令牌保护，但其他业务 API 仍依赖可信内网边界。默认 `HOST=0.0.0.0` 会允许局域网访问；请只在可信网络中运行。若需要公网部署，应在反向代理层增加 HTTPS、统一身份认证、访问控制和请求限制，不能把维护令牌当作全站登录系统。

## npm 脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动五个前端开发服务器和统一后端 |
| `npm run build` | 构建 Portal 和四个业务 SPA |
| `npm start` | 启动 8900 统一生产服务 |
| `npm run check` | 构建检查四个业务 SPA、后端与数据脚本语法 |
| `npm run migrate:data` | 一次性迁移三个旧项目数据库和 OCR 密钥，目标由 `LENOVO_STORE_DATA_DIR` 决定 |
| `npm run backup:data` | 在线一致性备份三套 SQLite、OCR 密钥和校验清单 |

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

健康接口会报告：

- `persistentDataConfigured` 是否已使用外部持久化数据根；生产探针应要求该值为 `true`；
- 每个业务板块的 SPA 构建产物是否存在；
- 有 API 的板块是否已挂载；
- 使用 SQLite 的板块是否已有数据目录并成功连接数据库；
- 板块处于“已迁移”或“已就绪”状态。

员工工牌制作在健康接口中会返回 `apiReady: null`、`dataDirectoryReady: null` 和 `databaseConnected: null`，表示这些能力不适用，而不是运行异常。

## 打印验收

浏览器构建和 API 检查不能替代实体打印验收。首次部署或更换打印机后，应分别检查：

1. 电脑商品标签是否为 46mm × 45mm，A4 纵向且每页 24 张；
2. 商品价格标签是否为 70mm × 28mm，A4 横向且每页 28 张；
3. 价格标签中的长商品名称字号自适应是否与改造前一致；
4. 付款凭证是否在一张 A4 上正确显示存根和小票；
5. 付款凭证 PNG 下载结果是否与打印预览内容一致；
6. 员工工牌是否为 54mm × 85mm，A4 横向、5 列 × 2 行且每页 10 张；
7. 员工工牌之间是否保留 2mm 横纵裁剪通道，裁切线是否未占用 54mm × 85mm 成品尺寸；
8. 每名员工的打印份数是否可在 1–99 之间设置，人数、总张数和页数统计是否正确；
9. 1 人 × 10 份是否恰好为 1 页，1 人 × 11 份是否为 2 页且第二页只有 1 张，没有额外空白页；
10. “默认工牌”和“联想红工牌”的姓名、岗位、二维码、文案和裁切边界是否完整，二维码是否可正常扫码；
11. 浏览器打印缩放是否为实际大小（100%），是否关闭“适合页面”和页眉页脚；
12. 打印机驱动的纸张尺寸、方向、边距和缩放是否与浏览器一致。

员工工牌的浏览器预览按真实毫米比例生成，打印文档使用完整的 297mm × 210mm A4 横向页面；5 × 2 个 54mm × 85mm 裁切格之间保留 2mm 横纵裁剪通道，总网格为 278mm × 172mm。打印机驱动仍可能执行二次缩放；首次使用时应打印 10 张和 11 张两组样张，确认分页无额外空白页，并测量单张 54mm × 85mm、相邻裁切线间距 2mm、整页网格 278mm × 172mm。若尺寸不符，应确认纸张为 A4、缩放为 100%，并关闭“适合页面”“缩放到可打印区域”等选项后重新打印。

## 常见问题

### 8900 端口被占用

指定其他端口启动：

```bash
PORT=8910 npm start
```

对应的 Vite API 代理默认仍指向 8900。长期修改开发端口时，需要同步调整使用 API 代理的四个 `vite.config.js`；员工工牌没有 API 代理。

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
$LENOVO_STORE_DATA_DIR/receipt-assistant/database.sqlite
$LENOVO_STORE_DATA_DIR/secrets/receipt-ocr.key
```

如果密钥不匹配或已丢失，请在付款凭证页面重新填写百度 OCR 凭据。

### 页面正常但打印尺寸不正确

确认浏览器缩放为 100%、关闭页眉页脚，并检查打印机驱动是否启用了“适合页面”或二次缩放。最终尺寸必须以实体打印样张为准。

## 项目状态

四个联想业务板块已统一运行在 8900 端口：

- 三个既有板块的独立 SPA、API 和 SQLite 数据库已接入；
- 员工工牌制作支持多员工录入、每人独立设置 1–99 打印份数及默认工牌/联想红工牌主题，使用真实 54mm × 85mm 裁切格、2mm 裁剪通道和完整 A4 横向页面完成 10 张/页预览与打印，不持久化员工信息；
- 用户指定的联想 SVG Logo 已作为共享屏幕品牌资产，Portal 和四个业务 SPA 的中文命名已统一；
- 旧数据库及 OCR 密钥支持一致性迁移；
- Portal、健康检查、构建和生产静态托管已完成；
- Portal 和四个业务 SPA 已接入共享屏幕设计令牌，板块工作区、页头、卡片、表单和按钮风格保持一致；
- 四套打印实现分别维护，员工工牌通过隔离 iframe 打印，不会覆盖其他模块打印 CSS；
- 数据查询、导出、备份和 OCR 配置解密已通过无破坏冒烟验证；
- 实体标签、员工工牌和 A4 付款凭证仍需在实际打印机上完成最终尺寸与颜色验收。
