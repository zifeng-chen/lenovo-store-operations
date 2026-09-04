# 更新日志

本文件记录联想门店运营系统每次更新的日期和主要内容，最新记录排列在最前。功能、配置、部署方式或文档发生变化时，应同步更新相关说明，并在此补充一条记录。

## 2026-09-04

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
