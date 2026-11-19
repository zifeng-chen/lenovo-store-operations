# 模块接口与数据表

本文列出各板块的 HTTP 接口、路由与数据表。进程结构、请求链路和打印实现见 [架构与交互逻辑](architecture.md)；样机 Agent 的通信契约见 [样机 Agent 协议](sample-devices-agent-protocol.md)。

## 通用约定

- 所有业务接口挂在 `/api/{模块 id}` 下，成功响应统一为 `{ code: 0, data, msg }`。
- `/api/system/health` 与 `/api/system/update/*` 不开放 CORS；其余业务接口按模块自身策略处理。
- 表名统一由 `apps/server/src/db/unified-database.js` 的 `TABLE_PREFIX` 生成：`computer_`、`price_`、`pricetag_`、`receipt_`、`sampledev_`。
- 新增持久化板块时必须同时更新：`TABLE_PREFIX`、`persistence-service.js` 的 `PREFIX_TABLES` 与 `MODULES`、`backup-package.js` 的格式版本映射、`ops/updater/updater.mjs` 的 `CURRENT_MODULE_IDS`。

## 电脑标签打印 `computer-labels`

路由 `/#/computer-labels` · SPA `/modules/computer-labels/` · API `/api/computer-labels`

| 接口 | 用途 |
| --- | --- |
| `GET /products` | 按 SKU、名称、配置、添加日期模糊搜索 |
| `POST /products` | 新增商品 |
| `PUT /products/:id` | 编辑商品 |
| `DELETE /products/:id` | 删除商品 |
| `POST /products/batch-delete` | 批量删除 |
| `GET /products/export` | 导出 Excel |
| `POST /products/import` | 导入 Excel |
| `GET /backup` | 模块内 SQLite 备份 |
| `POST /restore` | 模块内 SQLite 恢复 |

数据表：`computer_products`。该板块不保存销售价格，与价格标签模块不共用商品模型。

## 外设价签打印 `price-labels`

路由 `/#/price-labels` · SPA `/modules/price-labels/` · API `/api/price-labels`

| 接口 | 用途 |
| --- | --- |
| `GET/POST /categories` | 品类列表与新增 |
| `GET /products` | 按名称与品类筛选 |
| `POST/PUT/DELETE /products` | 商品增删改 |
| `GET /data/export` | 模块内 JSON 全量导出 |
| `POST /data/import` | 模块内 JSON 全量导入（校验后单事务恢复） |

数据表：`price_categories`、`price_products`。`price_products` 也是价格展牌打印读取配件的来源。

## 价格展牌打印 `price-tags`

路由 `/#/price-tags` · SPA `/modules/price-tags/` · API `/api/price-tags`

| 接口 | 用途 |
| --- | --- |
| `GET/POST /cards`、`PUT/DELETE /cards/:id` | 展牌增删改 |
| `PUT /cards/selection` | 保存选中展牌 |
| `POST /cards/recalc` | 批量重算国补价等派生字段 |
| `GET /accessories` | 可选配件（读 `price_products`） |
| `GET/POST /services`、`PUT/DELETE /services/:id` | 配件与服务项 |
| `GET/POST /feature-copies`、`PUT/DELETE /feature-copies/:id` | 卖点文案库（按分类 + 图标名索引） |
| `GET/PUT /subsidy-config` | 国补配置 |

数据表：`pricetag_cards`、`pricetag_services`、`pricetag_selection`、`pricetag_config`、`pricetag_feature_copies`。

展牌内的卖点图标来自内置图标库（`apps/price-tags/public/icons/`，294 个图标，按笔记本/手机/平板/台式机四类归属、类内再按显示/性能/AI 等主题分组），文案来自 `pricetag_feature_copies`，内置文案见 `apps/price-tags/src/feature-copy.js`。

## 付款凭证打印 `receipt-assistant`

路由 `/#/receipt-assistant` · SPA `/modules/receipt-assistant/` · API `/api/receipt-assistant`

| 接口 | 用途 |
| --- | --- |
| `POST /ocr/amount` | 识别凭证金额（限流，可落库为销售记录） |
| `GET /ocr/history`、`GET/DELETE /ocr/history/:id` | 识别历史查询、详情与删除 |
| `GET /ocr/history/export` | 识别历史导出 |
| `GET /ocr/usage` | 当月识别调用次数 |
| `GET /ocr/config`、`PUT /ocr/config` | OCR 凭据配置与掩码状态 |
| `GET/POST /sales` | 销售流水查询与手工新增 |
| `GET /sales/today`、`GET /sales/trend` | 今日汇总与近期趋势 |
| `PUT /sales/:id/toggle` | 切换记录有效性 |

数据表：`receipt_sales`、`receipt_sale_items`、`receipt_ocr_config`、`receipt_ocr_history`、`receipt_ocr_usage`。凭据为密文，密钥在 `$LENOVO_STORE_DATA_DIR/secrets/receipt-ocr.key`。

页面「最近记录」只展示今日与昨日；更长区间的明细在销售业绩报表查看。

## 销售业绩报表 `sales-report`

路由 `/#/sales-report` · SPA `/modules/sales-report/` · API `/api/sales-report`

只读模块，不拥有数据表，全部指标来自 `receipt_sales` 与 `receipt_sale_items`。

| 接口 | 用途 |
| --- | --- |
| `GET /overview` | 区间汇总 |
| `GET /trend` | 按日/月/季/年趋势 |
| `GET /comparison` | 月/季/年周期对比 |
| `GET /items` | 商品明细聚合 |
| `GET /records` | 流水分页查询 |

只统计有效销售记录，不提供打印输出。

## 样机设备管理 `sample-devices`

路由 `/#/sample-devices` · SPA `/modules/sample-devices/` · API `/api/sample-devices`、`/api/agents`

| 接口 | 用途 |
| --- | --- |
| `GET /devices` | 设备列表（状态、分组、筛选） |
| `GET /devices/stats`、`GET /devices/groups` | 统计与分组 |
| `POST/PUT/DELETE /devices` | 设备增删改 |
| `POST /devices/batch-delete`、`POST /devices/batch-group` | 批量删除与批量分组 |
| `POST /tasks` | 下发任务 |
| `POST /tasks/:taskId/cancel` | 取消任务 |
| `GET /tasks`、`GET /tasks/:taskId` | 任务列表与详情 |
| `GET /audit`、`GET /audit/actions` | 审计日志与动作枚举 |
| `GET /enroll-secret-configured` | 注册密钥是否已配置 |
| `POST /devices/import/ip-range`、`POST /devices/import/csv` | 批量导入设备 |

数据表：`sampledev_devices`、`sampledev_tasks`、`sampledev_task_results`、`sampledev_audit_logs`、`sampledev_settings`、`sampledev_id_map`。

完整的 Agent 契约、任务类型、部署包结构和排障顺序见 [样机 Agent 协议与设备管理](sample-devices-agent-protocol.md)。

## 出样标签打印 `sample-labels`

路由 `/#/sample-labels` · SPA `/modules/sample-labels/` · 无独立 API

不写入任何数据，直接读取 `/api/computer-labels/products`，按 A4 横向 3 × 3 打印出样贴纸，SKU 与机型取自仓库货品。因此修改电脑标签打印的商品会直接反映到出样标签。

## 员工工牌制作 `employee-badges`

路由 `/#/employee-badges` · SPA `/modules/employee-badges/` · 无 API、无存储

姓名、岗位、二维码全部保留在浏览器内存，刷新或关闭页面即清空，不发送到服务端，也不进入备份包。

## 系统维护接口 `/api/system`

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 版本、commit、数据目录、各板块构建产物与数据库状态 |
| `GET /backups/export` | 生成统一 `.lsbackup` |
| `POST /backups/inspect` | 上传并检查备份包，不覆盖数据 |
| `POST /backups/restore` | 按模块恢复 |
| `GET /update/status` | 当前版本与最近一次检查/安装状态 |
| `POST /update/check` | 检查 GitHub 稳定 Release |
| `POST /update/install` | 提交安装任务 |

统一备份当前覆盖四个持久化模块（电脑标签打印、外设价签打印、价格展牌打印、付款凭证打印），格式版本 `4`，单文件上限 1GB，容器为不压缩的 `LSOBKP01`。维护接口要求同源请求与 `X-Lenovo-Store-Maintenance: 1`；配置 `LENOVO_STORE_MAINTENANCE_TOKEN` 后额外要求 Bearer。
