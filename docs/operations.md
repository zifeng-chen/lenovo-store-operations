# 运维、环境变量与发布

本文汇总运行参数、备份恢复入口、版本发布流程和常见故障处理。首次部署与服务器迁移请按 [Ubuntu ARM64 部署手册](ubuntu-arm64-deployment.md) 或 [Ubuntu 部署指南](ubuntu-deployment.md) 逐条执行。

## 1. 运行环境

| 项 | 值 |
| --- | --- |
| Node.js | `22.21.1`（最低 `22.12.0`） |
| 端口 | `8900`（`HOST` / `PORT` 可覆盖） |
| 数据库 | `$LENOVO_STORE_DATA_DIR/store/store.sqlite` |
| 前端构建产物 | Portal + 8 个业务 SPA，共 9 套 `dist` |

生产环境 `LENOVO_STORE_DATA_DIR` 必须是代码目录之外的绝对路径；缺失、指向 checkout、经符号链接指回项目目录或指向文件系统根目录都会拒绝启动。只有 `npm run dev`、`NODE_ENV=development` 和测试模式允许回退到仓库内 `data/`。

## 2. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LENOVO_STORE_DATA_DIR` | 无（生产必填） | 持久化数据根 |
| `LENOVO_STORE_BACKUP_DIR` | 无 | `npm run backup:data` 的输出目录，必须与代码、数据目录分离 |
| `LENOVO_STORE_MAINTENANCE_TOKEN` | 空 | 统一备份恢复与在线更新的 Bearer 令牌，配置后至少 24 个字符 |
| `LENOVO_STORE_UPDATE_ENABLED` | 自动识别 | 显式 `false` 关闭在线安装入口 |
| `LENOVO_STORE_GITHUB_TOKEN` | 空 | 仅服务端版本检查使用，用于缓解 API 限流 |
| `LENOVO_STORE_UPDATER_GITHUB_TOKEN` | 空 | 仅 root updater 使用，只附加到 `api.github.com` |
| `BAIDU_OCR_API_KEY` / `BAIDU_OCR_SECRET_KEY` | 空 | 百度 OCR 凭据，建议改用页面配置 |
| `OCR_CONFIG_ENCRYPTION_KEY` | 空 | 32 字节 Base64 或 64 位十六进制，替代本机密钥文件 |
| `BAIDU_OCR_ENDPOINT` | 官方地址 | 自定义 OCR 接口 |

样机设备管理的专属变量见 [模块接口](modules.md#样机设备管理-sample-devices) 与 [样机 Agent 协议](sample-devices-agent-protocol.md) 第 7 节。

## 3. 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动 9 个前端开发服务器与后端 |
| `npm run build` | 构建 Portal 与 8 个业务 SPA |
| `npm start` | 启动 8900 生产服务 |
| `npm run check` | 构建检查全部 SPA，并校验后端、脚本与 updater 语法 |
| `npm run test:product-name` | 产品名称规范化用例 |
| `npm run test:error-catalog` | 错误码目录校验 |
| `npm run backup:data` | 在线一致性备份统一库、OCR 密钥与校验清单 |
| `npm run release:verify -- vX.Y.Z` | 校验 tag 与 package、lockfile 版本一致 |
| `npm run release:pack -- vX.Y.Z` | 生成签名 Release 的发布包、manifest 与 SHA-256 |
| `npm run release:sign` | 用私钥签名 manifest 并核对部署公钥指纹 |

开发端口：Portal `5173`、电脑标签 `5174`、外设价签 `5175`、付款凭证 `5176`、员工工牌 `5177`、销售报表 `5178`、样机设备 `5179`、价格展牌 `5180`。生产路径验证必须用 `npm run build && npm start` 走 8900。

## 4. 入口与健康检查

Portal 使用 hash 路由，`#` 之后只由浏览器解析，因此刷新始终请求根路径：

- Portal：`http://localhost:8900/`
- 系统状态：`http://localhost:8900/#/system`
- 板块：`/#/computer-labels`、`/#/price-labels`、`/#/price-tags`、`/#/receipt-assistant`、`/#/sample-labels`、`/#/sales-report`、`/#/sample-devices`、`/#/employee-badges`
- 健康接口：`http://localhost:8900/api/system/health`

旧直链（`/computer-labels` 等）由服务端以 `308` 跳转到对应 hash 地址。

健康接口报告产品版本、完整 commit、`persistentDataConfigured`、`portalReady`、每个板块的 SPA 产物、API 挂载与数据库连接状态。生产探针应要求 `persistentDataConfigured` 为 `true`。员工工牌这类无 API、无存储的板块会返回 `null` 表示不适用，而不是异常。

反向代理必须保留原始路径转发 `/`、`/assets/`、`/modules/`、`/api/`，保留 `Host` 与 `X-Forwarded-Proto`，放行 `/ws/agents/`、`/ws/tasks/` 的 `Upgrade` 头，且不要对未知页面做全局 `index.html` 回退。

## 5. 备份与恢复

统一备份入口在系统状态页，一次生成一个 `.lsbackup`：

1. 点击「下载全部数据库备份」；
2. 当前格式版本 `4`，覆盖电脑标签打印、外设价签打印、价格展牌打印、付款凭证打印四个模块；付款凭证快照含 OCR 历史、结构化结果、销售流水、商品明细与调用次数账本；
3. 恢复时上传并检查，只校验格式、长度、SHA-256、完整性、表结构与记录数，不覆盖数据；
4. 核对备份编号与各表记录数后，在目标模块单独恢复，二次确认需完整输入「恢复」；
5. 恢复会话最长保留 30 分钟，用完后点击「清除」。

reader 兼容历史 v1（三库）、v2（四库）与当前 v4；v1/v2 中的价格展牌条目在 `0.6.0` 后不再恢复。

服务器定时备份使用命令行：

```bash
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations \
LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations \
npm run backup:data
```

该命令通过 SQLite backup API 生成一致性快照、执行 `PRAGMA integrity_check`、记录表数量与 SHA-256，并验证 OCR 密钥能解密快照内凭据；无法确认可恢复时整个备份失败。不要只用 `cp` 复制主 `.sqlite` 文件，WAL 中已提交的数据会丢失。

`.lsbackup` 的 SHA-256 只能证明完整性，不能证明来源；包内可能含解密 OCR 凭据的密钥，禁止上传网盘或群聊。

## 6. 版本发布

根 `package.json` 的 `version` 是整套产品的唯一发布版本，必须与 tag 完全一致。

**版本号规则**：`vX.Y.Z` 三段，minor 与 patch 各只能是一位数字 `0–9`，上限 `x.9.9`；超出必须先抬 minor。`v1.1.10` 这类 tag 会被 CI 拒绝。

发布步骤：

```bash
# 1. 更新版本号（同时更新 package-lock）
npm version 1.2.6 --no-git-tag-version --workspaces=false

# 2. 更新 README、CHANGELOG 与相关文档，本地验证
npm run build
npm run check
npm run release:verify -- v1.2.6

# 3. 提交并推送，再打 tag
git add -A && git commit -m "feat: ..."
git push origin main
git tag -a v1.2.6 -m "v1.2.6"
git push origin v1.2.6
```

`.github/workflows/release.yml` 会校验 tag 与根 package、lockfile 版本一致，执行 `npm ci`、全量构建、`npm run check` 与 `npm audit --audit-level=high`，全部通过后创建 GitHub Release，包含源码与构建产物 tar 包、`manifest.json`、Ed25519 `manifest.json.sig`、`SHA256SUMS` 和包内 `release-info.json`。缺少签名 Secret 或公钥指纹 Variable 时发布失败。

## 7. 在线升级

系统状态页检测固定仓库 `zifeng-chen/lenovo-store-operations` 的稳定 Release，检测到更高版本后显示「安装最新版本」。

- Web 服务只写受限 `0600` 单任务文件，不执行 Shell、npm 或 systemctl；
- root-owned systemd oneshot 下载签名 Release，校验 Ed25519、SHA-256、manifest/tag/version/full commit、下载域名与归档结构；
- 安装前先刷新更新器自身代码，因此更新器逻辑的修复随当次升级生效；
- 先做外部一致性备份，再以独立不可登录 builder 账号执行 `npm ci --include=dev` 与 `npm run check`，然后原子切换 `current` / `previous`；
- 新版本需连续三次通过版本、commit、数据目录、前端模块与数据库健康检查，否则自动回滚；
- fsync 事务 journal 记录领取、准备、切换、恢复与提交，断电后由 systemd 启动门保守恢复。

`/etc/lenovo-store-updater.json` 支持可选的 `artifactMirrorPrefix`：国内直连 GitHub 常因 120 秒下载硬超时失败，填入 https 镜像前缀可提速。镜像作用于发布包与全部 manifest 资产，签名与摘要三层校验不变，最坏结果只是升级失败；前缀不得含账号密码，也不得指向 `github.com` 或 `api.github.com`。

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| 8900 端口被占用 | `PORT=8910 npm start`；开发端口改动需同步各业务 `vite.config.js` 的代理 |
| `better-sqlite3` 原生模块报错 | 确认使用 `.nvmrc` 指定 Node，`nvm use && rm -rf node_modules && npm ci`；不要在 arm64 与 x86_64 Node 间复用 `node_modules` |
| 升级后数据为空 | 检查服务环境里 `LENOVO_STORE_DATA_DIR` 是否仍指向同一目录，参见部署指南第 9 节 |
| OCR 配置无法解密 | 数据库与 `secrets/receipt-ocr.key` 必须来自同一套备份，否则在页面重新填写凭据 |
| 页面正常但打印尺寸不对 | 浏览器缩放 100%、关闭页眉页脚与「适合页面」，最终以实体样张为准 |
| 分割线打印不出来 | 细线必须用 `border-top` 绘制，不能用背景色或 `0.5px` 高度 |
| 设备在线但指令无反应 | 检查「长连接在线」标记与反向代理是否放行 `/ws/agents/` 的 `Upgrade` |
| 在线升级反复回滚 | 核对 `ops/updater/updater.mjs` 的 `CURRENT_MODULE_IDS` 是否包含全部 8 个板块 id |
| 部署包安装后设备不注册 | `deploy.conf` 的 `server=` 必须是 8900 门户地址，`enroll=` 必须与服务端注册密钥一致 |

## 9. 打印验收

浏览器构建通过不代表打印正确。更换打印机或首次部署后应实测：电脑标签 46mm × 45mm（A4 纵向 24 张/页）、外设价签 70mm × 28mm（A4 横向 28 张/页）、价格展牌 110mm × 110mm（A4 每页 2 张）、付款凭证 A4 单页存根 + 小票、员工工牌 54mm × 85mm（A4 横向 5 × 2，裁剪通道 2mm）、出样标签 A4 横向 3 × 3。销售业绩报表与样机设备管理不参与打印验收。
