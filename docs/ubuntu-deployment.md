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

生产环境应将不可变代码、持久化数据、备份和更新器状态彻底分离：

```text
/opt/lenovo-store-operations/
├── releases/<version>-<40位commit>/  # 已验证的不可变版本
├── current -> releases/<...>         # 主服务当前版本
└── previous -> releases/<...>        # 最近可回退版本
/var/lib/lenovo-store-operations/      # 持久化业务数据
/var/backups/lenovo-store-operations/  # 一致性备份
/var/lib/lenovo-store-updater/         # root-owned 状态与事务 journal
/run/lenovo-store-updater/             # Web→systemd 受限单任务 IPC
/etc/lenovo-store-operations.env       # root-only 服务环境变量
/etc/lenovo-store-updater.json         # root-only 更新器配置
/etc/lenovo-store-release-signing.pub  # 固定 Ed25519 发布公钥
/usr/local/lib/lenovo-store-updater/   # root-owned 更新器程序
```

新服务器先在 `/opt/lenovo-store-operations` 建立可运行的 bootstrap Git checkout；执行 `ops/install-updater.sh` 后，脚本会把已提交且已推送的当前 HEAD 构建为首个 `releases/<version>-<commit>`，再原子建立 `current` 和 `previous`。迁移前 checkout 会以 `root:root 0700` 保留在同级 bootstrap 备份中，完成故障演练前不要删除。

推荐原则：

1. 主服务使用普通 `<service-user>`，只能读取 release 并写入业务数据、备份目录和受限请求目录；不得以 root 运行，也不直接执行 Shell、npm 或 systemctl；
2. root-owned updater 只由 systemd oneshot 启动，固定仓库、下载域名、公钥、服务名、路径和 builder uid/gid；候选构建使用独立不可登录账号；
3. 所有 release 固定使用 `/var/lib/lenovo-store-operations`，更新和回滚不得覆盖业务数据库；
4. 备份目录不能位于代码目录或数据目录内部，也不能是符号链接；
5. 禁止对数据、备份或 updater 状态目录执行 `git clean -fdx`、`rm -rf` 或带 `--delete` 的同步命令；
6. 无维护令牌的在线更新只适用于受 UFW/VLAN/ACL 保护的可信局域网，禁止将 `8900/tcp` 暴露到公网。

应用会拒绝把显式配置的 `LENOVO_STORE_DATA_DIR` 指向项目目录内部、文件系统根目录或经符号链接返回项目目录的位置。生产模式漏配该变量时也会拒绝启动，避免新 release 静默创建空数据库。

## 3. 部署前准备

### 3.1 软件要求

- Ubuntu 22.04 LTS 或更新版本；
- Git、curl、tar、systemd 和常用 GNU 工具；
- Node.js `22.21.1`，最低要求为 `22.12.0`；
- npm；
- 可选：Nginx，用于 HTTPS 或反向代理。

检查版本：

```bash
node --version
npm --version
git --version
```

项目根目录的 `.nvmrc` 固定为 Node.js `22.21.1`。bootstrap checkout 可由服务账号使用 NVM 构建，但 root updater 的 `--node-path` 及全部祖先目录必须由 root 拥有且不可由组或其他用户写，因此不能使用服务账号 HOME 下的 NVM Node。生产在线更新建议安装系统级 Node.js，使 `command -v node` 和 `command -v npm` 分别得到 `/usr/bin/node`、`/usr/bin/npm` 或其他 root-controlled 绝对路径。首次迁移脚本会再次验证 Node `>=22.12.0`、路径所有权和写权限。

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

推荐内容（可信局域网直接访问）：

```ini
NODE_ENV=production
HOST=0.0.0.0
PORT=8900
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations
LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations
# LENOVO_STORE_GITHUB_TOKEN=<固定仓库只读 GitHub token>
# LENOVO_STORE_MAINTENANCE_TOKEN=<可选，至少24字符的随机维护令牌>
```

说明：

- 直接提供局域网访问时使用 `HOST=0.0.0.0`，并通过 Ubuntu 防火墙或 VLAN 只允许门店可信网段访问 `8900/tcp`，不得将端口暴露到公网；通过 Nginx 反向代理时可改用 `HOST=127.0.0.1`，代理必须保留原始 `Host` 并设置 `X-Forwarded-Proto $scheme`；
- `LENOVO_STORE_DATA_DIR` 和 `LENOVO_STORE_BACKUP_DIR` 必须为绝对路径；
- `LENOVO_STORE_GITHUB_TOKEN` 可选且只由服务端用于固定仓库的 Releases API。建议只授予 `zifeng-chen/lenovo-store-operations` 的 Contents/Metadata 读取权限；不配置时使用 GitHub 匿名额度；
- `LENOVO_STORE_MAINTENANCE_TOKEN` 可选。未配置时服务正常启动，可信局域网客户端无需 Bearer 即可执行统一备份恢复；配置后必须至少 24 个字符，所有统一维护请求都强制 Bearer 鉴权；
- 无令牌模式仍要求 `X-Lenovo-Store-Maintenance: 1`，浏览器请求仍执行同源检查，但这两项不是身份认证，不能替代防火墙；任何能访问服务端口并构造请求的客户端都可能下载或覆盖数据库；
- 可用 `openssl rand -base64 32` 生成维护令牌，并只写入权限 `0600` 的环境文件；页面令牌只保存在当前内存；
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

首次迁移脚本还要求存在可工作的 `/etc/systemd/system/lenovo-store-backup.service`。在 bootstrap 阶段创建：

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
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/lenovo-store-operations /var/backups/lenovo-store-operations
```

`ExecStart` 必须替换为服务器上 `command -v npm` 返回的绝对路径。bootstrap 主服务可以临时使用服务账号 NVM；此时可在主服务中使用下面的 `PATH` 与 `ExecStart`，但不要同时保留两条 `ExecStart`。安装在线更新平台时仍必须另外提供 root-controlled Node/npm 路径。

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

### 4.4 安装签名在线更新平台

只有 bootstrap 服务连续健康、当前 Git HEAD 已提交并推送、工作区完全干净后才能迁移。先把与 GitHub Actions `RELEASE_SIGNING_PUBLIC_KEY_SHA256` 对应的 Ed25519 公钥安全复制到 root-only 路径；当前生产公钥 SPKI SHA-256 指纹为：

```text
79e8d0b7c054d44f812c8cb36403b104abdca189393b491ec7b1732b03b9cadf
```

确认公钥来源后执行；参数必须替换为实际服务账号和 root-controlled Node/npm 绝对路径：

```bash
cd /opt/lenovo-store-operations
sudo ./ops/install-updater.sh \
  --service-user <service-user> \
  --public-key /root/release-signing-public.pem \
  --public-key-sha256 79e8d0b7c054d44f812c8cb36403b104abdca189393b491ec7b1732b03b9cadf \
  --node-path /usr/bin/node \
  --npm-path /usr/bin/npm \
  --confirm-migration
```

脚本在变更前验证 Git clean/upstream、root-controlled 工具和公钥指纹，并要求旧服务连续通过健康检查；随后创建专用 `lenovo-store-builder` 账号，从当前 commit 的 Git archive 构建候选，执行 `npm ci --include=dev`、全量 build/check 和一致性备份，再迁移为 `releases/current/previous`。它会替换主服务与备份 unit、安装 updater service/path/tmpfiles、向环境文件追加以下非秘密配置并重启服务：

```ini
LENOVO_STORE_UPDATE_ENABLED=true
LENOVO_STORE_UPDATE_REQUEST_PATH=/run/lenovo-store-updater/request.json
LENOVO_STORE_UPDATE_PROCESSING_PATH=/run/lenovo-store-updater/claimed/processing.json
LENOVO_STORE_UPDATE_STATE_PATH=/var/lib/lenovo-store-updater/status.json
```

脚本不会生成独立更新令牌，也不会修改已有 `LENOVO_STORE_MAINTENANCE_TOKEN`。任一步失败会恢复原 checkout、环境文件、systemd unit、账号和服务健康状态。成功后检查：

```bash
sudo systemctl status lenovo-store-operations.service
sudo systemctl status lenovo-store-updater.path
sudo systemctl status lenovo-store-updater.service
sudo systemctl cat lenovo-store-operations.service
readlink -f /opt/lenovo-store-operations/current
readlink -f /opt/lenovo-store-operations/previous
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
```

health 必须返回 `persistentDataConfigured: true`、`updateInstallationEnabled: true`，且 `build.version`、40 位 `build.commit` 与 `current/release-info.json` 完全一致。无维护令牌时还应显示 `maintenanceAccessMode: trusted-lan` 和 `updateAuthenticationRequired: false`；配置维护令牌时后者必须为 `true`。

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

### 5.5 `0.3.0` 添加日期迁移与旧备份兼容

升级到 `0.3.0` 后，服务启动时会幂等检查仓库货品和周边货品的 `products` 表。旧 SQLite 缺少 `added_date` 时会自动新增该列，并优先将每条记录的 UTC `created_at` 换算为 `Asia/Shanghai` 日历日期回填；无法派生时才使用迁移当天的上海日期。迁移不会重置已有 `added_date`，也不会修改 `created_at`。首次升级后应在两个商品页面抽查历史日期，并先完成外部备份再继续日常操作。

兼容边界如下：

- 仓库货品旧 Excel 不含日期列时仍可导入：新增 SKU 使用当天，覆盖已有 SKU 时保留原添加日期；新文件可使用 `added_date` 或“添加日期”；
- 周边货品 JSON 导出使用 `schemaVersion: 2`；旧 `schemaVersion: 1` 仍可检查和导入，并从 `created_at` 派生添加日期；
- 统一 `.lsbackup` 恢复同时接受迁移前后两种商品表结构，恢复旧快照时会补齐添加日期；
- 单独恢复旧仓库货品 SQLite 后，服务也会在重新打开数据库时执行同一迁移。

## 6. 日常升级流程

在线更新平台安装并完成演练后，日常稳定版升级优先从 Portal 操作：

1. 打开 `https://<store-host>/#/system` 并点击“检查更新”；
2. 只有服务端刚成功获取、未过期、无错误且高于当前版本的 latest stable Release 才会启用“安装最新版本”；
3. 无维护令牌的可信局域网可直接继续；配置维护令牌时按页面提示输入，令牌只保存在当前页面内存；
4. 在二次确认框完整输入“安装”；
5. 保持页面打开，观察排队、备份、下载、验签、构建、切换、重启、连续健康检查和完成/回滚阶段；
6. 完成后核对 health 的版本和完整 commit，并检查三套数据库及关键业务记录。

Web 服务只提交 tag 和任务编号，不接收 URL、commit、Shell 参数或任意历史版本。root updater 会重新从固定 GitHub Release 获取 `manifest.json`、Ed25519 签名、`SHA256SUMS` 和发布包；只有四项身份与摘要绑定、候选构建检查和升级前备份全部成功后才切换 `current`。健康检查失败会自动把 `current`、`previous` 恢复到旧 release 并重新验证；数据目录不会随代码切换。

### 6.1 在线安装状态与安全边界

系统状态页和 API 采用以下边界：

- `GET /api/system/update/status` 返回当前版本、最近检查和已脱敏安装状态，不主动联网；
- `POST /api/system/update/check` 仅接受同源页面，固定访问 `zifeng-chen/lenovo-store-operations` Releases API，只比较非草稿、非预发布、严格 `vX.Y.Z` 的稳定版本；
- `POST /api/system/update/install` 必须带 `X-Lenovo-Store-Maintenance: 1`、非空同源 `Origin`，拒绝 `Sec-Fetch-Site: cross-site`，body 只能是 `{ "tag": "vX.Y.Z" }`；缓存结果 stale、最后检查失败、无新版本或 tag 不等于刚检测到的 latest 时一律拒绝；
- 未配置维护令牌时不要求 Bearer；配置 `LENOVO_STORE_MAINTENANCE_TOKEN` 后缺失或错误 Bearer 会拒绝，并对 15 分钟内连续失败限流；
- `/run/lenovo-store-updater` 只允许服务组写入顶层请求，`claimed` 由 root 独占；每次只能存在一个请求，文件必须为 `0600` 普通文件；
- updater 固定下载域名、仓库、公钥、Release 资产名、contract version、安装模式和健康路径；拒绝链接、特殊文件、路径穿越、重复归档项、超量文件或解压体积；
- 候选依赖安装和检查由独立 builder uid/gid 执行；该账号与服务账号隔离，构建结束后强制清理全部遗留进程并再次核对 updater 摘要；
- `claimed/preparing/prepared/switched/recovered/committed` journal 覆盖强杀和断电恢复。`rollback-failed` 表示旧版本也未重新通过 health，必须立即人工处理，不得继续提交更新。

可选 `LENOVO_STORE_GITHUB_TOKEN` 只用于 Web 服务版本检查；root updater 下载公开 Release 时不读取该 token。若 GitHub 仓库改为私有，当前在线更新会安全失败，不能通过向浏览器或 updater 临时注入高权限 token 绕过。

### 6.2 创建 Release 签名密钥

签名密钥只供 GitHub Release 工作流使用。在离线、权限受控的机器上生成一次 Ed25519 密钥对：

```bash
mkdir -m 0700 /secure/offline/release-signing
node ops/release/generate-signing-keypair.js /secure/offline/release-signing
base64 < /secure/offline/release-signing/release-signing-private.pem | tr -d '\n'
```

将私钥 PEM 的 base64 单行结果保存为 GitHub Actions Secret `RELEASE_SIGNING_PRIVATE_KEY`，并把工具输出的公钥 SHA-256 指纹保存为 Actions Variable `RELEASE_SIGNING_PUBLIC_KEY_SHA256`。私钥原文件进入离线密钥备份，不得复制到 Ubuntu 主机、代码仓库、聊天或工单。Ubuntu 在线更新主机只安装公钥，并在首次迁移时用固定指纹核对；公钥变更属于显式信任根轮换，必须先线下验证、更新 Actions Variable 和部署文档，再在维护窗口人工替换，不能由在线 Release 自动更换。

### 6.3 从 `0.3.0` Git checkout 迁移

`0.3.0` 主机使用单一 Git checkout，没有 updater 状态。它必须先进行一次人工升级，把 `0.4.0` 的安装脚本和签名契约部署到 bootstrap checkout，再执行第 4.4 节的一次性迁移：

1. 确认外部数据目录、备份目录和现有主/备份 systemd unit 正常，记录当前 commit 与业务数量；
2. 运行 `lenovo-store-backup.service`，确认备份成功；
3. 以服务账号执行 `git pull --ff-only origin main`，确认 HEAD 为已发布的 `v0.4.0` commit，然后执行 `npm ci`、`npm run build`、`npm run check`；
4. 重启 bootstrap 主服务并确认 `0.4.0` health、数据目录和三套数据库正常；此时在线安装仍可能未启用；
5. 确认工作区 clean 且 HEAD 与 upstream 完全一致，准备固定 Ed25519 公钥和 root-controlled Node/npm；
6. 按第 4.4 节运行 `ops/install-updater.sh --confirm-migration`；脚本会再次备份并把 checkout 转换为不可变 release 布局；
7. 验证 `current`、`previous`、updater path、health 和 Portal 后，保留脚本输出的 bootstrap 目录，直至完成一次签名升级、模拟失败回滚和重启恢复演练。

最后一次人工升级示例：

```bash
set -Eeuo pipefail
sudo systemctl start lenovo-store-backup.service
sudo -u <service-user> -H bash -lc '
  set -Eeuo pipefail
  cd /opt/lenovo-store-operations
  git pull --ff-only origin main
  git describe --tags --exact-match HEAD
  npm ci
  npm run build
  npm run check
'
sudo systemctl restart lenovo-store-operations.service
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
# health 与业务数据确认无误后，再执行第 4.4 节 install-updater.sh。
```

人工升级或迁移失败时不要继续运行安装脚本。若 `install-updater.sh` 在变更后失败，它会自动恢复原 checkout、unit 和环境文件；若脚本报告自动恢复未完整通过，立即检查其保留目录、`systemctl status`、journal 和 health，不得手工删除候选或 bootstrap。

### 6.4 已安装 `0.2.0`–`0.2.2` updater 的主机

这类主机已经使用 `releases/current/previous` 和同一 contract `1`，可先用原 Portal 及原独立更新令牌安装签名 `v0.4.0`；新 release 会在候选构建与 health 通过后替换 updater 程序。升级完成后：

1. 核对 `current/release-info.json`、health 版本和完整 commit；
2. 从 `/etc/lenovo-store-operations.env` 删除已废弃的 `LENOVO_STORE_UPDATE_TOKEN` 与 `LENOVO_STORE_PUBLIC_ORIGIN`，保留 `LENOVO_STORE_UPDATE_ENABLED` 和三个 IPC 路径；
3. 根据需要配置统一 `LENOVO_STORE_MAINTENANCE_TOKEN`；未配置时即进入可信局域网免 Bearer 模式；
4. `systemctl daemon-reload` 并重启主服务，确认 Portal 不再要求独立更新令牌；
5. 完成升级失败、健康检查失败和重启恢复演练后，再按保留策略清理不再被 `current`/`previous` 引用的旧 release。

如果旧 updater 因公钥、资产或配置损坏无法安装 `v0.4.0`，不要绕过签名或手工覆盖 `current`。应先创建外部备份，保留整个旧 release 根和 unit，再在维护窗口按已审核的人工恢复步骤重建 bootstrap checkout并执行第 4.4 节迁移。

## 7. 备份

### 7.1 系统状态页统一备份

适合人工迁移、按模块恢复和日常下载留档：

1. 打开 `https://<store-host>/#/system`；
2. 在“统一数据保护”区域点击“下载全部数据库备份”；
3. 令牌模式输入 `/etc/lenovo-store-operations.env` 中的 `LENOVO_STORE_MAINTENANCE_TOKEN`；可信局域网免令牌模式无需输入；
4. 浏览器下载一个 `lenovo-store-backup-<timestamp>.lsbackup` 文件；
5. 将文件移动到权限受控、具备独立备份策略的目录，并记录来源服务器和创建时间。

`.lsbackup` 一次包含三套 SQLite 在线一致性快照。本机 OCR 密钥模式下还包含配套密钥，因此该文件可以用于离线解密已保存的 OCR 凭据，必须按敏感密钥材料保护；环境密钥模式不会导出 `OCR_CONFIG_ENCRYPTION_KEY`，恢复付款凭证时目标服务必须配置相同环境密钥。付款凭证快照同时校验 OCR 调用次数账本；恢复时识别历史按备份替换，但用量账本只按请求与尝试编号合并、不清空目标已有记录，避免通过恢复旧备份增加免费剩余次数。文件最大 1GB，不压缩。清单和 SHA-256 能发现截断、重叠、尾随内容及传输损坏，但不能证明文件来源，只能使用从受信任服务器直接下载的文件。

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

在线更新平台安装后，`/etc/systemd/system/lenovo-store-backup.service` 应使用不可变当前 release：

```ini
[Unit]
Description=Backup Lenovo Store Operations data

[Service]
Type=oneshot
User=<service-user>
Group=<service-group>
WorkingDirectory=/opt/lenovo-store-operations/current
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

### 8.5 代码 release 人工回退

正常更新失败由 updater 自动回滚。只有 updater 已停止、`/var/lib/lenovo-store-updater/transaction.json` 不存在，且维护人员已核对 `current`、`previous` 都直接指向同一 `releases` 目录下的普通 release 时，才可人工交换链接。存在事务 journal 时应先查看 `lenovo-store-updater.service` journal 并让恢复流程处理，不能绕过 journal 强改链接。

```bash
set -Eeuo pipefail
ROOT=/opt/lenovo-store-operations
sudo test ! -e /var/lib/lenovo-store-updater/transaction.json
CURRENT=$(readlink -f "$ROOT/current")
PREVIOUS=$(readlink -f "$ROOT/previous")
sudo test "$(dirname "$CURRENT")" = "$ROOT/releases"
sudo test "$(dirname "$PREVIOUS")" = "$ROOT/releases"
sudo test -f "$CURRENT/release-info.json"
sudo test -f "$PREVIOUS/release-info.json"

sudo systemctl stop lenovo-store-operations.service
sudo ln -s "releases/$(basename "$PREVIOUS")" "$ROOT/.current.manual"
sudo ln -s "releases/$(basename "$CURRENT")" "$ROOT/.previous.manual"
sudo mv -Tf "$ROOT/.previous.manual" "$ROOT/previous"
sudo mv -Tf "$ROOT/.current.manual" "$ROOT/current"
sudo systemctl start lenovo-store-operations.service
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
```

核对 health 的版本/commit 与回退目标 `release-info.json` 一致，并复核业务数据。人工回退只切换代码，不恢复数据库；当前 contract 禁止自动安装声明不可逆数据迁移的 Release。完成排障前保留两个 release、外部备份、updater 状态和 journal 日志。

上线前至少在隔离 Ubuntu 主机演练：无效签名或摘要应在切换前失败；候选 health 失败应自动回滚；在 `prepared`/`switched` 阶段终止 updater 或重启主机后应由 journal 恢复旧链接并重新通过 health；`rollback-failed` 应触发人工告警。演练不得使用生产数据唯一副本。

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

签名在线安装器只支持本指南的 Ubuntu systemd、root-owned updater 和 `releases/current/previous` 布局。Docker 或 PM2 部署可以继续使用版本检查、统一备份恢复和业务功能，但必须保持 `LENOVO_STORE_UPDATE_ENABLED` 未启用，并由外部编排系统完成签名验证、备份、切换和回滚；不要把 Docker socket、宿主机 systemctl 或 root 权限暴露给 Web 服务。

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

- [ ] `/opt/lenovo-store-operations/current` 和 `previous` 都直接指向 `releases` 下的预期普通目录；
- [ ] health 的产品版本和完整 commit 与 `current/release-info.json` 一致；
- [ ] `lenovo-store-operations.service` 为 active，`lenovo-store-updater.path` 已启用；
- [ ] updater 配置、公钥、程序、状态目录和 claimed 目录的 owner/mode 符合 root 边界；
- [ ] 启动日志中的数据根为 `/var/lib/lenovo-store-operations`；
- [ ] 健康接口 `persistentDataConfigured` 和 `updateInstallationEnabled` 均为 `true`；
- [ ] 三个 SQLite 板块 `databaseConnected` 为 `true`；
- [ ] 三个板块记录数量和最新记录正确；
- [ ] 付款凭证 OCR 配置可用；
- [ ] 员工工牌页面可访问，并理解其数据不会持久化；
- [ ] 手动备份成功生成时间戳目录和 `manifest.json`；
- [ ] systemd 定时备份已启用；
- [ ] UFW/VLAN/ACL 只允许可信网段访问，`8900/tcp` 未暴露公网；
- [ ] Portal 仅在 fresh latest Release 时启用安装，并正确执行免令牌或统一维护令牌流程；
- [ ] 至少完成过一次隔离数据恢复、签名拒绝、health 失败自动回滚和中断事务恢复演练；
- [ ] 数据目录和备份目录位于 release 根之外。
