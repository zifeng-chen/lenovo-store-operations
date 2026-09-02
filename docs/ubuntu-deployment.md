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
/opt/lenovo-store-operations/          # Git 代码目录
/var/lib/lenovo-store-operations/      # 持久化数据目录
/var/backups/lenovo-store-operations/  # 备份目录
/etc/lenovo-store-operations.env       # systemd 环境变量
```

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

### 6.1 GitHub 在线更新方案（规划）

> 当前版本尚未实现在线安装。本节是后续实施方案；现阶段仍按上一节手工升级。

在线更新固定从公开仓库 `zifeng-chen/lenovo-store-operations` 的 GitHub Release 获取，只跟随 `stable` 通道，不允许页面传入任意仓库、下载地址或 Shell 命令。建议分两个阶段实施：先上线只读更新检测，再上线安装和回滚。

1. **发布产物**：每次发布创建语义版本 tag 和 GitHub Release，由 CI 生成只读源码/构建包、`manifest.json`、SHA-256 校验文件，条件允许时再增加签名。清单至少记录版本、提交哈希、发布日期、下载资源、摘要、最低 Node.js 版本和数据结构版本。
2. **只读检测**：服务端通过 GitHub Releases API 查询最新稳定版，使用 `ETag` 做缓存并按语义版本比较；系统状态页显示当前版本、最新版本、发布时间、变更摘要和“检查更新”结果。网络或 GitHub 不可用时只报告失败，不影响业务服务。
3. **不可变目录**：版本安装到 `/opt/lenovo-store-operations/releases/<version>-<commit>/`，安装完成后设为只读；`/opt/lenovo-store-operations/current` 原子指向当前版本，`previous` 保留上一个已验证版本。`/var/lib/lenovo-store-operations`、备份目录、环境文件和密钥始终位于 release 目录之外，升级和回滚都不得修改或删除它们。
4. **外部更新器**：使用 root 拥有且普通服务账号不可修改的 systemd oneshot 更新器执行下载、校验、安装、切换和服务重启。Express 只通过固定、严格校验的控制通道提交 Release 版本号并读取状态，不直接执行 `git pull`、`npm`、任意 Shell 或 root 命令。
5. **安装流程**：获取共享维护锁，拒绝与备份或恢复并发；运行升级前一致性备份；下载到临时目录；校验仓库、版本、SHA-256/签名和清单兼容性；在候选 release 中执行锁定依赖安装、构建和检查；记录旧目标；原子切换 `current`；重启服务并检查 `/api/system/health`、运行版本及关键数据库可读性。
6. **失败回滚**：下载、校验、安装或构建失败时不切换；切换后若健康检查在限定时间内失败，立即将 `current` 切回 `previous` 并重启。涉及不可逆数据迁移的版本不得自动安装，必须先提供可验证的迁移和恢复策略。
7. **API 与页面**：规划提供只读状态、手动检查、安装操作状态和回滚能力，例如 `GET /api/system/update/status`、`POST /api/system/update/check`、`POST /api/system/update/install`、`GET /api/system/update/operations/:id`、`POST /api/system/update/rollback`。安装和回滚必须沿用维护接口的同源、维护标识与令牌/可信局域网策略，并记录操作者来源、目标版本、结果和日志摘要。

推荐实施顺序：版本信息与只读检测 → Release CI 和摘要校验 → 不可变 release 部署 → systemd 更新器与自动回滚 → Portal 安装/回滚入口。正式启用安装前，应在隔离 Ubuntu 主机完成断网、损坏包、构建失败、启动超时和数据库不兼容演练。

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
/var/backups/lenovo-store-operations/2026-08-20T10-20-30.000Z/
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
