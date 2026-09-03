# Ubuntu 部署、数据持久化与备份恢复指南

本文面向在 Ubuntu 服务器上运行 `lenovo-store-operations` 的维护人员，重点解决以下问题：

- Git 拉取、重新克隆或切换 release 后业务数据不能丢失；
- SQLite 数据、WAL 文件和付款凭证 OCR 密钥得到一致保护；
- systemd 重启或服务器重启后仍使用同一个数据目录；
- 每次升级前可以生成完整、可校验的外部备份；
- 数据异常时可以安全恢复或回滚，而不是直接覆盖现有数据库。

## 1. 持久化范围

系统中只有三个板块使用服务器端 SQLite：

| 板块 | 数据文件 |
| --- | --- |
| 仓库货品标签 | `$LENOVO_STORE_DATA_DIR/computer-labels/database.sqlite` |
| 周边货品价签 | `$LENOVO_STORE_DATA_DIR/price-labels/database.sqlite` |
| 付款凭证打印 | `$LENOVO_STORE_DATA_DIR/receipt-assistant/database.sqlite` |
| 付款凭证 OCR 密钥 | `$LENOVO_STORE_DATA_DIR/secrets/receipt-ocr.key` |

员工工牌制作模块不会将姓名、岗位或二维码发送到服务器，也没有 SQLite 数据库。刷新或关闭员工工牌制作页面后，当前录入内容会清空。

SQLite 使用 WAL 模式时，运行目录中可能同时出现 `database.sqlite-wal` 和 `database.sqlite-shm`。在线备份应使用项目提供的 `npm run backup:data`；手工复制必须先停服并复制整个数据目录，不能只复制主数据库文件。

## 2. 推荐目录布局

生产环境应将代码、数据和备份彻底分离：

```text
/opt/lenovo-store-operations/          # root-owned release 根目录
├── current -> releases/<version>-<commit>
├── previous -> releases/<version>-<commit>
└── releases/                          # root-owned 不可变版本
/var/lib/lenovo-store-operations/      # 持久化数据目录
/var/lib/lenovo-store-updater/         # root 写、服务组只读的更新状态
/var/backups/lenovo-store-operations/  # 备份目录
/etc/lenovo-store-operations.env       # systemd 环境变量
/etc/lenovo-store-updater.json         # root-only 更新器配置
```

首次部署可以先按第 4 节建立普通 checkout；完成构建、外部数据迁移、备份验证和签名配置后，再按 6.3 节一次性转换为上述不可变 release 布局。

推荐原则：

1. Git、部署脚本和 release 清理程序只能操作 `/opt/lenovo-store-operations`；
2. 所有版本固定使用 `/var/lib/lenovo-store-operations`；
3. 备份目录不能位于代码目录或数据目录内部，也不能是符号链接；
4. 应用不要使用 `root` 运行，以下示例用 `<service-user>` 和 `<service-group>` 表示实际服务账号；
5. 禁止对数据目录执行 `git clean -fdx`、`rm -rf` 或带 `--delete` 的同步命令。

应用会拒绝把显式配置的 `LENOVO_STORE_DATA_DIR` 指向项目目录内部、文件系统根目录或经符号链接返回项目目录的位置。生产模式漏配该变量时也会拒绝启动，避免新 release 静默创建空数据库。

## 3. 部署前准备

### 3.1 软件要求

- Ubuntu 22.04 LTS 或更新版本；
- Git；
- Node.js `22.21.1`，最低要求为 `22.12.0`；
- npm；
- 可选：Nginx，用于 HTTPS 或反向代理。

检查版本：

```bash
node --version
npm --version
git --version
```

项目根目录的 `.nvmrc` 固定为 Node.js `22.21.1`。如果使用 NVM，执行：

```bash
nvm install
nvm use
```

systemd 不会自动加载交互式 Shell 中的 NVM。创建服务前必须执行 `command -v node` 和 `command -v npm`，并在 unit 中使用实际绝对路径，或为服务配置包含 Node.js 的 `PATH`。服务账号必须有权限访问对应的 NVM 目录。

### 3.2 创建持久化目录

本节只适用于**没有旧数据的新服务器**。如果要迁移仓库内现有 `data/`，不要提前创建 `/var/lib/lenovo-store-operations`；只创建其父目录和备份目录，然后直接按照“现有服务器无损迁移”操作。迁移流程要求目标目录不存在，这是防止误合并和覆盖的安全检查。

新服务器将账号和组替换为实际值：

```bash
sudo install -d -m 0750 -o <service-user> -g <service-group> \
  /var/lib/lenovo-store-operations
sudo install -d -m 0700 -o <service-user> -g <service-group> \
  /var/backups/lenovo-store-operations
```

数据目录和备份目录必须由实际运行 Node.js 的账号读写。迁移旧数据时只预先创建备份目录：

```bash
sudo install -d -m 0700 -o <service-user> -g <service-group> \
  /var/backups/lenovo-store-operations
```

## 4. 新服务器首次部署

### 4.1 拉取和构建

```bash
sudo install -d -m 0750 -o <service-user> -g <service-group> \
  /opt/lenovo-store-operations
sudo -u <service-user> git clone <repository-url> \
  /opt/lenovo-store-operations
sudo -u <service-user> -H bash -lc '
  set -Eeuo pipefail
  cd /opt/lenovo-store-operations
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh"
    nvm use
  fi
  npm ci
  npm run build
  npm run check
'
```

安装、构建、Git 拉取和服务运行应使用同一个 `<service-user>`，避免 `node_modules` 或构建产物变成 root 所有。如果使用系统级 Node.js，脚本会跳过 NVM 加载。不要执行 `npm run dev` 作为生产服务。

### 4.2 配置环境文件

创建 `/etc/lenovo-store-operations.env`：

```bash
sudo install -m 0600 -o root -g root /dev/null \
  /etc/lenovo-store-operations.env
sudoedit /etc/lenovo-store-operations.env
```

推荐内容（维护令牌模式）：

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=8900
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations
LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations
LENOVO_STORE_MAINTENANCE_TOKEN=<至少24字符的随机维护令牌>
```

仅在受防火墙保护的可信局域网中，也可以不配置维护令牌，改用免令牌模式：

```ini
NODE_ENV=production
HOST=0.0.0.0
PORT=8900
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations
LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations
LENOVO_STORE_ALLOW_UNAUTHENTICATED_MAINTENANCE=true
```

说明：

- 通过 Nginx 反向代理时建议使用 `HOST=127.0.0.1`；代理应保留原始 `Host`，并设置 `X-Forwarded-Proto $scheme`，否则统一维护接口的同源校验会拒绝请求；
- 需要直接提供局域网访问时可改为 `HOST=0.0.0.0`，并使用 Ubuntu 防火墙只允许门店可信网段访问 `8900/tcp`，不得将端口直接暴露到公网；
- `LENOVO_STORE_DATA_DIR` 和 `LENOVO_STORE_BACKUP_DIR` 必须为绝对路径；
- 生产服务必须配置至少 24 个字符的 `LENOVO_STORE_MAINTENANCE_TOKEN`，或者在未配置令牌时显式设置 `LENOVO_STORE_ALLOW_UNAUTHENTICATED_MAINTENANCE=true`，否则启动会失败；
- 令牌可用 `openssl rand -base64 32` 生成，并写入权限为 `0600` 的环境文件；不要提交到 Git、聊天或工单。配置令牌后，即使免令牌开关同时为 `true`，服务仍优先使用令牌模式并强制 Bearer 鉴权；
- 令牌模式下，系统状态页执行统一备份恢复时会要求输入令牌；令牌只保存在当前页面内存中。可信局域网免令牌模式无需输入令牌，但任何能访问服务端口的客户端都可能下载或覆盖业务数据库，因此禁止在公网启用；
- `LENOVO_STORE_ALLOW_UNAUTHENTICATED_MAINTENANCE` 只有去除首尾空格并忽略大小写后严格等于 `true` 才会启用；
- 如果使用 `OCR_CONFIG_ENCRYPTION_KEY`，应将它放在权限受控的环境文件或密钥管理系统中，不要提交到 Git。

### 4.3 创建 systemd 服务

创建 `/etc/systemd/system/lenovo-store-operations.service`：

```ini
[Unit]
Description=Lenovo Store Operations
After=network.target

[Service]
Type=simple
User=<service-user>
Group=<service-group>
WorkingDirectory=/opt/lenovo-store-operations
EnvironmentFile=/etc/lenovo-store-operations.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
UMask=0027
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`ExecStart` 必须替换为服务器上 `command -v npm` 返回的绝对路径。如果 Node.js 来自 NVM，还应显式配置对应路径，例如：

```ini
Environment=PATH=/home/<service-user>/.nvm/versions/node/v22.21.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/home/<service-user>/.nvm/versions/node/v22.21.1/bin/npm start
```

不要同时保留两条 `ExecStart`。完成后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lenovo-store-operations
sudo systemctl status lenovo-store-operations
sudo journalctl -u lenovo-store-operations -n 100 --no-pager
```

启动日志应显示实际数据根为 `/var/lib/lenovo-store-operations`，来源为环境变量。

## 5. 现有服务器无损迁移

本节适用于数据库仍位于旧代码仓库 `data/` 目录的服务器。迁移期间不要执行 `git pull`、重新 clone、删除旧 release 或创建新的空数据库。

### 5.1 确认旧数据位置

先检查当前服务日志和健康接口：

```bash
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
sudo journalctl -u lenovo-store-operations -n 100 --no-pager
```

记录三个板块的业务记录数量和最新一条记录。不要仅凭目录名称判断哪套数据库正在使用。

### 5.2 停服并制作冷备份

```bash
sudo systemctl stop lenovo-store-operations
```

确认没有进程继续占用旧数据目录，然后复制整个目录：

```bash
set -Eeuo pipefail

OLD_REPO=/absolute/path/to/lenovo-store-operations
COLD_BACKUP="/var/backups/lenovo-store-operations/pre-migration-$(date +%Y%m%d-%H%M%S)"

sudo cp -a "$OLD_REPO/data" "$COLD_BACKUP"
sudo test -f "$COLD_BACKUP/computer-labels/database.sqlite"
sudo test -f "$COLD_BACKUP/price-labels/database.sqlite"
sudo test -f "$COLD_BACKUP/receipt-assistant/database.sqlite"
```

OCR 加密密钥有两种来源，迁移前必须确认当前服务使用哪一种：

- 如果 systemd 环境文件配置了 `OCR_CONFIG_ENCRYPTION_KEY`，必须保留完全相同的值；运行时环境变量优先于本机密钥文件；
- 如果没有配置该环境变量，但付款凭证已保存 OCR 凭据，则必须确认冷备份包含本机密钥：

```bash
sudo test -f "$COLD_BACKUP/secrets/receipt-ocr.key"
```

不要因为旧数据目录没有 `receipt-ocr.key` 就直接判定迁移失败；服务可能一直使用环境变量中的密钥。

### 5.3 使用 staging 迁移

目标或 staging 已存在时，以下命令会停止，不会合并覆盖：

```bash
set -Eeuo pipefail

OLD_REPO=/absolute/path/to/lenovo-store-operations
TARGET=/var/lib/lenovo-store-operations
STAGING="${TARGET}.staging"

sudo test ! -e "$TARGET" || {
  echo "目标已存在，停止迁移：$TARGET" >&2
  exit 1
}
sudo test ! -e "$STAGING" || {
  echo "staging 已存在，停止迁移：$STAGING" >&2
  exit 1
}

sudo cp -a "$OLD_REPO/data" "$STAGING"
sudo test -f "$STAGING/computer-labels/database.sqlite"
sudo test -f "$STAGING/price-labels/database.sqlite"
sudo test -f "$STAGING/receipt-assistant/database.sqlite"
sudo chown -R <service-user>:<service-group> "$STAGING"
sudo chmod 0750 "$STAGING"
sudo mv "$STAGING" "$TARGET"
```

`set -Eeuo pipefail` 保证任一复制、文件检查、权限或改名步骤失败后立即停止，不会继续发布不完整数据。付款凭证数据库与其实际加密密钥必须来自同一套系统，否则已有 OCR 凭据无法解密。

### 5.4 固化配置并验收

把 `LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations` 写入 systemd 的 `EnvironmentFile`，然后：

```bash
sudo systemctl daemon-reload
sudo systemctl start lenovo-store-operations
sudo systemctl status lenovo-store-operations
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
```

必须确认：

- `persistentDataConfigured` 为 `true`；
- 三个 SQLite 板块的 `databaseConnected` 均为 `true`；
- 启动日志中的数据根路径正确；
- 三个板块记录数量和最新记录与迁移前一致；
- 付款凭证 OCR 配置可正常使用。

完成独立备份和业务验收前，不要删除旧仓库中的 `data/`。

## 6. 日常升级流程

推荐每次升级使用以下顺序：

1. 记录当前提交哈希；
2. 创建外部一致性备份；
3. 只更新代码目录；
4. 安装锁定依赖并构建、检查；
5. 检查通过后重启服务；
6. 验证提交哈希、健康接口和业务数据。

示例依赖“systemd 定时备份”章节中的 `lenovo-store-backup.service`，从而保证备份和主服务使用同一个账号、EnvironmentFile 及 OCR 加密密钥：

```bash
set -Eeuo pipefail

# systemctl start 会等待 oneshot 备份结束；备份失败时立即停止升级。
sudo systemctl start lenovo-store-backup.service

sudo -u <service-user> -H bash -lc '
  set -Eeuo pipefail
  cd /opt/lenovo-store-operations
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh"
    nvm use
  fi

  BEFORE_COMMIT=$(git rev-parse HEAD)
  echo "升级前提交：$BEFORE_COMMIT"
  git pull --ff-only origin main
  npm ci
  npm run build
  npm run check
  printf "待部署提交："
  git rev-parse HEAD
'

# 只有备份、拉取、安装、构建和检查全部成功后才会执行到这里。
sudo systemctl restart lenovo-store-operations
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
```

`set -Eeuo pipefail` 会在任一命令失败时停止，禁止无有效备份或构建不完整时重启。安装、构建和 Git 操作均由 `<service-user>` 执行；`npm ci` 和 `npm run build` 不应写入外部数据目录。禁止让部署脚本删除 `/var/lib/lenovo-store-operations` 或 `/var/backups/lenovo-store-operations`。

当前部署直接更新正在使用的代码目录，构建期间静态资源可能短暂变化，建议在维护时段操作。如果构建或检查失败，不要重启服务；先查看命令输出并修复部署问题。

### 6.1 GitHub Release、更新检测与受控安装（第二阶段已实现）

> 当前代码已实现版本检查、签名 Release、外部 systemd 更新器、Portal 安装状态和失败自动回滚。在线安装默认关闭；只有 Ubuntu 主机完成本节的目录、权限、公钥、独立令牌和故障演练后才能启用。macOS 开发环境和未配置更新器的部署继续保持只读检查。

更新源固定为公开仓库 `zifeng-chen/lenovo-store-operations` 的 `stable` 正式 Release，页面不能传入仓库、下载地址、分支或 Shell 命令。根 `package.json` 的 `version` 是产品唯一版本源；运行时健康接口同时报告发布版本、提交哈希和通道。源码 checkout 会以固定参数读取 Git commit，CI 发布包则通过包内 `release-info.json` 提供提交信息。

系统状态页提供“系统版本与更新”卡片：

- `GET /api/system/update/status` 只返回当前版本和进程内最近一次检查结果，不主动联网；
- `POST /api/system/update/check` 同源触发检查，固定访问 GitHub Releases API；
- 只接受非草稿、非预发布且 tag 符合 `vX.Y.Z` 或 `X.Y.Z` 的版本，在最多 300 条 Release 内按语义版本比较；
- 使用 8 秒超时、1MB 单页响应限制、5 分钟成功缓存、失败重试退避、`ETag` 条件请求和并发请求合并；
- GitHub 超时、限流或返回异常时不影响健康接口和业务 API；已有成功缓存时继续显示旧结果并标记错误；
- Release 更新说明按纯文本显示；配置完成后，页面仅允许安装刚刚成功检查到的最新稳定版本，并显示备份、下载、签名验证、安装、切换、重启、健康检查和回滚状态；
- `POST /api/system/update/install` 只接受一个严格 `vX.Y.Z` tag，要求固定 HTTPS Portal origin、`X-Lenovo-Store-Update: 1` 和独立更新管理员 Bearer 令牌；维护令牌及局域网免令牌模式不能授权安装；
- Express 只在固定 `/run` 队列中原子创建白名单 JSON，不执行 `git pull`、`npm`、Shell、systemctl 或任何 root 命令。

发布新版本时，先更新根版本、README、CHANGELOG 和相关文档，完成验证并推送默认分支，再创建同版本 tag。例如：

```bash
npm version 0.2.0 --no-git-tag-version --workspaces=false
# 按实际日期更新文档和CHANGELOG，验证、提交并推送main后：
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` 会严格校验 tag 与根 `package.json`、`package-lock.json` 版本一致，并确认提交位于默认分支；随后执行 `npm ci`、全量构建、检查和高危依赖审计。全部成功后创建正式 GitHub Release：

- `lenovo-store-operations-vX.Y.Z.tar.gz`：Git 受控源码和本次 CI 生成的五套前端 `dist`，不包含 `node_modules`、`data`、数据库、备份、环境文件或密钥；
- `manifest.json`：固定仓库、版本、提交、Node.js 要求、数据兼容标识、产物大小和 SHA-256；
- `manifest.json.sig`：使用 GitHub Actions Secret 中的 Ed25519 私钥对 manifest 原始字节签名，目标机只信任 root-owned 固定公钥；
- `SHA256SUMS`：发布包与 manifest 的摘要；
- 包内 `release-info.json`：供运行时读取版本和提交。

若工作流因权限无法创建 Release，在 GitHub 仓库 `Settings → Actions → General → Workflow permissions` 中允许工作流写入仓库内容；工作流自身只在发布 job 使用 `contents: write`，不需要额外 PAT。发布第二阶段版本前必须同时配置仓库 Secret `RELEASE_SIGNING_PRIVATE_KEY` 和 Variable `RELEASE_SIGNING_PUBLIC_KEY_SHA256`；工作流会从私钥派生公钥并核对固定部署指纹，再对签名进行自校验。任一值缺失或不匹配都会 fail-closed，不会发布目标机无法验证的 Release。

实际安装安全边界如下：

1. 版本安装到 `/opt/lenovo-store-operations/releases/<version>-<commit>/`，`current` 原子指向当前版本，`previous` 保留上一个已验证版本；数据、备份、环境文件和密钥始终位于 release 目录之外。
2. root-owned `lenovo-store-updater.path` 监视固定请求文件并激活 oneshot；更新器只读取 root-owned 配置中的固定仓库、服务名、路径、uid/gid、公钥和资源限制。
3. 更新器先从固定 GitHub Release 下载并验证 `manifest.json`、Ed25519 签名、`SHA256SUMS` 和 tar 包；候选依赖和检查完成后才短暂停止主服务并调用 `lenovo-store-backup.service` 创建无并发写入的一致性备份。签名通过前不信任 manifest 中的 SHA、commit 或文件名。
4. 解包前拒绝绝对路径、`..`、多顶层、重复路径、符号/硬链接、设备、FIFO、文件数或总大小超限；解包后交叉核对根 package、lockfile、`release-info.json` 与签名 manifest。
5. `npm ci` 和仓库检查以安装脚本创建的专用、不可登录 `lenovo-store-builder` uid/gid 运行，不与在线服务账号复用，也不以 root 执行依赖 lifecycle；构建前要求该 uid 无进程，构建后终止并确认其全部进程退出，复核候选更新器 SHA-256 未变化，再由 root 封存候选并原子更新 `current`。
6. 切换后连续三次验证 `/api/system/health` 的完整版本、40 位 commit、外部持久化目录、五套前端和三套 SQLite；失败切回旧 release、重启并验证旧版本。代码回滚不会自动覆盖数据库，升级前备份保留用于人工灾难恢复。
7. 只有 `dataCompatibility.schemaVersion=1` 且 `irreversibleMigration=false` 的 Release 可以自动安装；未知 schema 或不可逆迁移在切换前拒绝。
8. 所有 symlink rename、状态和事务 journal 都执行文件及父目录 fsync；开机 oneshot 会检查未提交事务，进程被强杀或主机断电时保守切回旧 release 并验证。成功健康验证后才从已签名候选包原子更新更新器程序。
9. `platformCompatibility.updaterContractVersion` 必须为当前支持的 `1`；需要修改 systemd/tmpfiles/权限契约的版本必须先人工运行新版平台迁移，旧更新器会拒绝静默安装。签名公钥轮换同样必须人工完成。

### 6.2 创建 Release 签名密钥

在离线、权限受控的机器上生成一次 Ed25519 密钥对，不要在 Ubuntu 业务数据目录或仓库中生成：

```bash
mkdir -m 0700 /secure/offline/release-signing
node ops/updater/generate-signing-keypair.js /secure/offline/release-signing
base64 < /secure/offline/release-signing/release-signing-private.pem | tr -d '\n'
```

将私钥 PEM 的 base64 单行结果保存为 GitHub Actions Secret `RELEASE_SIGNING_PRIVATE_KEY`，并把生成工具输出的 64 位“公钥 SHA-256 指纹”保存为 Actions Variable `RELEASE_SIGNING_PUBLIC_KEY_SHA256`。私钥原文件应进入离线密钥备份，不得复制到 Ubuntu 主机、代码仓库、聊天或工单。只把 root-owned `release-signing-public.pem` 安全复制到 Ubuntu，例如 `/root/release-signing-public.pem`；首次安装脚本要求公钥及全部祖先 root-owned 且不可写，先复制到 root-only staging，再校验 Ed25519 类型和固定指纹，最后安装到 `/etc/lenovo-store-release-signing.pub`。

现有 `v0.1.0` 没有 `manifest.json.sig`，因此不能通过第二阶段自动安装；这是预期的 fail-closed 行为。首次可自动安装的版本必须是完成本次实现后发布的签名版本。

### 6.3 首次迁移并启用更新器

前置条件：

- 当前 checkout 位于 `/opt/lenovo-store-operations`，工作区干净且提交已推送；
- `LENOVO_STORE_DATA_DIR` 已指向代码目录外的绝对路径；
- `lenovo-store-backup.service` 已按本指南配置且能成功完成一致性备份；
- Portal 通过固定 HTTPS 地址访问，例如 `https://store.example.com`；
- 已在隔离 Ubuntu 主机验证脚本参数、实际 Node/npm 路径和 service user。

脚本属于高权限迁移，会停止服务并重组 `/opt` 目录，因此必须人工检查参数并显式加入 `--confirm-migration`：

```bash
cd /opt/lenovo-store-operations
sudo ./ops/install-updater.sh \
  --service-user <service-user> \
  --public-origin https://store.example.com \
  --public-key /root/release-signing-public.pem \
  --public-key-sha256 <RELEASE_SIGNING_PUBLIC_KEY_SHA256的64位值> \
  --node-path /usr/bin/node \
  --npm-path /usr/bin/npm \
  --confirm-migration
```

脚本先连续验证旧版本 health，再创建专用、不可登录的 `lenovo-store-builder` 系统账号；它使用已推送的 Git `HEAD` 创建只含受控 tracked 文件的候选目录，并以该隔离账号执行 `npm ci`、全量构建和检查。构建结束后会终止并确认该 uid 没有遗留进程，且候选 `updater.mjs` 的 SHA-256 与构建前一致，才交由 root 封存；在线服务账号始终不能进入可写候选。除 `node_modules` 与各 workspace 的 `dist` 外，checkout 中存在任何 ignored 内容（例如 `.env`、私钥、数据库或 release assets）都会 fail-closed，既不会复制到 release，也不会被改权。候选完成后脚本才启动现有备份 oneshot 并停止主服务；备份或停服失败会恢复原服务并验证健康。随后它会创建不可变 release 布局、安装以下 root-owned 文件、生成独立更新令牌，并用版本和完整 commit 验证迁移后的健康接口：

```text
/opt/lenovo-store-operations/
├── current -> releases/<version>-<commit>
├── previous -> releases/<version>-<commit>
└── releases/
    └── <version>-<commit>/
/usr/local/lib/lenovo-store-updater/updater.mjs
/etc/lenovo-store-updater.json
/etc/lenovo-store-release-signing.pub
/etc/systemd/system/lenovo-store-updater.service
/etc/systemd/system/lenovo-store-updater.path
/var/lib/lenovo-store-updater/status.json
/run/lenovo-store-updater/request.json
```

更新管理员令牌只在脚本成功结束时显示一次，应立即保存到受控密码管理器。专用 `lenovo-store-builder` 账号会保留给后续更新器使用，不得赋予登录 shell、业务数据权限或其他用途。迁移前 checkout 会原样保留为 `/opt/lenovo-store-operations.bootstrap-<commit前8位>`，成功后其顶层权限收紧为 `root:root 0700`；完成隔离故障演练并确认新布局稳定后再人工清理。脚本失败时会移除本次候选、专用构建账号和平台文件，恢复该 checkout 的原 owner/mode、环境文件和 unit，并要求旧版本 health 重新通过。脚本会把以下开关写入 root-only 环境文件：

```ini
LENOVO_STORE_UPDATE_ENABLED=true
LENOVO_STORE_UPDATE_TOKEN=<至少32字符的独立随机令牌>
LENOVO_STORE_PUBLIC_ORIGIN=https://store.example.com
LENOVO_STORE_UPDATE_REQUEST_PATH=/run/lenovo-store-updater/request.json
LENOVO_STORE_UPDATE_PROCESSING_PATH=/run/lenovo-store-updater/claimed/processing.json
LENOVO_STORE_UPDATE_STATE_PATH=/var/lib/lenovo-store-updater/status.json
```

签名公钥、`/usr/bin/node` 及其全部祖先必须由 root 拥有且不能被组或其他用户写；禁止把服务账号可修改的 NVM Node 配为 root updater 解释器。更新令牌不能与 `LENOVO_STORE_MAINTENANCE_TOKEN` 相同，也不受 `LENOVO_STORE_ALLOW_UNAUTHENTICATED_MAINTENANCE` 影响。`LENOVO_STORE_PUBLIC_ORIGIN` 必须与浏览器地址栏的 scheme、host 和 port 完全一致；生产安装只允许无路径 HTTPS origin。

### 6.4 日常在线安装与排查

1. 打开 `https://<store-host>/#/system`，先点击“检查更新”；
2. 仅当检查成功、结果非 stale、版本高于当前且更新器配置正常时，“安装最新版本”可用；
3. 输入独立更新管理员令牌，再完整输入“安装”二次确认；
4. 页面会轮询任务文件，服务重启期间短暂无法连接属于正常现象；
5. 最终必须看到“安装成功”，并核对 health 的完整 commit。若显示“安装失败，已回滚”，当前服务已恢复旧版本，但仍应查看更新器 journal；若显示“回滚异常”，立即停止重复操作并人工处理。

运维命令：

```bash
sudo systemctl status lenovo-store-updater.path lenovo-store-updater.service
sudo journalctl -u lenovo-store-updater.service -n 200 --no-pager
sudo journalctl -u lenovo-store-operations.service -n 200 --no-pager
sudo cat /var/lib/lenovo-store-updater/status.json
readlink -f /opt/lenovo-store-operations/current
readlink -f /opt/lenovo-store-operations/previous
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
```

不要手工编辑 `request.json`、`status.json`、manifest、签名或 release 目录，也不要给服务账号 `/opt/lenovo-store-operations`、`/etc`、`/usr/local/lib/lenovo-store-updater` 或状态目录写权限。更新器失败后不会循环重启；保留 journal、状态、备份和失败 release 供分析。

### 6.5 正式启用前故障演练

必须在隔离 Ubuntu 22.04 或更高版本主机逐项演练并记录结果：

- GitHub 断网、限流和下载中断：`current` 不变，业务继续运行；
- manifest 签名错误、SHA 错误、缺少资产、恶意重定向：切换前拒绝；
- 路径穿越、链接、特殊文件、重复路径和压缩炸弹：不能在 staging 外创建文件；
- `npm ci` 或 `npm run check` 失败、磁盘不足：切换前失败并清理 staging；
- 候选启动失败、版本/commit 不符、前端缺失或任一数据库断连：自动切回 previous 并验证旧版本；
- 旧版本也无法启动：状态为 `rollback-failed`，不循环重启，按人工恢复流程处理；
- 并发点击：最多一个 request 被领取，其余返回 409；
- 不可逆迁移或未知数据 schema：切换前拒绝。

未完成以上演练时保持 `LENOVO_STORE_UPDATE_ENABLED=false`，继续使用只读检查和人工升级。

## 7. 备份

### 7.1 系统状态页统一备份

适合人工迁移、按模块恢复和日常下载留档：

1. 打开 `https://<store-host>/#/system`；
2. 在“统一数据保护”区域点击“下载全部数据库备份”；
3. 令牌模式输入 `/etc/lenovo-store-operations.env` 中的 `LENOVO_STORE_MAINTENANCE_TOKEN`；可信局域网免令牌模式无需输入；
4. 浏览器下载一个 `lenovo-store-backup-<timestamp>.lsbackup` 文件；
5. 将文件移动到权限受控、具备独立备份策略的目录，并记录来源服务器和创建时间。

`.lsbackup` 一次包含三套 SQLite 在线一致性快照。本机 OCR 密钥模式下还包含配套密钥，因此该文件可以用于离线解密已保存的 OCR 凭据，必须按敏感密钥材料保护；环境密钥模式不会导出 `OCR_CONFIG_ENCRYPTION_KEY`，恢复付款凭证时目标服务必须配置相同环境密钥。文件最大 1GB，不压缩。清单和 SHA-256 能发现截断、重叠、尾随内容及传输损坏，但不能证明文件来源，只能使用从受信任服务器直接下载的文件。

浏览器统一备份不能替代无人值守的服务器定时备份。页面下载依赖浏览器会话和本机磁盘；定时、升级前和灾难恢复仍使用下一节的 `npm run backup:data` 目录快照。

### 7.2 手动在线目录备份

推荐通过下一节配置的 systemd oneshot 服务执行，这样可以复用主服务的账号、EnvironmentFile 和 `OCR_CONFIG_ENCRYPTION_KEY`：

```bash
sudo systemctl start lenovo-store-backup.service
sudo systemctl status lenovo-store-backup.service
sudo journalctl -u lenovo-store-backup.service -n 100 --no-pager
```

`systemctl start` 会等待备份结束，并在备份任务失败时返回非零状态。首次配置 oneshot 之前，也可以在项目根目录以实际服务账号运行 `npm run backup:data`，但必须提供与主服务完全相同的 `LENOVO_STORE_DATA_DIR`、`LENOVO_STORE_BACKUP_DIR` 和（如有）`OCR_CONFIG_ENCRYPTION_KEY`，不能只依赖当前 SSH 会话中的临时环境变量。

备份脚本会：

- 使用 SQLite backup API 分别生成三个一致性快照；
- 对每个快照执行 `PRAGMA integrity_check`；
- 记录表记录数、文件大小和 SHA-256；
- 备份并验证付款凭证 OCR 加密密钥；
- 先写入 staging，全部成功后再发布为时间戳目录；
- 生成权限为 `0600` 的 `manifest.json`。

备份目录示例：

```text
/var/backups/lenovo-store-operations/<timestamp>/
├── computer-labels/database.sqlite
├── price-labels/database.sqlite
├── receipt-assistant/database.sqlite
├── secrets/receipt-ocr.key
└── manifest.json
```

如果未配置 OCR 或数据库中没有 OCR 凭据，`secrets/receipt-ocr.key` 可能不存在，以 `manifest.json` 为准。

### 7.3 systemd 定时备份

创建 `/etc/systemd/system/lenovo-store-backup.service`：

```ini
[Unit]
Description=Backup Lenovo Store Operations data

[Service]
Type=oneshot
User=<service-user>
Group=<service-group>
WorkingDirectory=/opt/lenovo-store-operations
EnvironmentFile=/etc/lenovo-store-operations.env
ExecStart=/usr/bin/npm run backup:data
UMask=0077
```

创建 `/etc/systemd/system/lenovo-store-backup.timer`：

```ini
[Unit]
Description=Daily Lenovo Store Operations backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

同样需要根据 `command -v npm` 调整 `ExecStart`，使用 NVM 时还要配置 `PATH`。启用并测试：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lenovo-store-backup.timer
sudo systemctl start lenovo-store-backup.service
sudo systemctl status lenovo-store-backup.service
sudo systemctl list-timers lenovo-store-backup.timer
sudo journalctl -u lenovo-store-backup.service -n 100 --no-pager
```

当前脚本不会自动删除旧备份。应根据磁盘容量制定保留策略，并将重要备份同步到另一块磁盘或受控的远端存储。删除旧备份前至少保留一份已完成恢复演练的版本。

## 8. 恢复与回滚

系统状态页支持从 `.lsbackup` 在线按模块恢复；目录快照仍使用停服、staging 和 rollback 完成整套灾难恢复。两种方式用途不同：在线入口一次只覆盖一个模块的已知表，目录恢复则切换整个数据根。

### 8.1 系统状态页按模块恢复

1. 先下载并保留目标服务器当前数据的统一备份，作为人工回退点；
2. 打开 `https://<store-host>/#/system`，在“统一数据保护”区域选择 `.lsbackup`；
3. 令牌模式输入维护令牌；可信局域网免令牌模式无需输入。点击“上传并检查”后只创建最长 30 分钟的临时会话，不覆盖数据；
4. 核对备份编号、创建时间，以及商品、品类、销售、OCR 配置和 OCR 历史记录数量；
5. 每次只选择一个模块，点击“恢复此模块”，在二次确认框完整输入“恢复”；
6. 恢复后立即打开对应业务页核对记录数量、最新记录和关键数据，再决定是否恢复下一个模块；
7. 完成后点击“清除”，提前删除临时恢复会话。即使不操作，服务端也会在 30 分钟后清理。

在线恢复有以下边界：

- 三个模块没有跨库事务，因此不提供“一键恢复全部”；某模块失败不会回滚之前已明确成功的其他模块；
- 每个模块在一个 SQLite 事务内清空并复制已知表，失败会保留该模块恢复前数据；
- 付款凭证存在进行中的 OCR 识别或配置保存时会拒绝恢复；成功后会重建 OCR runtime；
- 本机密钥备份会先用包内密钥解密，再用目标服务器当前有效密钥重新加密，不直接覆盖目标密钥；
- 环境密钥指纹不匹配时，付款凭证显示“不兼容”且按钮禁用，但另外两个模块仍可恢复；
- 上传检查验证格式、摘要、SQLite 完整性、表结构、业务字段与计数，但不证明备份来源；
- 仓库货品标签原 Excel/SQLite 入口和周边货品价签原 JSON 入口继续保留。

生产环境维护接口始终要求同源请求和 `X-Lenovo-Store-Maintenance: 1`。令牌模式还要求正确的 Bearer 维护令牌；不要通过命令行历史直接拼接真实令牌，自动化应从 root-only 环境文件或密钥管理系统读取。可信局域网免令牌模式只取消 Bearer 要求，不取消同源和维护标识检查；任何能访问服务端口并构造请求的客户端仍可能执行备份或覆盖业务数据，因此必须通过防火墙限制可信网段，禁止在公网启用。人工操作优先使用系统状态页。

### 8.2 选择并校验目录快照

以下内容适用于 `npm run backup:data` 生成的目录快照，而不是 `.lsbackup` 文件。先查看 `manifest.json` 中的 `ocrKey.source`：

- `environment`：备份时实际使用 `OCR_CONFIG_ENCRYPTION_KEY`；恢复后的服务必须保留完全相同的环境密钥；
- `local-file`：快照中的 `secrets/receipt-ocr.key` 是实际密钥，应与付款凭证数据库成对恢复；
- `none`：备份时没有需要保存的 OCR 密钥。

运行时只要设置了 `OCR_CONFIG_ENCRYPTION_KEY`，它就会优先于恢复出的本机 key 文件。若要改用快照中的 key 文件，必须先从 EnvironmentFile 中移除冲突的环境密钥并执行 `systemctl daemon-reload`；否则 OCR 凭据可能无法解密。

以下命令会检查必需文件、大小和 `manifest.json` 中的 SHA-256，任一不一致都会停止：

```bash
set -Eeuo pipefail
SNAPSHOT=/var/backups/lenovo-store-operations/<timestamp>

sudo test -f "$SNAPSHOT/manifest.json"
sudo test -f "$SNAPSHOT/computer-labels/database.sqlite"
sudo test -f "$SNAPSHOT/price-labels/database.sqlite"
sudo test -f "$SNAPSHOT/receipt-assistant/database.sqlite"
sudo cat "$SNAPSHOT/manifest.json"

sudo -u <service-user> -H env SNAPSHOT="$SNAPSHOT" python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ['SNAPSHOT']).resolve()
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
items = list(manifest['databases'])
if manifest.get('ocrKey'):
    items.append(manifest['ocrKey'])

for item in items:
    candidate = (root / item['file']).resolve()
    if root not in candidate.parents or not candidate.is_file():
        raise SystemExit(f"备份文件无效或缺失：{item['file']}")
    if candidate.stat().st_size != item['bytes']:
        raise SystemExit(f"文件大小不一致：{item['file']}")
    digest = hashlib.sha256()
    with candidate.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != item['sha256']:
        raise SystemExit(f"SHA-256 不一致：{item['file']}")
    print(f"校验通过：{item['file']}")
PY
```

### 8.3 准备、检查并切换数据目录

恢复需要 Ubuntu 的 `sqlite3` 命令；没有时先安装对应系统包。下面整段必须在同一个 Shell 中执行，不要拆开跳过。它会检查 staging 和 rollback 均不存在，复制并校验完整性，停服后再切换；任一步失败都不会继续启动不完整的数据目录：

```bash
set -Eeuo pipefail

TARGET=/var/lib/lenovo-store-operations
SNAPSHOT=/var/backups/lenovo-store-operations/<timestamp>
RESTORE_ID=$(date +%Y%m%d-%H%M%S)
STAGING="${TARGET}.restore-${RESTORE_ID}"
ROLLBACK="${TARGET}.rollback-${RESTORE_ID}"
FAILED="${TARGET}.failed-${RESTORE_ID}"

command -v sqlite3 >/dev/null || {
  echo '缺少 sqlite3，请先安装后再恢复' >&2
  exit 1
}
sudo test -d "$TARGET" || {
  echo "当前数据目录不存在，停止恢复：$TARGET" >&2
  exit 1
}
sudo test ! -e "$STAGING" || {
  echo "staging 已存在，停止恢复：$STAGING" >&2
  exit 1
}
sudo test ! -e "$ROLLBACK" || {
  echo "rollback 已存在，停止恢复：$ROLLBACK" >&2
  exit 1
}
sudo test ! -e "$FAILED" || {
  echo "failed 目录已存在，停止恢复：$FAILED" >&2
  exit 1
}

sudo install -d -m 0750 -o <service-user> -g <service-group> "$STAGING"
sudo cp -a "$SNAPSHOT/computer-labels" "$STAGING/"
sudo cp -a "$SNAPSHOT/price-labels" "$STAGING/"
sudo cp -a "$SNAPSHOT/receipt-assistant" "$STAGING/"
if sudo test -d "$SNAPSHOT/secrets"; then
  sudo cp -a "$SNAPSHOT/secrets" "$STAGING/"
fi
sudo test -f "$STAGING/computer-labels/database.sqlite"
sudo test -f "$STAGING/price-labels/database.sqlite"
sudo test -f "$STAGING/receipt-assistant/database.sqlite"
sudo chown -R <service-user>:<service-group> "$STAGING"

for database in \
  "$STAGING/computer-labels/database.sqlite" \
  "$STAGING/price-labels/database.sqlite" \
  "$STAGING/receipt-assistant/database.sqlite"
do
  result=$(sudo sqlite3 "$database" 'PRAGMA integrity_check;')
  test "$result" = 'ok' || {
    echo "数据库完整性检查失败：$database：$result" >&2
    exit 1
  }
done

sudo systemctl stop lenovo-store-operations
if ! sudo mv "$TARGET" "$ROLLBACK"; then
  echo '无法保留当前数据目录，恢复已停止' >&2
  exit 1
fi
if ! sudo mv "$STAGING" "$TARGET"; then
  sudo mv "$ROLLBACK" "$TARGET"
  echo '无法发布恢复目录，已还原原数据目录' >&2
  exit 1
fi

health_ok=false
if sudo systemctl start lenovo-store-operations; then
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:8900/api/system/health >/dev/null; then
      health_ok=true
      break
    fi
    sleep 1
  done
fi

if [ "$health_ok" = true ]; then
  echo "恢复目录已启用；原数据保留在：$ROLLBACK"
else
  sudo systemctl stop lenovo-store-operations || true
  sudo mv "$TARGET" "$FAILED"
  sudo mv "$ROLLBACK" "$TARGET"
  sudo systemctl start lenovo-store-operations
  echo "恢复启动或健康检查失败，已回滚原数据；失败数据保留在：$FAILED" >&2
  exit 1
fi
```

### 8.4 业务验收和人工回滚

健康接口只能证明数据库可打开，不能证明恢复了正确的业务版本。切换成功后必须核对三个板块的记录数量、最新记录和付款凭证 OCR 解密；确认无误前保留 `$ROLLBACK`。

```bash
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
sudo journalctl -u lenovo-store-operations -n 100 --no-pager
```

如果业务验收失败，停服后使用同样的 fail-fast 原则将当前 `$TARGET` 移到新的失败目录，再把已记录的 `$ROLLBACK` 改回 `$TARGET`。不要在服务运行时覆盖数据库，也不要删除唯一可回滚副本。

## 9. 升级后数据为空的应急处理

如果升级后页面突然没有数据：

1. 不要继续新增、导入、删除或恢复数据；
2. 立即停止服务，避免向错误的空数据库继续写入；
3. 检查 systemd 实际加载的环境变量和日志；
4. 定位旧数据库，但不要把候选文件直接覆盖到当前目录；
5. 对当前目录和候选目录分别做冷备份；
6. 对比文件时间、大小、表记录数和完整性后再决定恢复来源。

检查命令：

```bash
sudo systemctl stop lenovo-store-operations
sudo systemctl show lenovo-store-operations \
  -p Environment -p EnvironmentFiles -p WorkingDirectory
sudo journalctl -u lenovo-store-operations -n 200 --no-pager
sudo find /opt /srv /var/lib -type f \
  \( -name 'database.sqlite' -o -name 'database.db' \) \
  -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' 2>/dev/null
```

重点检查：

- `LENOVO_STORE_DATA_DIR` 是否缺失、拼写错误或变成了新路径；
- 服务是否误用 `npm run dev`、`NODE_ENV=development` 或不同的 systemd unit；
- 部署是否重新 clone 到新目录、删除旧 release 或执行了 `git clean -fdx`；
- Docker 是否只设置环境变量而没有挂载持久 volume；
- 反向代理是否仍指向旧服务或其他端口。

普通 `git pull` 不会主动覆盖被 `.gitignore` 排除的 SQLite 文件。数据“消失”通常表示服务改用了另一套空数据库，或者旧 checkout、容器可写层被删除。确认原数据库仍存在后，应按“恢复与回滚”流程切换，不能在运行中覆盖。

## 10. Docker 和 PM2 注意事项

### Docker

必须同时配置环境变量和持久卷：

```yaml
environment:
  NODE_ENV: production
  LENOVO_STORE_DATA_DIR: /app-data
  LENOVO_STORE_BACKUP_DIR: /app-backups
volumes:
  - /var/lib/lenovo-store-operations:/app-data
  - /var/backups/lenovo-store-operations:/app-backups
```

只配置 `LENOVO_STORE_DATA_DIR` 而不挂载 volume，数据仍位于容器临时写入层，重建容器后会丢失。

### PM2

必须将 `LENOVO_STORE_DATA_DIR` 和 `LENOVO_STORE_BACKUP_DIR` 写入持久的 ecosystem 配置，而不是只在当前 SSH 会话中 `export`。更新配置后执行对应的 PM2 reload，并使用 `pm2 save` 保存进程列表。重启服务器后再次检查健康接口中的 `persistentDataConfigured`。

## 11. 验收清单

首次部署、数据迁移、恢复或升级后逐项确认：

- [ ] 当前 Git 提交是预期版本；
- [ ] systemd 服务为 active；
- [ ] 启动日志中的数据根为 `/var/lib/lenovo-store-operations`；
- [ ] 健康接口 `persistentDataConfigured` 为 `true`；
- [ ] 三个 SQLite 板块 `databaseConnected` 为 `true`；
- [ ] 三个板块记录数量和最新记录正确；
- [ ] 付款凭证 OCR 配置可用；
- [ ] 员工工牌页面可访问，并理解其数据不会持久化；
- [ ] 手动备份成功生成时间戳目录和 `manifest.json`；
- [ ] systemd 定时备份已启用；
- [ ] 至少完成过一次隔离恢复演练；
- [ ] 数据目录和备份目录不在 Git checkout 内。
