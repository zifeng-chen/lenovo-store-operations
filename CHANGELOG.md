# 更新日志

本文件记录联想门店运营系统每次更新的日期和主要内容，最新记录排列在最前。功能、配置、部署方式或文档发生变化时，应同步更新相关说明，并在此补充一条记录。

## 2026-10-09

- 发布补丁版本 `0.5.1`：当管理员已完整安装标准 root updater 平台，但环境文件遗漏 `LENOVO_STORE_UPDATE_ENABLED` 时，服务端会依据受信任的配置文件、更新器程序和三个安全 IPC 目录自动启用在线安装入口；显式设置 `LENOVO_STORE_UPDATE_ENABLED=false` 始终优先，未安装或目录不完整时不会自动启用。
- 系统状态页在检测到新版本时始终显示在线安装按钮状态，不再因 updater 未启用而静默隐藏；按钮和告警会明确区分“未启用”“更新器未配置”“检查结果已过期”，并展示安全过滤后的配置错误，提示重新检查或修复部署。
- 更新状态增加 `installation.enablementSource`，health 增加 updater 平台检测与启用来源字段，便于区分环境显式启用、完整平台自动识别和禁用状态；版本检测、同源维护授权、签名校验、root权限边界、升级前备份和自动回滚保持不变。

## 2026-09-07

- 发布版本提升至 `0.5.0`：新增第五个业务板块“价格展牌打印”，提供独立 Portal 路由 `/#/price-placards`、SPA `/modules/price-placards/`、API `/api/price-placards` 和 SQLite 数据库；当前运行契约为五个业务模块、四套 SQLite、Portal + 5 个业务 SPA（共六套前端构建产物）。
- 价格展牌最终成品调整为 110mm × 110mm：外层使用 110mm 裁切区，内层保持 120mm 设计坐标并按 `11/12` 缩放，输出内容宽度为 99mm；卖点、产品行、配件、服务 Logo 与间距同步到整理文档规格。A4 纵向每页 2 张，从页面顶边开始向下排列，两张间保持 4.5mm。
- 五个打印模块统一从 A4 顶边向下排列：仓库标签取消打印顶部 8mm，周边价签取消 6.5mm 顶偏移，价格展牌取消 14.25mm 顶偏移，员工工牌网格由垂直居中改为顶部对齐，付款凭证存根和小票统一从 canvas 顶部绘制；左右安全边距、单张内部布局和分页数量保持不变。
- 周边货品价签改为一次性隔离 iframe 打印，页面固定为 297mm × 210mm、每页 28 张，移除多页分页中的居中 transform 和 209/210mm 混用；等待字体和图片后打印，打印完成或取消后清理 iframe，修复多页时标签整体缩小、错版及页面状态需刷新才能恢复的问题。
- 价格展牌编辑器调整为左右双分区，产品标题同时作为保存名称；卖点图片改为可选，卖点和优势限制 20 字，产品达到 5 行时自动隐藏配件并支持手动隐藏。保存库新增标题搜索、高亮、排序、九宫格和加载更多；历史内容即使不符合当前校验或发生版式溢出也允许复制为新记录继续修改。
- 新增 SQLite 持久化的全局“想帮帮”服务库，可供所有价格展牌选择后继续手工编辑；支持中文表头 `.xlsx` 导入导出，同名服务覆盖价格、新名称追加，并纳入 JSON v2、数据库备份和系统统一备份。
- 新增显式保存和不可变版本历史：内容或来源快照实际变化时才追加版本，每张展牌最多保留 100 个版本；恢复旧版本会追加为新版本，复制历史会创建新展牌。支持图片压缩、服务端完整像素解码、SHA-256 去重、24 小时多租约临时图片回收和历史图片引用保护，以及仓库货品/周边价签来源的只读快照与选择性字段刷新；仓库来源刷新颜色或配置时保留人工价格。
- 新增价格展牌单模块 JSON/SQLite DB 导入导出、仅校验预检、确认后全量替换和失败回滚；导入在上传前复用同源维护授权，JSON 使用流式 staging SQLite 保持 250MB 图片容量而不整体载入内存，DB 替换使用 fsync 持久化 journal 并可在启动时恢复中断事务。打印队列保存加入时快照，可调整顺序、删除并为每项设置 1–99 份。
- 依赖安全：Vue 升级至 `3.5.43`、Multer 升级至 `2.4.0`、Sharp 升级至 `0.35.5`，并更新 `proxy-addr`、`shell-quote`、`source-map-js` 等传递依赖；`npm audit --audit-level=high` 当前为 0 漏洞。
- `.lsbackup` 当前 writer 固定输出 `formatVersion: 2` 和四库快照；reader 继续接受历史 v1 三库包。v1 inspect 对价格展牌显示“未包含”，且不能恢复价格展牌，绝不把缺失模块恢复为空库。旧 `0.4.x` 服务不能读取 v2，这是向前版本边界；导入 v2 前必须先更新代码和服务到支持 v2 的版本。
- `npm run backup:data` 离线目录备份同步为四库；health、Portal、签名 Release、安装脚本和 updater 同步校验五个业务模块、四套 SQLite 与六套前端构建产物。health 提供仅用于已安装 `0.4.x` updater 首次升级的旧四模块兼容视图，新 updater 显式请求五模块契约并按目标版本严格校验，避免 0.4→0.5 在安装新 updater 前误回滚。旧 checkout/三个旧项目迁移仍只迁移已有三源；0.5.0 首次启动会另建空的 price-placards 库，不会凭空生成旧展牌数据。
- 价格展牌已接入用户提供的正式“想帮帮”Logo和产品名称右侧“AI 元启”默认图；数据库中的 `serviceLogoAssetId` 和自定义产品图片仍优先显示，预览与隔离打印共同使用打包后的正式图片资产。

## 2026-09-04

- 文档：新增 Ubuntu ARM64（`arm64/aarch64`）从零部署、旧数据迁移、固定 Node.js `22.21.1`、原生依赖构建、UFW、systemd、Ed25519 签名在线更新、备份、故障演练和安全回退逐条手册；明确不支持 `armhf`/ARMv7 生产部署，并同步 README、通用 Ubuntu 指南及人工代码回退的 updater path/service 竞态防护。

- 发布版本提升至 `0.4.0`：系统状态页在成功检测到更高的稳定 GitHub Release 后重新提供“安装最新版本”按钮；只允许安装服务端刚获取、未过期且无错误的严格 `vX.Y.Z` latest tag，安装前必须输入“安装”二次确认，并持续展示排队、备份、下载、验签、构建、切换、重启、健康检查和回滚阶段。
- 可信局域网在线更新默认免独立更新令牌：安装请求始终要求 `X-Lenovo-Store-Maintenance: 1`、非空同源 `Origin`，并拒绝 `Sec-Fetch-Site: cross-site`；未配置 `LENOVO_STORE_MAINTENANCE_TOKEN` 时无需 Bearer，配置后复用统一维护令牌。无令牌模式必须由 UFW、VLAN 或反向代理 ACL 限制可信网段，禁止公网暴露。
- 恢复最小权限更新平台：非 root Web 服务只在受限运行目录写入 `0600` 单任务请求，root-owned systemd oneshot 领取后固定访问 `zifeng-chen/lenovo-store-operations` Release；执行 Ed25519、固定公钥指纹、SHA-256、manifest/tag/version/full commit、下载域名、归档路径及大小校验，并使用独立不可登录 builder 账号执行 `npm ci` 和仓库检查。
- 恢复不可变部署与自动回滚：Ubuntu 使用 `releases/<version>-<commit>`、`current`、`previous` 原子链接；升级前执行外部一致性备份，候选版本需连续三次通过版本、完整 commit、外部数据目录、五套前端和三套 SQLite health 检查。切换失败自动回滚，fsync 事务 journal 支持进程终止或断电后的保守恢复。
- 部署与发布契约同步恢复：新增首次迁移脚本、updater service/path/tmpfiles、配置示例及故障演练说明；签名 Release manifest 恢复 `updaterContractVersion: 1`、`npm-ci-on-target` 和 `/api/system/health` 契约，根检查同时校验 updater JavaScript 与安装脚本 Shell 语法。

- `0.3.0`：仓库货品和周边货品新增可编辑的 `added_date` 添加日期，统一使用 `YYYY-MM-DD`；新商品默认 `Asia/Shanghai` 当天，旧 SQLite 数据按 `created_at` 回填，旧备份、仓库 Excel 和周边 JSON v1 继续兼容。列表、搜索、表单、Excel/JSON 导入导出和统一备份恢复均已贯通。
- `0.3.0` 部署简化：当时移除 Portal 在线安装、安装令牌、文件 IPC、root updater、systemd updater/path/tmpfiles、自动切换与回滚资源；系统状态页只保留 GitHub Release 检查，Ubuntu 改为外部备份、`git pull --ff-only`、锁定依赖、构建检查和 systemd 重启人工升级。上述能力在 `0.4.0` 以可信局域网免独立令牌方案重新实现。
- `0.3.0` 局域网维护：删除 `LENOVO_STORE_ALLOW_UNAUTHENTICATED_MAINTENANCE` 和无令牌时的服务器本机限制。未配置 `LENOVO_STORE_MAINTENANCE_TOKEN` 时默认允许可信局域网客户端执行统一备份恢复；配置令牌后仍强制 Bearer，并始终保留维护请求标识和同源检查。无令牌部署必须通过防火墙或 VLAN 限制可信网段，禁止公网暴露。
- `0.3.0` 发布流程继续生成 Ed25519 签名 Release；该版本的 manifest 曾删除 updater 平台契约和安装模式，签名密钥生成工具移至 `ops/release/`。`0.4.0` 已恢复在线安装所需的签名平台契约。

## 2026-09-03

- 发布版本提升至 `0.2.2`：付款凭证 OCR 新增识别记录管理，可查看详情、逐条删除并导出 CSV/JSON；页面显示每自然月 500 次免费额度的本机已用与剩余次数。额度按 `Asia/Shanghai` 月份和实际百度 OCR endpoint 调用计数，access token 获取不计、110/111 重试分别计次，删除历史不返还额度；统一备份校验该账本，恢复时只合并不清空，避免额度回退。
- 发布版本提升至 `0.2.1`：GitHub Release 检查新增仅服务端读取的可选 `LENOVO_STORE_GITHUB_TOKEN`，成功缓存由 5 分钟延长至 15 分钟；401、普通 403 与真实限流分别提示，并按 GitHub 返回的额度重置时间退避，避免共享出口匿名配额耗尽后反复请求。token 不进入浏览器、API 响应、日志或仓库，也不与在线安装令牌复用。
- 系统状态：运行时间不再显示累计总秒数，改为按年、月、天、小时、分钟、秒逐级换算；满 24 小时自动显示为 1 天，并基于后端 uptime 快照在页面内每秒实时递增，每次健康状态刷新时重新校准。
- 在线更新第二阶段：发布版本提升至 `0.2.0`；新增独立 root-owned systemd 更新器和受限文件 IPC；Portal 可使用独立更新管理员令牌提交刚检查到的最新稳定版本，并持续显示备份、下载、校验、安装、切换、重启、健康检查及回滚状态，功能默认关闭。
- 安装安全：Release manifest 新增 Ed25519 独立签名和固定部署公钥指纹核对；更新器固定仓库和下载域名，使用 root 私有 claimed 目录与 `O_NOFOLLOW` 文件描述符领取请求，校验签名、SHA-256、包结构、版本与完整提交，拒绝不可逆数据迁移，并以专用不可登录 builder uid/gid 执行依赖安装和检查；构建前后复核更新器摘要并清除该 uid 的全部进程后才由 root 封存。
- 原子部署与恢复：Ubuntu 改用 `releases/<version>-<commit>`、`current` 和 `previous`；候选版本通过完整 health、五套前端和三套数据库连续检查后才完成，失败自动切回旧版本；fsync 事务 journal 覆盖 `claimed`、`preparing`、`prepared`、`switched`、`recovered` 与 `committed`，支持强杀或断电后的开机保守回滚，且不自动覆盖业务数据库。
- 安全加固：更新器以 root-owned、专用 builder 组仅可穿越的 staging 运行降权 npm，主服务启动门识别 oneshot 的 `activating` 状态，并在切换前持久化候选身份以清理中断残留；首次迁移改从已推送 Git 归档构建受控候选，先建立连续 health 基线，拒绝敏感 ignored 内容，失败时精确恢复旧 checkout 顶层权限并验证健康。
- Ubuntu 运维：新增 systemd service/path/tmpfiles 模板、签名密钥生成工具、更新器配置示例和显式确认的首次迁移脚本，并补充 HTTPS origin、权限、令牌及故障演练流程。

- 在线更新第一阶段：统一以根 `package.json` 的 `0.1.0` 为产品版本，健康接口返回版本、完整提交哈希和 `stable` 通道；系统状态页新增 GitHub 正式版本检查、更新说明和 Release 跳转，当前不执行安装。
- 发布流程：新增 `vX.Y.Z` tag 驱动的 GitHub Actions，自动执行依赖安装、全量构建、检查和审计，并生成源码与构建产物包、`manifest.json`、`release-info.json` 和 `SHA256SUMS` 后创建正式 Release。
- 依赖安全：将 Express 使用的传递依赖 `qs` 由 `6.15.3` 更新到 `6.16.0`，修复 npm 审计报告的中危拒绝服务问题。

## 2026-09-02

- 文档：依据对应 Git 提交时间校正历史更新日期，将此前误归到 `2026-08-20` 的记录重新归档到实际日期。
- 系统维护：新增 `LENOVO_STORE_ALLOW_UNAUTHENTICATED_MAINTENANCE=true` 可信局域网开关；未配置维护令牌时可从其他机器直接备份、检查和按模块恢复，默认本机限制不变，配置令牌后仍优先强制 Bearer 鉴权。
- 部署文档：补充 GitHub Release 更新检测、不可变 release 目录、systemd 外部更新器、升级前备份、原子切换和自动回滚的在线更新实施方案。

## 2026-09-01

- 仓库货品标签：压缩 SKU 上下留白，行高由 1.2 调整为 1.05，与商品名称的下间距由 1.2mm 调整为 0.5mm；字号、粗体、联想红和上移 1mm 保持不变。
- 仓库货品标签：标签 SKU 由 8pt 调整为 11pt 联想红粗体并上移 1mm，保持比 13pt 商品名称小 2pt；预览和 A4 打印共用样式，并启用打印颜色保留。
- 周边货品价签：独立品类管理卡的名称输入框和“保存品类”按钮改为始终显示，无需先点击按钮展开；保留 Enter 保存、Esc 清空和新增成功后自动选中。
- 周边货品价签：将“新增品类”按钮及展开后的创建表单移入商品录入上方的独立品类管理卡片，保留新增成功后自动选中、键盘提交和现有筛选逻辑。
- 文档：建立统一更新日志，并在 README 中增加更新记录入口。
- 维护：建立项目级文档同步规则，要求后续每次更新记录日期、更新内容和必要的使用说明。

## 2026-08-30

- 工作台：在 Portal 首页“业务板块”标题右侧新增 GitHub 仓库跳转入口，使用新标签页安全打开。
