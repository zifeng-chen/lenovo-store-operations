# 联想门店运营系统

联想门店运营系统将五个业务边界彼此独立的门店工具统一到一个品牌、一个入口、一个服务进程和一个维护仓库中：

1. 仓库货品标签：管理并打印仓库电脑 SKU、配置和颜色标签；
2. 周边货品价签：管理并打印电脑、手机、平板及周边商品价格标签；
3. 付款凭证打印：合成客户付款后的商务存根和购物小票，辅助识别并记录金额；
4. 员工工牌制作：批量制作员工工牌并完成 A4 排版与打印；
5. 销售业绩报表：统计销售流水并展示区间汇总、趋势、周期对比和商品明细。

项目默认通过 `http://localhost:8900` 提供统一 Portal 和五个独立业务 SPA，共六个前端构建产物。Portal 工作台首页集中展示全部业务板块，并在“业务板块”标题右侧提供当前项目的 GitHub 仓库入口；该入口会在新标签页中打开，不影响当前工作台。仓库货品标签、周边货品价签和付款凭证打印拥有独立 API 与数据表；销售业绩报表读取付款凭证已记录的销售流水，只做只读统计；员工工牌板块完全在浏览器内运行，不创建 API、数据库或本地持久化数据。

> 本项目只统一联想品牌、入口、部署、健康检查和维护方式，不合并各业务的数据模型。三个持久化业务在同一个 SQLite 文件中按模块前缀使用各自独立的表，表结构、索引和读写互不影响；员工工牌使用独立的浏览器内 A4 打印流程，销售业绩报表不拥有独立存储，不接触其他板块数据。

## 更新记录

每次功能、配置、部署方式或文档更新都必须同步维护 GitHub 仓库文档，并按 `YYYY-MM-DD` 记录更新日期和主要内容。最新更新与完整历史请查看 [CHANGELOG.md](CHANGELOG.md)。

当前最新记录：`2026-11-02`，发布 `0.6.0`：三个持久化业务合并为统一 SQLite 数据库 `store/store.sqlite`，各模块表以模块前缀隔离；新增第五个业务板块“销售业绩报表”，提供区间汇总、按日/月/季/年趋势、周期对比、商品明细和销售流水分页查询；付款凭证 OCR 识别结果新增结构化解析（商户、日期、金额、订单号、支付方式和商品明细）并落库；移除价格展牌模块及其数据表，`.lsbackup` 升级为 `formatVersion: 3` 三库格式。`0.5.1` 修复 root updater 平台已完整安装但遗漏启用环境变量时的在线安装入口识别。

## 板块说明

| 业务板块 | 业务用途 | Portal 路由 | 独立 SPA | API | 数据库 | 当前输出能力 |
| --- | --- | --- | --- | --- | --- | --- |
| 仓库货品标签 | 管理电脑 SKU、名称、配置、颜色、添加日期和备注 | `/#/computer-labels` | `/modules/computer-labels/` | `/api/computer-labels` | `store.sqlite` 中的 `computer_*` 表 | 46mm × 45mm，A4 纵向，24 张/页 |
| 周边货品价签 | 管理电脑、手机、平板及周边商品的品类、名称、价格和添加日期 | `/#/price-labels` | `/modules/price-labels/` | `/api/price-labels` | `store.sqlite` 中的 `price_*` 表 | 70mm × 28mm，A4 横向，28 张/页 |
| 付款凭证打印 | 将商务存根和购物小票合成到一张 A4，识别并记录付款金额 | `/#/receipt-assistant` | `/modules/receipt-assistant/` | `/api/receipt-assistant` | `store.sqlite` 中的 `receipt_*` 表 | 存根 + 小票，A4 打印或 PNG 下载 |
| 员工工牌制作 | 批量录入员工姓名、岗位和二维码，生成 A4 工牌排版 | `/#/employee-badges` | `/modules/employee-badges/` | 无 | 无 | 54mm × 85mm，A4 横向，10 张/页 |
| 销售业绩报表 | 统计销售流水，展示汇总、趋势、周期对比和商品明细 | `/#/sales-report` | `/modules/sales-report/` | `/api/sales-report` | 只读 `store.sqlite` 中的 `receipt_sales`、`receipt_sale_items` 表 | 页面内图表与明细表格，不打印 |

统一数据库固定位于 `$LENOVO_STORE_DATA_DIR/store/store.sqlite`，使用 WAL 模式、`busy_timeout = 5000` 并开启外键约束。三个持久化模块的表分别以 `computer_`、`price_`、`receipt_` 为前缀，表结构与索引互不影响，等价于原来每个模块一个独立库。

仅在 `npm run dev`、`NODE_ENV=development` 或测试模式下，未设置 `LENOVO_STORE_DATA_DIR` 才会使用仓库内的 `data/`；生产启动缺少该变量会直接失败，防止新 release 静默创建空库。

### 仓库货品标签

- 商品新增、编辑、删除和批量删除；
- 按 SKU、名称、配置和添加日期实时模糊搜索；
- 新增和编辑时可设置 `YYYY-MM-DD` 添加日期，新商品默认当天，旧数据库自动从创建时间回填；
- 复制现有商品后新增；
- “保存”和“保存并新增”两种录入流程；
- 每个商品可设置独立打印数量；
- Excel 导入、Excel 导出；新格式包含 `added_date`，导入同时接受“添加日期”表头，旧文件缺省时保持兼容；
- SQLite 数据库备份与恢复；
- 46mm × 45mm 标签预览和 A4 批量打印；
- 标签 SKU 使用 11pt 联想红粗体并上移 1mm，字号比 13pt 商品名称小 2pt；行高为 1.05，与商品名称间距为 0.5mm，屏幕预览与实际打印保持一致。

电脑商品标签不保存销售价格，其 SKU 模型不会与价格标签模块合并。

### 周边货品价签

- 商品和品类管理；商品可设置并展示 `YYYY-MM-DD` 添加日期，新商品默认当天，旧数据库自动从创建时间回填；
- 桌面端使用占满视口的左右工作台：左侧固定放置搜索、自动换行的多行品类筛选、当前结果全选、独立品类管理、商品录入和 JSON 备份恢复，右侧商品列表占满剩余空间并独立滚动，表头始终可见；布局已针对 1920 × 1080 Portal 内嵌区域压缩，常用工具无需滚动即可完整显示；
- “新增品类”位于商品录入上方的独立品类管理卡片中；名称输入框和“保存品类”按钮始终显示，无需先点击展开，支持 Enter 保存和 Esc 清空，新增成功后会自动选中该品类用于商品录入；
- 搜索和品类筛选只改变当前显示结果，当前结果全选不会清除其他筛选条件下已加入打印队列的商品；
- 900px 及以下自动切换为单列自然滚动，避免手机和平板出现多层滚动区域；
- JSON 全量导出；导出格式为 `schemaVersion: 2` 并包含 `added_date`，导入继续兼容 v1 备份并从 `created_at` 派生日期；
- JSON 导入前校验和单事务全量恢复；
- Lenovo Logo、价格格式化和商品名称字号自适应；
- 70mm × 28mm 标签预览和 A4 横向批量打印。

该模块覆盖电脑、手机、平板和周边商品价格，不要求电脑 SKU，也不复用电脑商品标签数据库。

### 付款凭证打印

- 商务存根和购物小票两张图片上传或拖放；
- A4 Canvas 合成、预览、打印和 PNG 下载；
- 百度 OCR 自动识别付款金额；
- OCR 结果人工覆盖保护；
- OCR 凭据配置，以及可查看详情、逐条删除和导出 CSV/JSON 的识别记录管理；
- 按 `Asia/Shanghai` 自然月显示每月 500 次免费额度的本机已用、剩余和超额次数；调用账本按实际百度 OCR endpoint 请求计数，access token 获取不计，删除历史不返还次数；
- 销售金额保存、撤销和恢复；
- 今日统计，以及最近 30 天销售额趋势；趋势图使用 ECharts 单根平滑实线，不显示常驻数据点、第二条笔数线、面积填充或双 Y 轴，销售笔数保留在汇总和悬浮信息中；
- 趋势图支持悬停或触屏查看完整日期、销售额和有效笔数，可切换近 7/14/30 天，并可点击绘图区任意日期查看明细；
- 图表获得焦点后支持 `←`、`→` 逐日移动，`Home`、`End` 跳到首末日期，`Enter` 或空格打开详情；原生日期下拉保留为完整的键盘和无障碍兜底；
- 趋势详情弹窗显示当日有效销售额、有效笔数、全部记录、撤销记录、记录时间和状态，并可直接撤销或恢复；同一记录操作期间按钮会锁定，避免重复提交；
- 趋势区域支持手动刷新和响应式重绘；刷新失败时保留上一次可用图表并显示重试入口，零销售时仍可选择日期查看已撤销记录；
- OCR 请求超时、重试、并发限制和频率限制；
- OCR 凭据使用 AES-256-GCM 加密保存。

页面中的 500 次额度来自本机自 `0.2.2` 起记录的百度 OCR endpoint 调用，用于门店侧估算；同一百度账号在其他系统产生的调用不会出现在这里，最终额度以百度智能云控制台为准。

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
- 打印文档使用完整的 297mm × 210mm A4 横向页面，按 5 列 × 2 行排列；每张 54mm × 85mm 工牌之间保留 2mm 横纵裁剪通道，总网格为 278mm × 172mm，左右各留 9.5mm，网格从页面顶边向下排列，剩余 38mm 留在底部；
- 右侧实时预览使用显式 297:210 A4 页面和绝对定位的 278mm × 172mm 网格，不依赖 padding 盒模型；每个裁切格显式保持 54:85，并等比显示 2mm 裁剪通道，裁切线加深，页码不参与纸张阴影；10 张工牌可完整显示，预览区域受限时提供滚动；
- 桌面端工作区取消固定最大宽度，左右卡片等高拉伸并占满页头下方空间；左侧保持适合录入的宽度，右侧自动使用 1080P 屏幕的全部剩余宽度；
- 打印使用隔离 iframe，等待字体、背景和二维码图片加载完成后再打开浏览器打印窗口；
- 页面关闭或刷新后数据自动消失，不调用 API，不使用 localStorage、sessionStorage、IndexedDB 或数据库。

二维码通过临时 Object URL 在浏览器内显示。替换、删除、清空或离开页面时会主动释放对应 URL。员工资料不会发送到服务器，也不会进入其他业务板块。打印时必须选择 A4、横向、实际大小（100%），关闭“适合页面”和页眉页脚；实体尺寸以灰色裁切边界为准，不以联想红背景的阴影边缘为准，并应在首张样张上复核 54mm × 85mm。

### 销售业绩报表

- 独立入口为 `/#/sales-report`，SPA 为 `/modules/sales-report/`，API 为 `/api/sales-report`；
- 只读统计，不写入任何数据；数据来源是付款凭证模块已记录的 `receipt_sales` 与 `receipt_sale_items` 表，不建立独立数据库，也不提供备份或恢复入口；
- `GET /api/sales-report/overview` 返回区间汇总：销售额合计、笔数、有效销售天数、笔均金额、日均金额、金额中位数、最高单日，以及上一等长周期的销售额与环比变化；
- `GET /api/sales-report/trend` 支持 `day`、`month`、`quarter`、`year` 四种粒度，返回按周期聚合的销售额与笔数序列；
- `GET /api/sales-report/comparison` 返回按月、按季、按年三个维度的周期对比，并附带与上一周期的变化百分比；
- `GET /api/sales-report/items` 按商品名称聚合明细，返回出现次数、数量和金额小计，最多 100 条；尚未记录商品明细时返回空列表并提示“尚未记录商品明细”；
- `GET /api/sales-report/records` 返回销售流水分页查询，每页最多 200 条，并附带该笔销售对应的商品明细；
- 区间由 `start`、`end`（`YYYY-MM-DD`）控制；缺省时以库中最早销售日到最近销售日为界，无数据时回退为最近 30 天；`start` 晚于 `end` 时收敛为 `end` 当天，区间跨度上限为 3660 天（约 10 年）；
- 所有汇总口径只统计 `status = 1` 的有效销售记录，已撤销记录不计入销售额、笔数和趋势；
- 页面提供总览卡片、趋势折线图（ECharts）、周期对比表格与图表、销售流水分页表格和商品明细表格；图表支持响应式重绘和悬浮查看周期、销售额与笔数；
- 页面顶部汇总卡片始终展示全部历史数据，下方统计区间跟随所选日期范围变化；
- 报表为纯展示页面，不提供打印输出。

销售业绩报表不拥有独立存储，删除或卸载报表板块不会影响销售流水本身；流水仍由付款凭证模块维护。

## 系统架构

```text
Browser
  |
  | http://localhost:8900
  v
Express 5 unified server
  |-- /                           Portal SPA
  |-- /modules/computer-labels    仓库货品标签 SPA
  |-- /modules/price-labels       周边货品价签 SPA
  |-- /modules/receipt-assistant  付款凭证打印 SPA
  |-- /modules/employee-badges    员工工牌制作 SPA（纯浏览器状态）
  |-- /modules/sales-report       销售业绩报表 SPA
  |-- /api/computer-labels        仓库货品标签 API
  |-- /api/price-labels           周边货品价签 API
  |-- /api/receipt-assistant      付款凭证 API
  |-- /api/sales-report           销售业绩报表 API（只读）
  `-- /api/system                 健康检查与统一备份恢复 API
         |
         |-- $LENOVO_STORE_DATA_DIR/store/store.sqlite  统一数据库
         |     |-- computer_*        仓库货品标签表
         |     |-- price_*           周边货品价签表
         |     `-- receipt_*         付款凭证与销售流水的表
         `-- $LENOVO_STORE_DATA_DIR/secrets/receipt-ocr.key
```

Portal 通过同源 iframe 加载五个独立业务 SPA。四套打印实现分别维护自己的纸张方向、毫米尺寸、分页和资源加载流程；员工工牌使用独立 iframe 打印 A4 横向页面，不向其他模块注入打印样式。所有模块的页面级打印内容统一从 A4 顶边开始向下排列，末页不再垂直居中或落在页面底部；标签、工牌和票据自身内部的固定布局保持独立。销售业绩报表为纯屏幕展示，不参与打印。

## 前端视觉与打印隔离

六个前端（Portal + 五个业务 SPA）通过 `@lenovo-store/shared/theme.css` 使用同一套屏幕设计令牌，并共享用户指定的红色联想 SVG Logo，统一字体、画布、色板、间距、圆角、阴影、卡片、表单和按钮。Portal 将板块工具栏与 iframe 组合成一个完整工作区，五个业务 SPA 仍可通过各自地址独立开发和打开。

共享主题遵循以下边界：

- 只在 `@media screen` 中提供界面样式，不定义 `@page` 或共享 `@media print`；
- 每个 SPA 主动导入主题，Portal 不向 iframe 注入 CSS；
- 电脑商品标签继续由模块自身维护 46mm × 45mm 标签和 A4 纵向打印规则；
- 商品价格标签继续维护独立的字号测量 DOM、70mm × 28mm 标签和 A4 横向打印规则；
- 付款凭证继续通过 Canvas 合成图片，并在临时隔离 iframe 中打印 A4；
- 员工工牌通过独立 DOM/CSS 打印文档维护 54mm × 85mm 工牌、A4 横向 5×2 网格和裁切边界；
- 销售业绩报表使用 ECharts 渲染趋势与对比图表，只参与屏幕显示，不定义打印样式；
- 统一的是屏幕操作体验，不是四种打印文档的几何尺寸或业务模型。

## 技术栈

- Node.js `22.21.1`；
- npm workspaces；
- Vue `3.5.43`；
- Vite `7.3.6`；
- Element Plus `2.14.4`；
- Apache ECharts `6.1.0`（付款凭证销售趋势、销售业绩报表图表）；
- Express `5.1.0`；
- better-sqlite3 `12.0.0`；
- Multer `2.4.0`；
- Sharp `0.35.5`；
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
│   ├── sales-report/           # 销售业绩报表 SPA（只读统计）
│   └── server/                 # Express 服务、统一数据库和四个后端模块
├── packages/
│   └── shared/                 # 板块元数据、共享屏幕主题与联想 Logo
├── docs/
│   ├── ubuntu-arm64-deployment.md # Ubuntu ARM64 逐条部署与恢复手册
│   └── ubuntu-deployment.md    # 通用 Ubuntu 持久化与恢复指南
├── ops/
│   ├── install-updater.sh      # root 在线更新平台安装脚本
│   ├── updater/                # systemd oneshot 更新器
│   ├── systemd/                # 服务与更新器单元模板
│   └── release/                # Release 签名密钥生成工具
├── data/
│   ├── store/                  # 统一 SQLite 数据库（开发和测试回退位置）
│   ├── computer-labels/        # 旧版独立库，仅供历史备份兼容
│   ├── price-labels/           # 旧版独立库，仅供历史备份兼容
│   ├── receipt-assistant/      # 旧版独立库，仅供历史备份兼容
│   └── secrets/                # OCR 加密密钥
├── scripts/
│   └── migrate-legacy-data.js  # 三个旧项目数据一次性迁移脚本
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

Ubuntu ARM64（`arm64/aarch64`）生产服务器应优先阅读 [Ubuntu ARM64 从零部署、迁移、在线更新与灾难恢复手册](docs/ubuntu-arm64-deployment.md)。该手册按部署机实际执行顺序覆盖架构与资源检查、系统依赖、固定 Node.js ARM64、服务账号、UFW、数据迁移、systemd、签名在线更新、备份、故障演练和安全回退；不支持 `armhf`/ARMv7 生产部署。

其他 Ubuntu 部署及通用数据恢复原理请阅读 [Ubuntu 部署、数据持久化与备份恢复指南](docs/ubuntu-deployment.md)。该指南包含首次部署、systemd 服务、仓库内数据无损外迁、日常升级、定时备份、冷恢复、回滚和“升级后数据为空”的应急排查步骤；以下内容保留为快速参考。

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

统一服务需要先完成 `npm run build`，因为 Express 会直接托管 Portal 和五个业务 SPA 的六套 `dist` 目录。启动日志会输出当前实际使用的数据根目录及其来源。

### 现有服务器一次性无损迁移

如果服务器目前仍使用仓库内 `data/`，应在下一次拉取或切换 release 前完成一次迁移。`0.6.0` 起数据统一存放在 `store/store.sqlite`；从 `0.5.x` 或更早版本升级时，旧的三个独立库目录会保留但不再被读写，启动时统一库从旧库导入已有数据：

1. 停止 Node/PM2/systemd/容器服务，确保没有 SQLite 写入；
2. 将当前仓库的整个 `data/` 目录额外备份到独立位置；
3. 创建代码目录之外的持久化目录，并将 `data/` 内全部内容原样复制过去；`store/` 与 `secrets/receipt-ocr.key` 必须成对迁移，旧版本的 `computer-labels/`、`price-labels/`、`receipt-assistant/` 目录一并保留，供首次启动导入；
4. 为实际服务账号设置目录读写权限，并在进程管理器中永久配置 `LENOVO_STORE_DATA_DIR`；
5. 拉取代码、执行 `npm ci && npm run build`，然后启动服务；
6. 从启动日志确认实际数据目录，再检查五个业务模块与统一库 `store/store.sqlite`；仓库货品、周边价签、付款凭证和销售流水记录数应与迁移前一致。

示例（请将 `<repo>` 和 `<service-user>` 替换为服务器实际值；目标或 staging 已存在时命令会停止，不会合并覆盖）：

```bash
# 先停服，再执行复制；不要在SQLite仍写入时只复制主数据库文件
TARGET=/var/lib/lenovo-store-operations
STAGING="${TARGET}.staging"
test ! -e "$TARGET" || { echo "目标已存在，停止迁移：$TARGET" >&2; exit 1; }
test ! -e "$STAGING" || { echo "staging已存在，停止迁移：$STAGING" >&2; exit 1; }
sudo install -d -m 0750 -o <service-user> -g <service-user> "$(dirname "$TARGET")"
sudo cp -a <repo>/data "$STAGING"
sudo test -f "$STAGING/store/store.sqlite" || echo '统一库不存在，首次启动将创建。'
sudo test -d "$STAGING/receipt-assistant" || echo '缺少旧付款凭证库，OCR 历史将为空。'
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
- 销售业绩报表：`http://localhost:8900/#/sales-report`
- 系统健康接口：`http://localhost:8900/api/system/health`

服务器仍兼容 `/system`、`/computer-labels`、`/price-labels`、`/receipt-assistant`、`/employee-badges` 和 `/sales-report` 旧直链，并使用 `308` 跳转到对应 hash 地址；新链接统一使用 hash 地址，避免部署环境未配置 history rewrite 时刷新落入 API 404。

### 反向代理与刷新

生产反向代理应将 `/`、`/assets/`、`/modules/` 和 `/api/` 保留原始路径转发到统一服务的 `8900` 端口，不要把未命中的页面路径改写到 `/api`，也不要对 API 或缺失的 JavaScript/CSS 使用全局 `index.html` 回退。代理必须保留原始 `Host`，并设置正确的 `X-Forwarded-Proto`；服务仅信任回环代理提供的转发协议，用于统一维护接口的严格同源校验。Portal 的 hash 路由不依赖代理层 SPA rewrite；未知 API 始终返回 JSON 404，缺失资源和未知页面返回普通页面 404。

如果部署后仍返回英文 `{"code":1,"data":null,"msg":"Not Found"}`，说明请求未进入当前 Express 服务或服务器仍运行旧版本；请核对反向代理 upstream、实际启动命令、部署提交哈希和进程重启状态。

## 开发模式

```bash
npm run dev
```

该命令同时启动统一后端、Portal 和五个业务板块开发服务器：

| 服务 | 开发地址 |
| --- | --- |
| Portal | `http://localhost:5173/` |
| 仓库货品标签 | `http://localhost:5174/modules/computer-labels/` |
| 周边货品价签 | `http://localhost:5175/modules/price-labels/` |
| 付款凭证打印 | `http://localhost:5176/modules/receipt-assistant/` |
| 员工工牌制作 | `http://localhost:5177/modules/employee-badges/` |
| 销售业绩报表 | `http://localhost:5178/modules/sales-report/` |
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

## GitHub 更新检测、签名 Release 与在线安装

系统状态页 `http://localhost:8900/#/system` 检查固定仓库 `zifeng-chen/lenovo-store-operations` 的稳定 Release。完成 Ubuntu 更新平台安装后，检测到更高版本会显示“安装最新版本”按钮：

- `GET /api/system/update/status`：读取当前版本、最近一次检查和安装任务状态，不主动连接 GitHub；从 `0.5.1` 起，若标准 root updater 配置、程序及 IPC 目录全部安全存在且未显式设置启用变量，服务会自动识别并启用安装入口；显式 `LENOVO_STORE_UPDATE_ENABLED=false` 始终禁用；
- `POST /api/system/update/check`：仅接受同源页面触发，使用 8 秒超时、15 分钟成功缓存、GitHub 限流退避、`ETag` 条件请求，并在最多 300 条 Release 内比较严格 `vX.Y.Z` 稳定版本；
- `POST /api/system/update/install`：只接受服务端刚成功检查、未过期、无错误且确认为 latest 的新版本 tag；请求必须带维护标识、非空同源 `Origin`，并拒绝 `Sec-Fetch-Site: cross-site`；
- 未配置 `LENOVO_STORE_MAINTENANCE_TOKEN` 时，可信局域网 Portal 可免 Bearer 提交；配置后在线更新与备份恢复共同使用维护令牌。固定维护标识和同源检查不是账号认证，无令牌部署必须用 UFW、VLAN 或反向代理 ACL 限制可信网段，禁止公网暴露；
- Web 服务不执行 Shell、npm 或 systemctl，只写入受限 `0600` 单任务文件；root-owned systemd oneshot 固定下载签名 GitHub Release，并验证 Ed25519、SHA-256、manifest/tag/version/full commit、下载域名和归档结构；
- 更新器先创建外部一致性备份，以独立不可登录 builder 账号执行 `npm ci --include=dev` 和 `npm run check`，再原子切换 `current`/`previous`；新版本需连续三次通过版本、完整 commit、外部数据目录、前端模块和统一数据库健康检查，否则自动回滚；
- health 契约按目标版本分级校验：`v0.6.0` 起要求五个业务模块加统一库，`v0.5.0`–`v0.5.x` 要求五模块加四套独立库，更早版本使用四模块兼容视图，避免跨版本升级时因模块集合不一致误判失败；
- fsync 事务 journal 记录领取、准备、切换、恢复与提交阶段，进程终止或断电后由 systemd 启动门保守恢复。

可选 `LENOVO_STORE_GITHUB_TOKEN` 只由服务端版本检查使用，不进入浏览器、API 响应、日志或 Git；root updater 当前使用 GitHub 公开 Release 下载接口，因此发布资产必须保持公开。首次启用、`0.3.0` Git checkout 迁移、故障演练和人工回退见 [Ubuntu 部署指南](docs/ubuntu-deployment.md)。

根 `package.json` 的 `version` 是整套产品的唯一发布版本。准备新版本时先更新版本、README、CHANGELOG 和相关文档并提交，再创建完全一致的严格 `vX.Y.Z` tag。例如发布 `0.6.0`：

```bash
npm version 0.6.0 --no-git-tag-version --workspaces=false
# 按实际日期更新文档和 CHANGELOG，完成验证后提交并推送 main
git tag v0.6.0
git push origin v0.6.0
```

`.github/workflows/release.yml` 会校验 tag、根 package 与 lockfile 版本一致，并依次执行 `npm ci`、全量构建、检查和 `npm audit --audit-level=high`。全部通过后创建正式 GitHub Release，包含源码与构建产物 tar 包、`manifest.json`、Ed25519 `manifest.json.sig`、`SHA256SUMS` 和包内 `release-info.json`。manifest 固定声明 updater contract `1`、`npm-ci-on-target` 和 `/api/system/health`；缺少签名 Secret、公钥指纹 Variable 或二者不匹配时发布失败。密钥生成工具位于 `ops/release/generate-signing-keypair.js`。

## 数据备份与恢复

系统状态页 `http://localhost:8900/#/system` 提供统一数据保护入口。员工工牌不保存数据，销售业绩报表只读且不拥有存储；其余三个板块一次生成一个 `.lsbackup` 文件，恢复时上传同一个文件并逐个选择模块：

1. 点击“下载全部数据库备份”；维护令牌模式按页面提示输入令牌，可信局域网免令牌模式可直接下载；
2. 当前 writer 固定生成 `.lsbackup` `formatVersion: 3`，包含仓库货品标签、周边货品价签、付款凭证打印三套逻辑快照；付款凭证快照包含 OCR 识别历史、结构化解析结果、销售流水、商品明细和调用次数账本，本机密钥模式下还会包含配套 OCR 密钥；
3. 恢复时选择 `.lsbackup` 并点击“上传并检查”；上传只检查格式、长度、SHA-256、SQLite 完整性、表结构、业务字段和记录数，不会立即覆盖数据；
4. 核对备份编号、创建时间和各表记录数，在目标模块点击“恢复此模块”；
5. 二次确认弹窗中完整输入“恢复”。每次只恢复一个模块，没有跨三库的“一键恢复全部”；各模块采用严格校验后的 staged/rollback 整表替换；
6. 用完后点击“清除”。服务端恢复会话最长保留 30 分钟，过期后必须重新上传。

reader 接受历史 v1 三库包、v2 四库包和当前 v3 三库包。v1 和 v2 中的价格展牌条目在 `0.6.0` 后不再恢复，inspect 会将其标记为“未包含（not-in-backup）”并保持现有数据不变；v1/v2 内的其他三个模块仍可分别恢复。旧 `0.5.x` 及更早服务不能读取 v3，这是向前版本边界：升级时必须先更新代码并重启服务，再导入 v3，不能用旧服务预先恢复。

恢复付款凭证模块时，销售和识别历史按备份替换；OCR 调用次数账本只按请求与尝试编号合并，不会清空目标服务器已有次数，避免通过恢复旧备份增加当月免费剩余次数。

`.lsbackup` 最大 1GB。它是无压缩的 `LSOBKP01` 单文件容器，不依赖 ZIP/TAR 解包；清单拒绝未知模块、重复或重叠条目、长度越界、尾随数据和摘要不一致。SHA-256 与数据库检查用于发现损坏，**不能证明文件来源**，只应恢复从受信任服务器下载并保存在受控位置的文件。备份可能包含可用于解密百度 OCR 凭据的密钥，禁止上传到公共网盘、群聊或工单附件。

如果源服务使用 `OCR_CONFIG_ENCRYPTION_KEY`，统一包不会导出该环境密钥，只记录密钥指纹；目标服务必须配置相同环境密钥才能恢复付款凭证。密钥不匹配时，检查结果只会把付款凭证标为“不兼容”，仓库货品标签和周边货品价签仍可独立恢复。本机密钥模式则使用包内源密钥解密 OCR 配置，再使用目标服务器当前有效密钥重新加密，不会覆盖目标服务器密钥文件。

现有单模块入口继续保留：

- 仓库货品标签：板块内 Excel 导入导出和 SQLite `.db` 备份恢复；
- 周边货品价签：板块内 JSON 导入导出，导入前校验并在单事务中全量恢复；
- 付款凭证打印：当前使用系统状态页统一入口恢复；
- 员工工牌制作：页面刷新或关闭后自动清空，没有数据库备份；
- 销售业绩报表：只读统计，不拥有存储，没有独立导入导出入口。

统一维护 API 始终要求同源请求和 `X-Lenovo-Store-Maintenance: 1`。`LENOVO_STORE_MAINTENANCE_TOKEN` 为可选增强：配置后必须至少 24 个字符，页面会发送 `Authorization: Bearer <token>`，令牌只保存在当前页面内存；未配置时服务可正常启动，并允许可信局域网客户端免 Bearer 执行统一备份和恢复，不再限制为服务器本机。固定维护标识不是密码，同源检查也不能阻止无 `Origin` 的脚本客户端，因此无令牌部署必须通过 Ubuntu 防火墙或 VLAN 只允许可信网段访问 8900，禁止暴露到公网。

服务器定时和部署前备份仍推荐使用在线备份命令，并将备份目录放在数据根目录之外：

```bash
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations \
LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations \
npm run backup:data
```

该命令通过 SQLite backup API 分别创建三个逻辑一致性快照，执行 `PRAGMA integrity_check`，记录各表数量、文件大小和 SHA-256，同时备份当前实际使用的 32 字节 OCR 加密密钥并验证它能够解密快照中的凭据，最后生成 `manifest.json`。无论运行时密钥来自本机文件还是 `OCR_CONFIG_ENCRYPTION_KEY`，备份内都统一保存为权限 `0600` 的 `secrets/receipt-ocr.key`；无法确认可恢复时整个备份会失败。备份先写入 staging 目录，全部成功后再发布为时间戳目录，不会覆盖已有备份。`LENOVO_STORE_BACKUP_DIR` 必须是绝对普通目录，不能是符号链接，也不能与代码目录或数据目录重叠。

付款凭证数据库中的 OCR 凭据是密文。只有配套的 `receipt-ocr.key` 才能解密；丢失密钥后不能从数据库恢复原凭据，需要在页面重新配置。

不要在 SQLite 正在写入时只复制主 `.sqlite` 文件，否则 WAL 中已提交的数据可能丢失。优先使用 `npm run backup:data`；手工冷备份时必须先停服，再复制完整数据目录。每次部署前应先生成一份外部备份，并定期在隔离目录做恢复演练。

## OCR 配置与安全

付款凭证模块优先读取数据库中的加密 OCR 配置，也支持以下环境变量：

- `BAIDU_OCR_API_KEY`
- `BAIDU_OCR_SECRET_KEY`
- `OCR_CONFIG_ENCRYPTION_KEY`
- `BAIDU_OCR_ENDPOINT`

建议通过付款凭证页面配置 OCR 凭据。页面和配置查询接口只返回掩码状态，不返回明文 Secret Key。

本项目定位为门店内部局域网工具，没有完整的用户账号系统或公网部署配置。默认 `HOST=0.0.0.0` 会允许局域网访问；未配置维护令牌时，任何能访问服务端口并构造维护请求的客户端都可能下载或覆盖业务数据库，并在服务端已检测到新版本时提交签名在线更新，因此必须使用防火墙、VLAN 或反向代理 ACL 限制可信网段，禁止暴露到公网。需要更强隔离时配置 `LENOVO_STORE_MAINTENANCE_TOKEN`；维护令牌仍不能替代全站登录系统。

## npm 脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动六个前端开发服务器和统一后端 |
| `npm run build` | 构建 Portal 和五个业务 SPA |
| `npm start` | 启动 8900 统一生产服务 |
| `npm run check` | 构建检查五个业务 SPA，并检查后端、数据脚本和 Release 脚本语法 |
| `npm run migrate:data` | 一次性迁移三个旧项目数据库和 OCR 密钥到统一库 `store/store.sqlite` |
| `npm run backup:data` | 在线一致性备份统一库各模块逻辑快照、OCR 密钥和校验清单 |
| `npm run release:verify -- vX.Y.Z` | 校验稳定版 tag 与根 package、lockfile 版本一致 |
| `npm run release:pack -- vX.Y.Z` | 在全量构建后生成签名 Release 的源码与构建产物包、manifest 和 SHA-256 校验文件 |
| `npm run release:sign` | 使用私钥签名 manifest，并核对 `RELEASE_SIGNING_PUBLIC_KEY_SHA256` 固定部署公钥指纹 |

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

- 根 `package.json` 的产品版本，以及当前构建的完整提交哈希、短提交和 `stable` 通道；
- `persistentDataConfigured` 是否已使用外部持久化数据根；生产探针应要求该值为 `true`；
- `portalReady` 是否存在 Portal 构建产物，以及每个业务板块的 SPA 构建产物是否存在；
- 有 API 的板块是否已挂载；
- 使用 SQLite 的板块是否已有数据目录并成功连接数据库；
- 板块处于“已迁移”或“已就绪”状态。

员工工牌制作在健康接口中会返回 `apiReady: null`、`dataDirectoryReady: null` 和 `databaseConnected: null`，表示这些能力不适用，而不是运行异常。当前 health、Release 和 updater 契约固定检查五个业务模块、统一数据库 `store/store.sqlite`，以及 Portal + 5 个业务 SPA 的六套前端构建产物。

## 打印验收

浏览器构建和 API 检查不能替代实体打印验收。首次部署或更换打印机后，应分别检查：

1. 电脑商品标签是否为 46mm × 45mm，A4 纵向且每页 24 张；
2. 商品价格标签是否为 70mm × 28mm，A4 横向且每页 28 张；
3. 价格标签中的长商品名称字号自适应是否与改造前一致；
4. 付款凭证是否在一张 A4 上正确显示存根和小票，PNG 下载结果是否与打印预览一致；
5. 员工工牌是否为 54mm × 85mm，A4 横向、5 列 × 2 行且每页 10 张；
6. 员工工牌之间是否保留 2mm 横纵裁剪通道，裁切线是否未占用 54mm × 85mm 成品尺寸；
7. 每名员工的打印份数是否可在 1–99 之间设置，人数、总张数和页数统计是否正确；
8. 1 人 × 10 份是否恰好为 1 页，1 人 × 11 份是否为 2 页且第二页只有 1 张，没有额外空白页；
9. “默认工牌”和“联想红工牌”的姓名、岗位、二维码、文案和裁切边界是否完整，二维码是否可正常扫码；
10. 浏览器打印缩放是否为实际大小（100%），是否关闭“适合页面”和页眉页脚；
11. 打印机驱动的纸张尺寸、方向、边距和缩放是否与浏览器一致。

销售业绩报表为纯屏幕展示，不提供打印输出，无需纳入打印验收。

员工工牌的浏览器预览按真实毫米比例生成，打印文档使用完整的 297mm × 210mm A4 横向页面；5 × 2 个 54mm × 85mm 裁切格之间保留 2mm 横纵裁剪通道，总网格为 278mm × 172mm。打印机驱动仍可能执行二次缩放；首次使用时应打印 10 张和 11 张两组样张，确认分页无额外空白页，并测量单张 54mm × 85mm、相邻裁切线间距 2mm、整页网格 278mm × 172mm。若尺寸不符，应确认纸张为 A4、缩放为 100%，并关闭“适合页面”“缩放到可打印区域”等选项后重新打印。

## 常见问题

### 8900 端口被占用

指定其他端口启动：

```bash
PORT=8910 npm start
```

对应的 Vite API 代理默认仍指向 8900。长期修改开发端口时，需要同步调整使用 API 代理的业务 `vite.config.js`；员工工牌没有 API 代理。

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

五个联想业务板块已统一运行在 8900 端口：

- 仓库货品标签、周边货品价签和付款凭证打印均有独立 SPA、API 与数据表，三个模块的数据统一存放在 `store/store.sqlite` 并按模块前缀隔离；员工工牌为纯浏览器 SPA；销售业绩报表为只读统计 SPA，不拥有独立存储；
- 统一数据库使用 WAL 模式并开启外键约束，各模块表结构、索引和读写互不影响，等价于原来的独立库；旧版按模块拆分的数据库目录会保留但不再被业务读写；
- 销售业绩报表提供区间汇总、按日/月/季/年趋势、月/季/年周期对比、商品明细聚合和销售流水分页查询，所有口径只统计有效销售记录；
- 付款凭证的 OCR 识别结果新增结构化解析，可提取商户、日期、金额、订单号、支付方式和商品明细，结构化结果与商品明细一并落库，供销售业绩报表统计；
- 员工工牌制作支持多员工录入、每人独立设置 1–99 打印份数及默认工牌/联想红工牌主题，使用真实 54mm × 85mm 裁切格、2mm 裁剪通道和完整 A4 横向页面完成 10 张/页预览与打印，不持久化员工信息；
- 用户指定的联想 SVG Logo 已作为共享屏幕品牌资产，Portal 和五个业务 SPA 的中文命名已统一；
- 三个旧项目数据库及 OCR 密钥支持一致性迁移到统一库；
- Portal、五模块 health、三库备份恢复、六套前端构建和生产静态托管已完成；
- Portal 和五个业务 SPA 已接入共享屏幕设计令牌，板块工作区、页头、卡片、表单和按钮风格保持一致；
- 四套打印实现分别维护，员工工牌通过隔离 iframe 打印，不会覆盖其他模块打印 CSS；
- 数据查询、导出、备份和 OCR 配置解密已通过无破坏冒烟验证；
- 实体标签、员工工牌和 A4 付款凭证仍需在实际打印机上完成最终尺寸与颜色验收。
