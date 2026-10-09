# Ubuntu ARM64 从零部署、迁移、在线更新与灾难恢复手册

本文是 `lenovo-store-operations` 在 Ubuntu ARM64 生产服务器上的逐条执行手册，当前对应产品版本 `0.5.0`、Node.js `22.21.1` 和签名 updater contract `1`。通用原理、Docker/PM2 限制及更完整的数据恢复背景见 [Ubuntu 部署、数据持久化与备份恢复指南](ubuntu-deployment.md)。

> **适用范围**：本文只支持 `dpkg --print-architecture=arm64`、`uname -m=aarch64`、Node.js `process.platform=linux` 且 `process.arch=arm64` 的 64 位 Ubuntu。不要在 `armhf`、ARMv7、32 位用户空间、Debian/Raspberry Pi OS 或非 systemd 容器上照抄本文并视为受支持生产部署。
>
> **执行原则**：每个代码块执行成功后再进入下一节；看到 `<...>` 或示例网段时必须先替换。不要把整篇文档一次性粘贴进 Shell。所有 `sudo` 命令都应由获授权的运维人员执行。

## 1. 最终目录和信任边界

部署完成后的固定布局如下：

```text
/opt/node-v22.21.1-linux-arm64/        # root-owned Node.js 与 npm
/opt/lenovo-store-operations/
├── releases/<version>-<40位commit>/  # root 封存的不可变 release
├── current -> releases/<...>         # 当前代码
└── previous -> releases/<...>        # 最近回退代码
/var/lib/lenovo-store-service/         # 服务账号 HOME，不保存 release
/var/lib/lenovo-store-operations/      # 四套 SQLite 与 OCR 密钥
/var/backups/lenovo-store-operations/  # 一致性备份
/var/lib/lenovo-store-updater/         # root-owned 状态和事务 journal
/run/lenovo-store-updater/             # 受限 Web → systemd 单任务 IPC
/etc/lenovo-store-operations.env       # root-only 服务环境变量
/etc/lenovo-store-updater.json         # root-only updater 配置
/etc/lenovo-store-release-signing.pub  # 固定 Ed25519 发布公钥
/usr/local/lib/lenovo-store-updater/   # root-owned updater 程序
```

固定账号：

- 主服务用户和组：`lenovo-store:lenovo-store`；
- HOME：`/var/lib/lenovo-store-service`；
- Shell：`/usr/sbin/nologin`；
- updater 安装时自动创建：`lenovo-store-builder`；部署前该用户和组必须不存在；
- Web 服务不能以 root 运行，也不能直接执行 `systemctl`、Shell 或 npm 更新命令；
- root updater 只安装签名 GitHub Release，候选构建由独立 builder 完成。

## 2. 部署前信息表

先记录真实值。本文示例使用 `192.168.10.0/24`，它不是所有门店都适用。

| 项目 | 应填写的值 | 示例 |
| --- | --- | --- |
| 服务器固定 IP/主机名 |  | `192.168.10.20` |
| SSH 管理端口 |  | `22` |
| 允许 SSH 的管理网段 |  | `192.168.10.0/24` |
| 允许访问 Portal 的门店网段 |  | `192.168.10.0/24` |
| Portal 监听方式 |  | `0.0.0.0:8900` 或 `127.0.0.1:8900 + Nginx` |
| 数据来源 | 只选一种 | 新服务器 / 旧仓库 `data/` / 三个旧项目 |
| 是否配置维护令牌 |  | 建议配置，至少 24 字符 |
| 是否使用百度 OCR |  | 是 / 否 |
| 异地备份目标 |  | 加密 NAS、受控备份服务器或离线介质 |

确认已具备：

1. 可用的 `sudo` 管理账号和第二个不会断开的 SSH 会话；
2. 门店真实 CIDR、SSH 端口和固定 IP；
3. 至少 10 GiB `/opt` 可用空间，数据和备份另计；
4. 建议至少 4 GiB RAM；内存较小时配置 swap；
5. 旧数据的独立副本；
6. 能访问 GitHub、Node.js、npm lockfile 实际下载域名的出站网络；
7. 防火墙变更前可用的本地控制台或带外管理通道。

## 3. ARM64、系统、时间和资源预检

### 3.1 必须通过的架构检查

```bash
set -Eeuo pipefail

printf 'dpkg architecture: '
dpkg --print-architecture
printf 'kernel machine: '
uname -m

[ "$(dpkg --print-architecture)" = "arm64" ] || {
  echo '停止：Ubuntu 用户空间不是 arm64。' >&2
  exit 1
}
[ "$(uname -m)" = "aarch64" ] || {
  echo '停止：内核架构不是 aarch64。' >&2
  exit 1
}

echo 'ARM64 架构检查通过。'
```

出现以下任一结果都必须停止：

- `dpkg` 输出 `armhf`；
- `uname` 输出 `armv7l`；
- 在 x86 主机上通过不透明仿真运行 ARM 用户空间；
- 64 位内核搭配 32 位 Ubuntu 用户空间。

lockfile 中出现某些 ARM 可选包，不代表整个应用支持 32 位 ARM。

### 3.2 Ubuntu 和 systemd 检查

```bash
set -Eeuo pipefail
. /etc/os-release
printf 'OS: %s %s\n' "$ID" "$VERSION_ID"
[ "$ID" = "ubuntu" ] || {
  echo '停止：本文只针对 Ubuntu。' >&2
  exit 1
}
dpkg --compare-versions "$VERSION_ID" ge 22.04 || {
  echo '停止：需要 Ubuntu 22.04 LTS 或更新版本。' >&2
  exit 1
}
[ "$(ps -p 1 -o comm=)" = "systemd" ] || {
  echo '停止：PID 1 不是 systemd。' >&2
  exit 1
}
systemctl --version | sed -n '1p'
```

### 3.3 时间、时区和 NTP

签名、Release 时间、日志关联和备份目录都依赖正确时间：

```bash
timedatectl status
sudo timedatectl set-timezone Asia/Shanghai
sudo timedatectl set-ntp true
sleep 3
timedatectl status
```

必须确认 `System clock synchronized: yes`。若企业网络使用内部 NTP，应先按企业规范配置，不要在时间明显错误时继续部署。

### 3.4 CPU、内存、磁盘和挂载点

```bash
lscpu
free -h
swapon --show
lsblk -f
df -hT / /opt /var
mount | grep -E ' on /(opt|var)(/| )' || true
```

要求和建议：

- `/opt` 构建候选 release 建议至少 10 GiB 可用；安装器最低只会拦截低于 1 GiB 的情况，不代表 1 GiB 足够；
- 数据目录和备份目录不能是临时盘；
- 不要把 `/var/lib/lenovo-store-operations` 放入会在重启时清理的 tmpfs；
- 备份目录与数据目录不能重叠，且不能是符号链接；
- updater 构建期间可能同时存在旧 release、候选 release、npm cache 和压缩包。

### 3.5 低内存机器可选配置 4 GiB swap

已有足够 swap 时跳过。swap 可能包含内存中的敏感内容，受严格合规要求的环境应使用加密磁盘或按安全规范处理。

```bash
set -Eeuo pipefail
swapon --show
sudo test ! -e /swapfile || {
  echo '/swapfile 已存在；先核对现状，不要覆盖。' >&2
  exit 1
}
sudo fallocate -l 4G /swapfile
sudo chmod 0600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
grep -qE '^/swapfile[[:space:]]' /etc/fstab || \
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
swapon --show
free -h
```

如果 `fallocate` 不受文件系统支持，删除尚未启用的失败文件后可改用 `sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress`，然后从 `chmod` 继续。

## 4. 安装 Ubuntu 系统依赖

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl git xz-utils tar gzip \
  build-essential python3 sqlite3 openssl ufw \
  systemd systemd-sysv coreutils grep sed gawk util-linux \
  passwd procps libc-bin iproute2
sudo apt-get upgrade -y
sudo reboot
```

重连后再次执行第 3 节架构、时间和资源检查。

`better-sqlite3@12.0.0` 安装时会尝试预编译包，失败后执行 `node-gyp rebuild --release`。因此 ARM64 生产机必须保留 `build-essential` 和 `python3`，不能假设每个 Node/ARM64 组合始终有预编译包。项目依赖自带 SQLite 源码，不要求强制安装 `libsqlite3-dev`；系统 `sqlite3` 命令用于完整性检查和灾难恢复。

## 5. 检查 DNS 和出站网络

updater 固定允许 GitHub 相关下载域名，但 `npm ci` 还会按当前 lockfile 访问腾讯 npm 镜像和 SheetJS CDN。Node 首次安装访问 `nodejs.org`。

```bash
set -Eeuo pipefail
for host in \
  github.com \
  api.github.com \
  objects.githubusercontent.com \
  release-assets.githubusercontent.com \
  nodejs.org \
  mirrors.cloud.tencent.com \
  cdn.sheetjs.com
do
  echo "===== $host ====="
  getent ahosts "$host" | sed -n '1,3p'
  curl --connect-timeout 10 --max-time 20 -sS -o /dev/null \
    -w 'HTTPS status=%{http_code} remote=%{remote_ip}\n' "https://$host/"
done
```

根路径返回 `301`、`403` 或 `404` 不一定是失败；关键是 DNS、TLS 和 HTTPS 连接可建立。部署网络至少应允许：

- Ubuntu apt 官方或企业镜像；
- `nodejs.org`：首次下载固定 Node.js；
- `github.com`、`api.github.com`：clone、版本检查和 Release API；
- `objects.githubusercontent.com`、`release-assets.githubusercontent.com`：Release 资产；
- `mirrors.cloud.tencent.com`：当前 lockfile 中的部分 npm tarball；
- `cdn.sheetjs.com`：当前 SheetJS tarball；
- GitHub Release：`better-sqlite3` 预编译包可能使用，失败时由本机源码编译回退。

百度 OCR endpoint 是业务额外出站，不属于 updater 下载 allowlist。启用 OCR 时还要按实际 `BAIDU_OCR_ENDPOINT` 和百度 token endpoint 配置网络。

不要用关闭 TLS 校验、设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或全局不受控代理来绕过证书问题。企业 TLS 代理应把受信任 CA 正确安装到系统信任库，并经过安全审批。

## 6. 安装固定 Node.js 22.21.1 ARM64

项目 `.nvmrc` 固定 `22.21.1`，`engines.node` 最低为 `22.12.0`。在线 updater 不允许使用服务账号 HOME 下的 NVM，因为 Node 路径及其祖先必须 root-owned 且不可由 group/other 写。

[Node.js v22.21.1 官方归档](https://nodejs.org/en/download/archive/v22.21.1)列出了 Linux ARM64 文件 `node-v22.21.1-linux-arm64.tar.xz` 和 npm `10.9.4`。按以下步骤安装到 root-owned `/opt`：

```bash
set -Eeuo pipefail
NODE_VERSION=22.21.1
NODE_DIST="node-v${NODE_VERSION}-linux-arm64"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.xz" \
  -o "$WORK_DIR/${NODE_DIST}.tar.xz"
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
  -o "$WORK_DIR/SHASUMS256.txt"

(
  cd "$WORK_DIR"
  grep "  ${NODE_DIST}.tar.xz$" SHASUMS256.txt > SHASUMS256.arm64
  test "$(wc -l < SHASUMS256.arm64)" -eq 1
  sha256sum --check SHASUMS256.arm64
)

sudo test ! -e "/opt/${NODE_DIST}" || {
  echo "停止：/opt/${NODE_DIST} 已存在，请先核对，禁止覆盖。" >&2
  exit 1
}
sudo tar -xJf "$WORK_DIR/${NODE_DIST}.tar.xz" -C /opt
sudo chown -R root:root "/opt/${NODE_DIST}"
sudo chmod -R go-w "/opt/${NODE_DIST}"

sudo ln -sfn "/opt/${NODE_DIST}/bin/node" /usr/local/bin/node
sudo ln -sfn "/opt/${NODE_DIST}/bin/npm" /usr/local/bin/npm
sudo ln -sfn "/opt/${NODE_DIST}/bin/npx" /usr/local/bin/npx
sudo chown -h root:root \
  /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx

/usr/local/bin/node --version
/usr/local/bin/npm --version
/usr/local/bin/npx --version
```

必须输出 Node `v22.21.1` 和 npm `10.9.4`。不要另行 `apt install nodejs npm`，也不要把 `/usr/bin/npm` 与另一个目录的 Node 混用。npm 的 shebang 使用 `env node`，所以 Node 和 npm 必须位于同一 root-controlled bin 体系，并在 builder PATH 中同时可见。

### 6.1 Node/npm 架构与权限验收

```bash
set -Eeuo pipefail
[ "$(/usr/local/bin/node -p 'process.platform')" = "linux" ]
[ "$(/usr/local/bin/node -p 'process.arch')" = "arm64" ]
[ "$(/usr/local/bin/node -p 'process.version')" = "v22.21.1" ]

printf 'node real path: '
readlink -f /usr/local/bin/node
printf 'npm real path: '
readlink -f /usr/local/bin/npm

namei -l /usr/local/bin/node
namei -l /usr/local/bin/npm
namei -l "$(readlink -f /usr/local/bin/node)"
namei -l "$(readlink -f /usr/local/bin/npm)"
stat -c '%U:%G %a %n' \
  /opt \
  /opt/node-v22.21.1-linux-arm64 \
  /opt/node-v22.21.1-linux-arm64/bin/node

PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/npm --version
PATH=/usr/local/bin:/usr/bin:/bin /usr/bin/env node \
  -p 'process.platform + " " + process.arch + " " + process.version'
```

验收标准：

- 最后一条输出 `linux arm64 v22.21.1`；
- `/opt`、Node 目录、真实 Node/npm 文件及全部祖先均不可由普通用户改写；
- `/usr/local/bin/node` 和 `/usr/local/bin/npm` 都指向同一 `/opt/node-v22.21.1-linux-arm64`；
- 不允许链接到 `/home/.../.nvm`、`/var/lib/lenovo-store-service/.nvm` 或普通用户可写目录。

`install-updater.sh` 会严格检查 Node 及其祖先；对 npm 的安装时检查较少，因此本节对 npm 的 `readlink`、`namei` 和同一 PATH 验收不能省略。

## 7. 创建固定服务账号

```bash
set -Eeuo pipefail
if getent passwd lenovo-store >/dev/null; then
  echo 'lenovo-store 已存在，请人工核对 UID、HOME、Shell 和组，禁止覆盖。' >&2
  getent passwd lenovo-store
  getent group lenovo-store || true
  exit 1
fi
if getent passwd lenovo-store-builder >/dev/null || \
   getent group lenovo-store-builder >/dev/null; then
  echo '停止：lenovo-store-builder 必须由 updater 安装器创建。' >&2
  exit 1
fi

sudo useradd \
  --system \
  --user-group \
  --create-home \
  --home-dir /var/lib/lenovo-store-service \
  --shell /usr/sbin/nologin \
  lenovo-store

getent passwd lenovo-store
getent group lenovo-store
sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/node -p 'process.platform + " " + process.arch'
```

确认 HOME 可写：

```bash
sudo -u lenovo-store test -w /var/lib/lenovo-store-service
sudo stat -c '%U:%G %a %n' /var/lib/lenovo-store-service
```

## 8. 先配置网络边界，再开放 Portal

### 8.1 UFW 防锁死步骤

在启用 UFW 前，保留当前 SSH 会话并打开第二个 SSH 会话。先读取实际端口：

```bash
sudo sshd -T | awk '$1 == "port" { print $2 }'
sudo ufw status verbose
```

将下面三个值替换为真实值，再执行。示例网段不能直接当作门店真实配置：

```bash
ADMIN_CIDR='192.168.10.0/24'
STORE_CIDR='192.168.10.0/24'
SSH_PORT='22'

printf 'ADMIN_CIDR=%s\nSTORE_CIDR=%s\nSSH_PORT=%s\n' \
  "$ADMIN_CIDR" "$STORE_CIDR" "$SSH_PORT"

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from "$ADMIN_CIDR" to any port "$SSH_PORT" proto tcp
sudo ufw allow from "$STORE_CIDR" to any port 8900 proto tcp
sudo ufw enable
sudo ufw status numbered
```

立即用第二个会话重新测试 SSH。失败时不要关闭仍可用的原会话，应从控制台修正规则。

### 8.2 两种监听拓扑只能选一种

**A. 门店可信网段直连 `8900`**

- 环境文件使用 `HOST=0.0.0.0`；
- UFW 只允许门店可信 CIDR 到 `8900/tcp`；
- 禁止 `sudo ufw allow 8900/tcp` 这种全网开放规则；
- 禁止公网端口映射到 `8900`。

**B. 本机 Nginx/反向代理**

- 环境文件使用 `HOST=127.0.0.1`；
- 不开放 `8900/tcp`；
- 只允许可信网段访问代理的 `80/443`；
- 代理保留原始 `Host`，设置正确的 `X-Forwarded-Proto`，并原样转发 `/`、`/assets/`、`/modules/`、`/api/`；
- 在线更新要求浏览器请求具有非空同源 `Origin`，不要跨域代理 API。

没有 `LENOVO_STORE_MAINTENANCE_TOKEN` 时，任何能直达服务端口并构造请求的客户端都可能下载备份、按模块恢复数据，或在服务端已检测到新版本时提交签名更新。固定维护请求头和同源检查不是用户登录系统；UFW/VLAN/ACL 是必需边界。

## 9. 克隆、锁定版本并在 ARM64 构建

### 9.1 拉取 bootstrap checkout

```bash
set -Eeuo pipefail
sudo test ! -e /opt/lenovo-store-operations || {
  echo '停止：/opt/lenovo-store-operations 已存在，请先核对。' >&2
  exit 1
}
sudo install -d -m 0750 -o lenovo-store -g lenovo-store \
  /opt/lenovo-store-operations

sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  git clone --branch main --single-branch \
  https://github.com/zifeng-chen/lenovo-store-operations.git \
  /opt/lenovo-store-operations
```

安装器要求当前 checkout 是普通目录、工作区 clean、分支有 upstream，且本地 HEAD 等于 upstream。它不会替你执行 `git fetch`，所以显式检查：

```bash
set -Eeuo pipefail
sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c '
    set -Eeuo pipefail
    cd /opt/lenovo-store-operations
    test ! -L "$PWD"
    git fetch --prune origin
    test "$(git branch --show-current)" = "main"
    test "$(git rev-parse HEAD)" = "$(git rev-parse @{upstream})"
    test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
    test -z "$(git status --porcelain --untracked-files=all)"
    printf "HEAD=%s\n" "$(git rev-parse HEAD)"
    printf "version=%s\n" "$(node -p "require(\"./package.json\").version")"
  '
```

当前部署应显示 `version=0.5.0`。如果远端 `main` 已发布更高版本，应按更高版本对应文档部署，不要强行把 package 改回 `0.5.0`。

### 9.2 安装锁定依赖并构建

```bash
sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  npm_config_cache=/var/lib/lenovo-store-service/.npm \
  bash -c '
    set -Eeuo pipefail
    cd /opt/lenovo-store-operations
    npm ci --include=dev
    npm run build
    npm run check
  '
```

不要使用 `sudo npm ci`，否则 `node_modules`、缓存或构建产物会变成 root 所有。生产环境不要运行 `npm run dev`。

### 9.3 验证 ARM64 原生模块

```bash
sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c '
    set -Eeuo pipefail
    cd /opt/lenovo-store-operations
    node -e "const Database=require(\"better-sqlite3\"); const db=new Database(\":memory:\"); console.log(db.prepare(\"select sqlite_version() as version\").get()); db.close();"
    node -p "process.platform + \" \" + process.arch + \" \" + process.version"
  '
```

必须成功加载 `better-sqlite3` 并输出 `linux arm64 v22.21.1`。若出现 `invalid ELF header`、`Exec format error` 或 `wrong ELF class`，说明混入了 x64/32 位产物；不要复制其他机器的 `node_modules`，应删除本机 bootstrap checkout 中的 `node_modules` 后在 ARM64 机器重新执行 `npm ci --include=dev`。

## 10. 数据来源三选一，禁止混用

先选 A、B、C 中的一种。不要先启动新服务创建空库，再把旧库零散覆盖进去；不要同时执行仓库 `data/` 迁移和三个旧项目迁移。

### 10.A 全新服务器，无旧数据

```bash
sudo install -d -m 0750 -o lenovo-store -g lenovo-store \
  /var/lib/lenovo-store-operations
sudo install -d -m 0700 -o lenovo-store -g lenovo-store \
  /var/backups/lenovo-store-operations
sudo test ! -L /var/lib/lenovo-store-operations
sudo test ! -L /var/backups/lenovo-store-operations
```

首次启动会创建四套数据库。员工工牌模块无服务端数据库；全新部署的价格展牌库初始为空。

### 10.B 迁移现有 checkout 内的完整 `data/`

只在旧服务器确实把生产数据保存在 `/opt/lenovo-store-operations/data` 时使用。复制前必须停止所有旧 Node/PM2/systemd/容器写入，并先把整个旧 `data/` 复制到另一块受控存储。

目标目录必须不存在：

```bash
set -Eeuo pipefail
# 把旧 checkout 的完整 data 预先复制到此受控导入目录。
SOURCE=/srv/lenovo-store-import/data
TARGET=/var/lib/lenovo-store-operations
STAGING=/var/lib/lenovo-store-operations.staging

sudo test -d "$SOURCE"
sudo test ! -L "$SOURCE"
sudo test ! -e "$TARGET"
sudo test ! -e "$STAGING"
sudo test -d /var/lib

SOURCE_LINK=$(sudo find "$SOURCE" -type l -print -quit)
[ -z "$SOURCE_LINK" ] || {
  echo "停止：旧 data 含符号链接：$SOURCE_LINK" >&2
  exit 1
}
SOURCE_SPECIAL=$(sudo find "$SOURCE" ! -type d ! -type f -print -quit)
[ -z "$SOURCE_SPECIAL" ] || {
  echo "停止：旧 data 含非普通文件：$SOURCE_SPECIAL" >&2
  exit 1
}

sudo install -d -m 0700 -o lenovo-store -g lenovo-store \
  /var/backups/lenovo-store-operations
sudo cp -a "$SOURCE" "$STAGING"

STAGING_LINK=$(sudo find "$STAGING" -type l -print -quit)
[ -z "$STAGING_LINK" ] || {
  echo "停止：staging 含符号链接：$STAGING_LINK" >&2
  exit 1
}
STAGING_SPECIAL=$(sudo find "$STAGING" ! -type d ! -type f -print -quit)
[ -z "$STAGING_SPECIAL" ] || {
  echo "停止：staging 含非普通文件：$STAGING_SPECIAL" >&2
  exit 1
}

sudo test -f "$STAGING/computer-labels/database.sqlite"
sudo test -f "$STAGING/price-labels/database.sqlite"
sudo test -f "$STAGING/receipt-assistant/database.sqlite"
if sudo test -f "$STAGING/price-placards/database.sqlite"; then
  echo '来源包含 0.5.0 价格展牌库，将完整迁移。'
else
  echo '旧 checkout 不含价格展牌库；0.5.0 首次启动将创建空库。'
fi
sudo test -f "$STAGING/secrets/receipt-ocr.key"

sudo chown -R lenovo-store:lenovo-store "$STAGING"
sudo find "$STAGING" -type d -exec chmod 0700 {} +
sudo find "$STAGING" -type f -exec chmod 0600 {} +

DATABASES=(
  "$STAGING/computer-labels/database.sqlite"
  "$STAGING/price-labels/database.sqlite"
  "$STAGING/receipt-assistant/database.sqlite"
)
if sudo test -f "$STAGING/price-placards/database.sqlite"; then
  DATABASES+=("$STAGING/price-placards/database.sqlite")
fi
for db in "${DATABASES[@]}"
do
  sudo -u lenovo-store sqlite3 "$db" 'PRAGMA integrity_check;' | grep -qx 'ok'
done

sudo mv "$STAGING" "$TARGET"
sudo test ! -L "$TARGET"
```

不要删除旧 `data/` 和迁移前独立副本，直到新服务业务验收和一次恢复演练都完成。

### 10.C 从三个旧项目执行一次性迁移

先把三个源数据库和 OCR 密钥复制到部署机受控只读目录，例如 `/srv/lenovo-legacy/`，确保 `lenovo-store` 可读取。目标 `/var/lib/lenovo-store-operations` 必须不存在。

```bash
sudo test ! -e /var/lib/lenovo-store-operations
sudo install -d -m 0700 -o lenovo-store -g lenovo-store \
  /var/backups/lenovo-store-operations
sudo ls -l \
  /srv/lenovo-legacy/computer.sqlite \
  /srv/lenovo-legacy/price.db \
  /srv/lenovo-legacy/receipt.sqlite \
  /srv/lenovo-legacy/ocr-config.key

sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations \
  LEGACY_COMPUTER_DB=/srv/lenovo-legacy/computer.sqlite \
  LEGACY_PRICE_DB=/srv/lenovo-legacy/price.db \
  LEGACY_RECEIPT_DB=/srv/lenovo-legacy/receipt.sqlite \
  LEGACY_RECEIPT_OCR_KEY=/srv/lenovo-legacy/ocr-config.key \
  bash -c '
    set -Eeuo pipefail
    umask 0077
    exec /usr/local/bin/npm \
      --prefix /opt/lenovo-store-operations \
      run migrate:data
  '
```

脚本会拒绝覆盖已有目标，使用 SQLite backup API、比对记录数并执行完整性检查。成功后必须拒绝意外链接/特殊文件并统一收紧 owner/mode：

```bash
set -Eeuo pipefail
TARGET=/var/lib/lenovo-store-operations
TARGET_LINK=$(sudo find "$TARGET" -type l -print -quit)
[ -z "$TARGET_LINK" ] || {
  echo "停止：迁移目标含符号链接：$TARGET_LINK" >&2
  exit 1
}
TARGET_SPECIAL=$(sudo find "$TARGET" ! -type d ! -type f -print -quit)
[ -z "$TARGET_SPECIAL" ] || {
  echo "停止：迁移目标含非普通文件：$TARGET_SPECIAL" >&2
  exit 1
}

sudo chown -R lenovo-store:lenovo-store "$TARGET"
sudo find "$TARGET" -type d -exec chmod 0700 {} +
sudo find "$TARGET" -type f -exec chmod 0600 {} +
sudo find "$TARGET" -maxdepth 3 \
  -printf '%M %u:%g %p\n'
for db in \
  "$TARGET/computer-labels/database.sqlite" \
  "$TARGET/price-labels/database.sqlite" \
  "$TARGET/receipt-assistant/database.sqlite"
do
  sudo -u lenovo-store sqlite3 "$db" 'PRAGMA integrity_check;' | grep -qx 'ok'
done
```

旧项目源文件和迁移后数据都要先备份；业务验收完成前不要删除源文件。这里的“三个旧项目”与脚本契约保持不变：历史来源只有仓库货品、周边价签和付款凭证，不存在 price-placards 第四旧源。完成本节时价格展牌库尚不存在；第一次启动 `0.5.0` 服务会创建空的 `$LENOVO_STORE_DATA_DIR/price-placards/database.sqlite`。这不是数据丢失，也不能凭空迁移不存在的旧展牌数据。首次启动后应对第四库执行完整性检查，并确认价格展牌记录、版本和图片数量均为 0。

## 11. 创建精确生产环境文件

安装脚本会按字面匹配若干行，因此以下五行不能加引号、前导空格或改名：

```bash
sudo tee /etc/lenovo-store-operations.env >/dev/null <<'EOF'
NODE_ENV=production
HOST=0.0.0.0
PORT=8900
LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations
LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations
EOF
sudo chown root:root /etc/lenovo-store-operations.env
sudo chmod 0600 /etc/lenovo-store-operations.env
sudo grep -n . /etc/lenovo-store-operations.env
```

如果使用本机 Nginx，把 `HOST=0.0.0.0` 改成精确的 `HOST=127.0.0.1`，同时删除 UFW 的 `8900` 入站规则。

可选增强项：

```ini
LENOVO_STORE_GITHUB_TOKEN=<只读 GitHub token，仅用于服务端版本检查>
LENOVO_STORE_MAINTENANCE_TOKEN=<至少24字符的随机维护令牌>
```

`0.5.1` 起，如果标准 root updater 配置、程序和 request/claimed/state 目录已经完整安全安装，而环境文件遗漏 `LENOVO_STORE_UPDATE_ENABLED`，服务会自动识别并启用在线安装入口。显式设置 `LENOVO_STORE_UPDATE_ENABLED=false` 始终禁用；未安装 updater 时不会自动启用。

生成维护令牌的示例：

```bash
openssl rand -base64 32
```

把结果作为单行写入环境文件，不要把真实 token 粘贴到 Git、聊天、工单或命令历史。配置维护令牌后，备份恢复和在线更新复用该令牌；root updater 下载公开 Release 时不读取 GitHub token。

## 12. 安装 bootstrap 主服务和备份服务

在线 updater 安装器要求 bootstrap 主服务和备份 service 已存在且可工作。

### 12.1 主服务 unit

```bash
sudo tee /etc/systemd/system/lenovo-store-operations.service >/dev/null <<'EOF'
[Unit]
Description=Lenovo Store Operations bootstrap
After=network.target

[Service]
Type=simple
User=lenovo-store
Group=lenovo-store
WorkingDirectory=/opt/lenovo-store-operations
EnvironmentFile=/etc/lenovo-store-operations.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/npm start
Restart=on-failure
RestartSec=5
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/lenovo-store-operations /var/backups/lenovo-store-operations

[Install]
WantedBy=multi-user.target
EOF
```

### 12.2 备份 service

```bash
sudo tee /etc/systemd/system/lenovo-store-backup.service >/dev/null <<'EOF'
[Unit]
Description=Backup Lenovo Store Operations data

[Service]
Type=oneshot
User=lenovo-store
Group=lenovo-store
WorkingDirectory=/opt/lenovo-store-operations
EnvironmentFile=/etc/lenovo-store-operations.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/npm run backup:data
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/lenovo-store-operations /var/backups/lenovo-store-operations
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now lenovo-store-operations.service
sudo systemctl status lenovo-store-operations.service --no-pager
```

如果启动失败，先看日志，不要反复重启：

```bash
sudo journalctl -u lenovo-store-operations.service -n 200 --no-pager
```

## 13. 首次健康和业务数据验收

等待本机 health：

```bash
set -Eeuo pipefail
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8900/api/system/health \
    -o /tmp/lenovo-store-health.json; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:8900/api/system/health \
  | python3 -m json.tool
sudo journalctl -u lenovo-store-operations.service -n 100 --no-pager
```

必须人工核对：

1. health 返回成功；
2. version 是预期版本，当前为 `0.5.0`；
3. commit 是完整 40 位提交；
4. 数据目录是 `/var/lib/lenovo-store-operations`，不是 checkout 内 `data/`；
5. Portal 和五套业务 SPA 都可打开，共六套前端构建产物；
6. 四套 SQLite 均健康；
7. 迁移场景下，三个旧业务板块的记录总数、最新记录和抽样内容与旧系统一致；完整迁移已运行 0.5.0 的 checkout 时还要核对价格展牌、版本和图片，三旧项目迁移时则应确认新建价格展牌库为空；
8. 付款凭证页面可读取现有 OCR 配置，密钥没有丢失；
9. 员工工牌是纯浏览器模块，没有服务端数据库；
10. 从门店客户端访问正常，从不可信网段访问被阻止。

手动执行第一次一致性备份：

```bash
sudo systemctl start lenovo-store-backup.service
sudo systemctl show lenovo-store-backup.service \
  -p Result -p ExecMainStatus --no-pager
sudo journalctl -u lenovo-store-backup.service -n 100 --no-pager
sudo find /var/backups/lenovo-store-operations \
  -mindepth 1 -maxdepth 2 -printf '%TY-%Tm-%Td %TH:%TM:%TS %M %u:%g %p\n' \
  | sort
```

## 14. 写入固定 Ed25519 发布公钥

公钥不是秘密，但它是 release 信任根。必须核对固定 DER SHA-256 指纹；不匹配时立即停止，不要“临时换一个公钥”。

```bash
sudo tee /root/lenovo-store-release-signing.pub >/dev/null <<'EOF'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEATLPU1+XgnNOD8W4XQ8Nmo52WVMf/2OpEdfyfHdF125w=
-----END PUBLIC KEY-----
EOF
sudo chown root:root /root/lenovo-store-release-signing.pub
sudo chmod 0600 /root/lenovo-store-release-signing.pub

EXPECTED_FINGERPRINT='79e8d0b7c054d44f812c8cb36403b104abdca189393b491ec7b1732b03b9cadf'
ACTUAL_FINGERPRINT=$(
  sudo openssl pkey \
    -pubin \
    -in /root/lenovo-store-release-signing.pub \
    -outform DER 2>/dev/null \
  | sha256sum \
  | awk '{print $1}'
)
printf 'expected=%s\nactual=%s\n' \
  "$EXPECTED_FINGERPRINT" "$ACTUAL_FINGERPRINT"
[ "$ACTUAL_FINGERPRINT" = "$EXPECTED_FINGERPRINT" ] || {
  echo '停止：发布公钥指纹不匹配。' >&2
  exit 1
}
```

固定指纹：

```text
79e8d0b7c054d44f812c8cb36403b104abdca189393b491ec7b1732b03b9cadf
```

## 15. 安装签名在线 updater

### 15.1 安装前强制检查

```bash
set -Eeuo pipefail

# builder 必须尚不存在
if getent passwd lenovo-store-builder >/dev/null || \
   getent group lenovo-store-builder >/dev/null; then
  echo '停止：lenovo-store-builder 已存在。' >&2
  exit 1
fi

# bootstrap checkout 必须是普通 Git 目录
sudo test -d /opt/lenovo-store-operations
sudo test ! -L /opt/lenovo-store-operations
sudo test -d /opt/lenovo-store-operations/.git

# 目标布局必须尚未存在
sudo test ! -e /opt/lenovo-store-operations/releases
sudo test ! -e /opt/lenovo-store-operations/current
sudo test ! -e /opt/lenovo-store-operations/previous
sudo test ! -e /etc/lenovo-store-updater.json
sudo test ! -e /usr/local/lib/lenovo-store-updater

# 服务和备份必须工作
sudo systemctl is-active --quiet lenovo-store-operations.service
sudo systemctl start lenovo-store-backup.service
[ "$(sudo systemctl show lenovo-store-backup.service -p Result --value)" = "success" ] || {
  echo '停止：备份服务失败。' >&2
  exit 1
}

# Git 必须已 fetch、clean、已推送且等于 upstream
sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c '
    set -Eeuo pipefail
    cd /opt/lenovo-store-operations
    git fetch --prune origin
    test -z "$(git status --porcelain --untracked-files=all)"
    test -n "$(git branch --show-current)"
    test "$(git rev-parse HEAD)" = "$(git rev-parse @{upstream})"
    test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
  '

# Node/npm 再验收
/usr/local/bin/node -p 'process.platform + " " + process.arch + " " + process.version'
readlink -f /usr/local/bin/node
readlink -f /usr/local/bin/npm
namei -l /usr/local/bin/node
namei -l /usr/local/bin/npm

df -h /opt /var/lib /var/backups
```

若 checkout 有任何本地修改，先停止安装并查明来源；不要用 `git reset --hard` 或 `git clean -fdx` 处理生产机数据。

### 15.2 执行首次不可变布局迁移

只能从 `/opt/lenovo-store-operations/ops/install-updater.sh` 所在 checkout 执行：

```bash
(
  set -Eeuo pipefail
  cd /opt/lenovo-store-operations
  sudo ./ops/install-updater.sh \
    --service-user lenovo-store \
    --public-key /root/lenovo-store-release-signing.pub \
    --public-key-sha256 79e8d0b7c054d44f812c8cb36403b104abdca189393b491ec7b1732b03b9cadf \
    --node-path /usr/local/bin/node \
    --npm-path /usr/local/bin/npm \
    --confirm-migration
)
```

安装器会：

1. 再次验证账号、路径、Git、Node、环境文件、服务、health 和备份；
2. 创建独立不可登录 `lenovo-store-builder`；
3. 把 updater、配置、systemd service/path 和 tmpfiles 资源安装为 root-owned；
4. 从已提交、已推送的 HEAD 构建首个候选 release；
5. 使用独立 builder 执行锁定依赖安装和检查；
6. 把 release 封存到 `releases/<version>-<40位commit>`；
7. 建立 `current` 和 `previous`；
8. 修改主服务 WorkingDirectory 指向 `current`；
9. 在环境文件追加 updater 的三个 IPC/状态路径；
10. 连续健康检查后启用 `lenovo-store-updater.path`；
11. 将原 bootstrap checkout 以 root-only 备份形式保留。

### 15.3 迁移后逐项验收

```bash
set -Eeuo pipefail

sudo systemctl daemon-reload
sudo systemctl is-enabled lenovo-store-operations.service
sudo systemctl is-active lenovo-store-operations.service
sudo systemctl is-enabled lenovo-store-updater.path
sudo systemctl is-active lenovo-store-updater.path
sudo systemctl status \
  lenovo-store-operations.service \
  lenovo-store-updater.path \
  --no-pager

sudo readlink -v /opt/lenovo-store-operations/current
sudo readlink -v /opt/lenovo-store-operations/previous
sudo readlink -f /opt/lenovo-store-operations/current
sudo readlink -f /opt/lenovo-store-operations/previous
sudo find /opt/lenovo-store-operations/releases \
  -mindepth 1 -maxdepth 1 -type d -printf '%M %u:%g %f\n'

sudo stat -c '%U:%G %a %n' \
  /etc/lenovo-store-operations.env \
  /etc/lenovo-store-updater.json \
  /etc/lenovo-store-release-signing.pub \
  /usr/local/lib/lenovo-store-updater/updater.mjs \
  /var/lib/lenovo-store-updater \
  /run/lenovo-store-updater \
  /run/lenovo-store-updater/claimed

sudo grep -Fqx 'LENOVO_STORE_UPDATE_ENABLED=true' \
  /etc/lenovo-store-operations.env
sudo grep -Fqx \
  'LENOVO_STORE_UPDATE_REQUEST_PATH=/run/lenovo-store-updater/request.json' \
  /etc/lenovo-store-operations.env
sudo grep -Fqx \
  'LENOVO_STORE_UPDATE_PROCESSING_PATH=/run/lenovo-store-updater/claimed/processing.json' \
  /etc/lenovo-store-operations.env
sudo grep -Fqx \
  'LENOVO_STORE_UPDATE_STATE_PATH=/var/lib/lenovo-store-updater/status.json' \
  /etc/lenovo-store-operations.env

curl -fsS http://127.0.0.1:8900/api/system/health \
  | python3 -m json.tool
sudo journalctl -u lenovo-store-operations.service -n 100 --no-pager
sudo journalctl -u lenovo-store-updater.service -n 100 --no-pager
```

检查 `/etc/lenovo-store-updater.json` 时不要修改 UID/GID、路径或仓库：

```bash
sudo python3 -m json.tool /etc/lenovo-store-updater.json
getent passwd lenovo-store-builder
getent group lenovo-store-builder
```

确认主服务仍使用 `/var/lib/lenovo-store-operations`，四个持久化板块记录没有变化。迁移只切换代码布局，不应迁移或覆盖业务数据库。

## 16. 定时备份、手动备份和异地副本

### 16.1 每日备份 timer

项目提供 backup service；以下 timer 每天 `03:30`（`Asia/Shanghai`）运行，并在错过计划后补跑：

```bash
sudo tee /etc/systemd/system/lenovo-store-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Daily Lenovo Store Operations backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
RandomizedDelaySec=10m
Unit=lenovo-store-backup.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now lenovo-store-backup.timer
sudo systemctl status lenovo-store-backup.timer --no-pager
systemctl list-timers lenovo-store-backup.timer --all
```

### 16.2 随时手动备份

重大导入、恢复、升级和人工回退前都执行：

```bash
sudo systemctl start lenovo-store-backup.service
sudo systemctl show lenovo-store-backup.service \
  -p Result -p ExecMainStatus --no-pager
sudo journalctl -u lenovo-store-backup.service -n 100 --no-pager
sudo find /var/backups/lenovo-store-operations \
  -mindepth 1 -maxdepth 2 -type f \
  -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' \
  | sort | tail -50
```

备份脚本通过 SQLite backup API 生成四套一致性快照，执行 `PRAGMA integrity_check`，记录大小、表数量和 SHA-256，并保护 OCR 密钥。不要把“service 退出 0”当作唯一验收；还要检查最新目录和 manifest，确认其中包含 `price-placards/database.sqlite`。

### 16.3 保留与异地备份

建议至少保留：

- 最近 7 天每日备份；
- 最近 4 周每周备份；
- 最近 12 个月每月备份；
- 每次上线、批量导入和恢复前的人工备份；
- 至少一份不与服务器同盘、同机、同机柜的加密副本。

先只列出 30 天前目录，人工核对后再清理：

```bash
sudo find /var/backups/lenovo-store-operations \
  -mindepth 1 -maxdepth 1 -type d -mtime +30 \
  -printf '%TY-%Tm-%Td %TH:%TM:%TS %p\n' \
  | sort
```

不要用未经审核的 `find ... -delete`。删除前确认：目录不是最新备份、不是唯一恢复点、已完成异地复制且异地副本可读。备份可能包含可解密 OCR 凭据的密钥，禁止上传到公共网盘、群聊或普通工单附件。

每季度至少在隔离主机恢复一次备份，并核对记录数量、最新业务数据和 OCR 解密；没有恢复演练的备份不能视为可靠。

## 17. Portal 签名在线更新标准流程

### 17.1 更新前

1. 阅读目标 GitHub Release 说明；
2. 确认是严格 `vX.Y.Z` 稳定 Release，不是 draft/prerelease；
3. 确认磁盘、时间、DNS 和出站网络正常；
4. `systemctl status lenovo-store-updater.path` 必须 active；
5. 执行一次手动备份并检查最新 manifest；
6. 保存当前 health、current 和 previous：

```bash
curl -fsS http://127.0.0.1:8900/api/system/health \
  | tee /tmp/lenovo-store-health.before.json \
  | python3 -m json.tool
sudo readlink -f /opt/lenovo-store-operations/current
sudo readlink -f /opt/lenovo-store-operations/previous
sudo systemctl start lenovo-store-backup.service
sudo systemctl show lenovo-store-backup.service \
  -p Result -p ExecMainStatus --no-pager
```

### 17.2 浏览器操作

1. 从门店可信网络打开 `http://<服务器IP>:8900/#/system`，或反向代理 HTTPS 地址；
2. 点击检查 GitHub 最新版本；
3. 服务端必须成功检测到高于当前版本、未过期、无错误的 latest Release；
4. 核对目标 tag、版本和 Release 链接；
5. 点击“安装最新版本”；
6. 按提示完整输入“安装”；
7. 配置维护令牌时输入同一个维护令牌；未配置时不会提示 token；
8. 不要重复点击或手工创建 request 文件；
9. 等待页面显示排队、备份、下载、验签、构建、切换、重启、health 和完成；
10. 页面断开时不要立即手工回退，先查 updater 状态和 journal。

按钮只允许安装服务端刚检查到的 fresh latest tag。浏览器不能指定任意 URL、任意 tag、公钥或 Shell 命令。

### 17.3 更新后

```bash
curl -fsS http://127.0.0.1:8900/api/system/health \
  | tee /tmp/lenovo-store-health.after.json \
  | python3 -m json.tool
sudo readlink -f /opt/lenovo-store-operations/current
sudo readlink -f /opt/lenovo-store-operations/previous
sudo cat /var/lib/lenovo-store-updater/status.json \
  | python3 -m json.tool
sudo journalctl -u lenovo-store-updater.service -n 300 --no-pager
sudo journalctl -u lenovo-store-operations.service -n 200 --no-pager
```

必须核对目标 version、完整 commit、外部数据目录、六套前端构建产物（Portal + 5 个业务 SPA）、四套 SQLite，以及四个持久化业务板块的记录数量和最新记录。更新只切换代码；业务数据继续使用同一外部目录。

## 18. updater 安全与恢复机制

每次更新必须同时通过：

- 固定仓库 `zifeng-chen/lenovo-store-operations`；
- 固定 GitHub API/资产下载域名；
- 严格 tag、版本和完整 commit 一致性；
- 固定 Ed25519 公钥和指纹；
- `manifest.json.sig`、SHA-256、包内 `release-info.json`；
- updater contract `1`、`npm-ci-on-target`、可逆迁移声明；
- tar 路径、链接、特殊文件、重复项、文件数和解压体积限制；
- 独立 builder 安装和检查；
- 切换前外部一致性备份；
- 新服务连续 health 检查；
- `current/previous` 原子链接和 fsync 事务 journal。

事务可能处于 `claimed`、`preparing`、`prepared`、`switched`、`recovered`、`committed`。进程被杀或断电后，主服务启动门会调用 updater 的恢复模式，优先恢复保守一致的链接。`rollback-failed` 表示旧版本也未恢复健康，必须人工处理，不能继续提交更新。

## 19. 隔离主机故障演练

> 以下演练只在隔离 Ubuntu ARM64 主机、可丢弃 release 和生产数据副本上执行。不要用生产数据唯一副本，不要为了演练修改公开正式 Release。

### 19.1 公钥和篡改 manifest 拒绝

以下 URL 固定使用历史 `v0.4.0` Release，目的是复现当时已经验收的签名拒绝演练，不表示 ARM64 手册当前版本仍为 0.4.0，也不应机械替换为 0.5.0。下载该历史 manifest/signature，在本地验证后篡改副本；`.sig` 是带末尾换行的 Base64 文本，必须先严格解码为 64 字节 Ed25519 原始签名。原 manifest 应验证成功，篡改副本应失败：

```bash
set -Eeuo pipefail
DRILL_DIR=$(mktemp -d)
trap 'rm -rf "$DRILL_DIR"' EXIT
cd "$DRILL_DIR"
curl -fL \
  https://github.com/zifeng-chen/lenovo-store-operations/releases/download/v0.4.0/manifest.json \
  -o manifest.json
curl -fL \
  https://github.com/zifeng-chen/lenovo-store-operations/releases/download/v0.4.0/manifest.json.sig \
  -o manifest.json.sig
sudo cp /etc/lenovo-store-release-signing.pub ./release.pub
sudo chown "$(id -u):$(id -g)" ./release.pub

base64 --decode manifest.json.sig > manifest.json.sig.raw
test "$(wc -c < manifest.json.sig.raw)" -eq 64
openssl pkeyutl -verify -pubin -inkey release.pub \
  -rawin -in manifest.json -sigfile manifest.json.sig.raw

cp manifest.json manifest.tampered.json
printf '\n ' >> manifest.tampered.json
if openssl pkeyutl -verify -pubin -inkey release.pub \
  -rawin -in manifest.tampered.json -sigfile manifest.json.sig.raw; then
  echo '失败：篡改文件不应验签成功。' >&2
  exit 1
else
  echo '通过：篡改 manifest 被拒绝。'
fi
```

该演练只验证 Ed25519 拒绝篡改。完整 updater 拒绝测试应使用专门测试仓库/测试签名链，不能替换生产信任根。

### 19.2 候选 health 失败自动回滚

使用专门签名的测试 Release，使候选服务无法通过 health，但保留旧 release 正常：

1. 记录更新前 `current`、`previous`、health 和数据数量；
2. 提交测试更新；
3. 确认 updater 到达切换/health 阶段；
4. 确认最终状态是失败并已回滚，而不是 completed；
5. `current` 必须重新指向旧 release；
6. 主服务 health 和业务数据必须恢复；
7. 备份必须仍存在；
8. 检查失败候选和 journal 的清理状态。

观察命令：

```bash
watch -n 1 'sudo cat /var/lib/lenovo-store-updater/status.json 2>/dev/null || true'
sudo journalctl -fu lenovo-store-updater.service
```

`watch` 和 `journalctl -f` 是交互命令，应在独立终端运行，用 `Ctrl+C` 退出。

### 19.3 `prepared`/`switched` 阶段断电恢复

需要一个高于当前版本的有效签名测试 Release：

1. 在控制台和另一个终端持续查看 transaction/status；
2. transaction 到达计划阶段时强制终止 updater 或重启测试机；
3. 开机后不要手工改链接；
4. 让主服务 `ExecStartPre --recover-links-only` 和 updater journal 恢复；
5. 确认旧版本 health 恢复，request/processing/journal 最终处于一致状态；
6. 核对数据目录没有变化。

强制终止仅用于隔离演练：

```bash
sudo systemctl kill --kill-who=all --signal=SIGKILL \
  lenovo-store-updater.service
sudo reboot
```

### 19.4 `rollback-failed` 告警演练

在隔离机同时使候选和旧 release 无法通过 health，确认：

- updater 状态明确为 `rollback-failed`；
- systemd/journal 有可告警错误；
- 不会错误标记 completed；
- 运维流程会停止自动重试并转人工；
- 可通过已验证 release、外部备份和冷恢复重新建立服务。

不要在生产机故意破坏 `previous`。上线前至少完成签名拒绝、health 回滚、断电恢复和 `rollback-failed` 响应演练并留存记录。

## 20. 安全的代码人工回退

正常更新失败应由 updater 自动回滚。人工回退必须建立完整静默窗口：先停 updater path/service，在线备份后停止主服务，再检查 request、processing 和 transaction；这样 Web 服务不能在检查后重新发布请求。

```bash
set -Eeuo pipefail
sudo systemctl stop lenovo-store-updater.path
sudo systemctl stop lenovo-store-updater.service

if sudo systemctl is-active --quiet lenovo-store-updater.path; then
  echo '停止：updater path 仍 active。' >&2
  exit 1
fi
if sudo systemctl is-active --quiet lenovo-store-updater.service; then
  echo '停止：updater service 仍 active。' >&2
  exit 1
fi

# 主服务仍运行时生成一致性备份；失败时不得继续。
sudo systemctl start lenovo-store-backup.service
[ "$(sudo systemctl show lenovo-store-backup.service -p Result --value)" = "success" ]

# 先停止请求发布者，再进行最终状态检查。
sudo systemctl stop lenovo-store-operations.service
if sudo systemctl is-active --quiet lenovo-store-operations.service; then
  echo '停止：主服务仍 active。' >&2
  exit 1
fi

for path in \
  /run/lenovo-store-updater/request.json \
  /run/lenovo-store-updater/claimed/processing.json \
  /var/lib/lenovo-store-updater/transaction.json
do
  sudo test ! -e "$path" || {
    echo "停止：仍存在 updater 状态文件：$path" >&2
    exit 1
  }
done
```

若任一状态文件存在，保持主服务和 updater path 停止，保存 status/journal 并先处理未完成事务；不要删除状态文件后硬切链接。

核对并交换链接；此时主服务已经停止：

```bash
set -Eeuo pipefail
ROOT=/opt/lenovo-store-operations
CURRENT=$(sudo readlink -f "$ROOT/current")
PREVIOUS=$(sudo readlink -f "$ROOT/previous")

sudo test "$(dirname "$CURRENT")" = "$ROOT/releases"
sudo test "$(dirname "$PREVIOUS")" = "$ROOT/releases"
sudo test "$CURRENT" != "$PREVIOUS"
sudo test -f "$CURRENT/release-info.json"
sudo test -f "$PREVIOUS/release-info.json"

echo "current=$CURRENT"
echo "previous=$PREVIOUS"
sudo python3 -m json.tool "$CURRENT/release-info.json"
sudo python3 -m json.tool "$PREVIOUS/release-info.json"

sudo ln -s "releases/$(basename "$PREVIOUS")" "$ROOT/.current.manual"
sudo ln -s "releases/$(basename "$CURRENT")" "$ROOT/.previous.manual"
sudo mv -Tf "$ROOT/.previous.manual" "$ROOT/previous"
sudo mv -Tf "$ROOT/.current.manual" "$ROOT/current"

sudo systemctl start lenovo-store-operations.service
curl -fsS http://127.0.0.1:8900/api/system/health \
  | python3 -m json.tool
```

保持 `lenovo-store-updater.path` 停止，人工核对 health 的 version/完整 commit 与回退目标 `release-info.json` 一致，并检查六套前端构建产物（Portal + 5 个业务 SPA）、四套 SQLite、四个持久化业务板块记录和 OCR。若验收失败，不要连续交换链接，应使用控制台、可信 release 和第 21 节恢复。

业务验收成功后，先再次停止主服务并检查三类状态文件；确认没有人在验收期间提交更新请求后，先启动 path，再启动主服务。这一顺序消除“检查后、恢复 path 前”由 Web 服务创建请求的竞态：

```bash
set -Eeuo pipefail
sudo systemctl stop lenovo-store-operations.service
if sudo systemctl is-active --quiet lenovo-store-operations.service; then
  echo '停止：主服务仍 active。' >&2
  exit 1
fi
if sudo systemctl is-active --quiet lenovo-store-updater.service; then
  echo '停止：updater service 意外 active。' >&2
  exit 1
fi
for path in \
  /run/lenovo-store-updater/request.json \
  /run/lenovo-store-updater/claimed/processing.json \
  /var/lib/lenovo-store-updater/transaction.json
do
  sudo test ! -e "$path" || {
    echo "停止：验收期间出现 updater 状态文件：$path" >&2
    exit 1
  }
done

sudo systemctl start lenovo-store-updater.path
sudo systemctl is-active --quiet lenovo-store-updater.path
sudo systemctl start lenovo-store-operations.service
curl -fsS http://127.0.0.1:8900/api/system/health \
  | python3 -m json.tool
sudo journalctl -u lenovo-store-operations.service -n 100 --no-pager
```

人工代码回退不恢复数据库，当前 updater contract 也禁止自动安装声明不可逆数据迁移的 Release。

## 21. 故障恢复

### 21.1 服务无法启动

```bash
sudo systemctl status lenovo-store-operations.service --no-pager
sudo journalctl -u lenovo-store-operations.service -b -n 300 --no-pager
sudo systemctl cat lenovo-store-operations.service
sudo systemctl show lenovo-store-operations.service \
  -p User -p Group -p WorkingDirectory -p EnvironmentFiles
sudo readlink -f /opt/lenovo-store-operations/current
sudo -u lenovo-store test -r \
  /opt/lenovo-store-operations/current/package.json
sudo -u lenovo-store test -w /var/lib/lenovo-store-operations
```

常见原因：环境文件格式错误、数据目录权限错误、current 断链、Node/npm 路径变化、端口被占用或 updater transaction 尚在恢复。

### 21.2 页面突然没有历史数据

立即停止写入，不要在空页面继续新增数据：

```bash
sudo systemctl stop lenovo-store-operations.service
sudo systemctl show lenovo-store-operations.service \
  -p Environment -p EnvironmentFiles -p WorkingDirectory
sudo journalctl -u lenovo-store-operations.service -n 200 --no-pager
sudo find /opt /srv /var/lib -type f \
  \( -name 'database.sqlite' -o -name 'database.db' \) \
  -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' 2>/dev/null
```

数据“为空”通常是服务指向了另一套新数据库，不一定是旧库被删除。对当前目录和候选旧目录分别做冷副本，检查 SQLite 完整性、表数量、时间和记录数后，再按通用指南的 staging/rollback 流程恢复。不要在服务运行时覆盖 `.sqlite`，也不要只复制主文件而忽略 WAL。

### 21.3 updater 卡住或失败

```bash
sudo systemctl status \
  lenovo-store-updater.path \
  lenovo-store-updater.service \
  --no-pager
sudo journalctl -u lenovo-store-updater.service -b -n 500 --no-pager
sudo python3 -m json.tool \
  /var/lib/lenovo-store-updater/status.json 2>/dev/null || true
sudo python3 -m json.tool \
  /var/lib/lenovo-store-updater/transaction.json 2>/dev/null || true
sudo ls -la \
  /run/lenovo-store-updater \
  /run/lenovo-store-updater/claimed \
  /var/lib/lenovo-store-updater
```

不要手工编辑 status/transaction，不要重复创建 request，不要在 `prepared` 或 `switched` 时删除 staging。先保存日志和文件元数据，再让 systemd 恢复或按安全人工回退处理。

### 21.4 ARM64 原生模块错误

典型错误：`invalid ELF header`、`Exec format error`、`wrong ELF class`、找不到 `better_sqlite3.node`、`node-gyp` 编译失败。

检查：

```bash
/usr/local/bin/node -p 'process.platform + " " + process.arch + " " + process.version'
file /usr/local/bin/node
sudo -u lenovo-store env \
  HOME=/var/lib/lenovo-store-service \
  PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c '
    cd /opt/lenovo-store-operations/current
    npm config get cache
    node -e "console.log(require.resolve(\"better-sqlite3\")); require(\"better-sqlite3\"); console.log(\"better-sqlite3 OK\")"
  '
dpkg -l build-essential python3 | cat
```

bootstrap 阶段可删除本机 checkout 的 `node_modules` 并重新 `npm ci`；不可变 release 不应原地修补。正式 updater 候选失败时查看 builder 日志并修复下一版 Release 或网络/编译环境，不要把 x64 `node_modules` 复制到 ARM64。

### 21.5 磁盘不足

```bash
df -hT /opt /var/lib /var/backups
sudo du -xhd1 /opt/lenovo-store-operations 2>/dev/null | sort -h
sudo du -xhd1 /var/backups/lenovo-store-operations 2>/dev/null | sort -h
sudo readlink -f /opt/lenovo-store-operations/current
sudo readlink -f /opt/lenovo-store-operations/previous
```

只清理已确认不被 `current`/`previous` 引用、不是故障取证目标且已有对应备份的旧 release。不要删除 transaction 引用的目录，不要用 `git clean -fdx`，不要让备份目录填满系统盘。

### 21.6 内存不足或构建被 OOM kill

```bash
free -h
swapon --show
sudo journalctl -k -b | grep -Ei 'out of memory|oom|killed process' || true
sudo journalctl -u lenovo-store-updater.service -b -n 300 --no-pager
```

确认 swap 和磁盘空间，再重试新的、完整更新流程。不要在半构建 release 中手工继续 npm。

### 21.7 npm/Release 网络错误

```bash
getent ahosts api.github.com
getent ahosts release-assets.githubusercontent.com
getent ahosts mirrors.cloud.tencent.com
getent ahosts cdn.sheetjs.com
curl -I --connect-timeout 10 https://api.github.com/
curl -I --connect-timeout 10 https://nodejs.org/
```

同时检查企业代理、DNS、CA、GitHub 限流和系统时间。不得关闭 TLS 验证。GitHub 仓库或 Release 资产改为私有时，当前 root updater 会安全失败；不要把高权限 token 临时注入浏览器或 updater。

## 22. 冷恢复原则

整套数据灾难恢复应使用通用指南中的 staging/rollback 流程：

1. 停止 updater path/service，确认无 request、processing、transaction；
2. 停止主服务；
3. 保留当前数据目录为 rollback，不覆盖；
4. 把选定备份复制到新的 staging；
5. 对四套 SQLite（包括 `price-placards/database.sqlite`）执行完整性检查，核对 OCR 密钥；
6. 原子移动 staging 为正式数据目录；
7. 启动服务并检查 health；
8. 核对四个持久化业务板块记录，并抽查价格展牌版本和图片；
9. 失败时把新目录移到 failed，再恢复 rollback；
10. 验收后才恢复 updater path。

`.lsbackup` 页面恢复适合按单个模块恢复已检查的统一备份；当前 writer 固定写 v2 四库，reader 兼容 v1/v2。历史 v1 只含三库，inspect 会把价格展牌显示为“未包含”，不能恢复 price-placards，也不会清空现有价格展牌库。旧 `0.4.x` 服务不能读取 v2；需要导入 v2 时，必须先更新代码/服务，再上传检查。目录冷恢复适合整机灾难，已运行 0.5.0 后生成的备份和冷恢复必须包含第四库。两者不能用“直接覆盖运行中数据库”的方式替代。

## 23. 最终上线验收清单

### 平台

- [ ] `dpkg --print-architecture` 是 `arm64`；
- [ ] `uname -m` 是 `aarch64`；
- [ ] `node -p 'process.platform+" "+process.arch'` 是 `linux arm64`；
- [ ] Node 是 `v22.21.1`，npm 是 `10.9.4`；
- [ ] Node/npm 位于同一 root-owned `/opt/node-v22.21.1-linux-arm64`；
- [ ] `build-essential` 和 `python3` 已安装；
- [ ] 时间同步、时区、DNS、证书和出站网络正常；
- [ ] `/opt` 有足够构建空间，内存较小时有 swap。

### 账号与网络

- [ ] 主服务使用 `lenovo-store`，不是 root；
- [ ] `lenovo-store-builder` 由安装器创建且不可登录；
- [ ] SSH 管理网段先于 UFW enable 放行；
- [ ] `8900` 只允许门店可信 CIDR，或仅监听 `127.0.0.1`；
- [ ] 不存在公网端口映射；
- [ ] 无维护令牌模式已由 UFW/VLAN/ACL 限制；
- [ ] 维护令牌如已配置，至少 24 字符且未进入仓库/日志。

### 数据与服务

- [ ] 三种数据来源只执行了一种；
- [ ] 数据位于 `/var/lib/lenovo-store-operations`；
- [ ] 备份位于 `/var/backups/lenovo-store-operations`；
- [ ] 两个目录都不是符号链接且不与代码重叠；
- [ ] 四套 SQLite 完整性检查通过；
- [ ] OCR 密钥与付款凭证数据库成对保留；
- [ ] health、六套前端构建产物（Portal + 5 个业务 SPA）、五个业务模块和四套数据库均正常；
- [ ] 三个旧业务板块记录数量和最新记录已人工核对；若迁移的是已运行 0.5.0 的完整 data，还已核对价格展牌历史/图片；若执行三旧项目迁移，则已确认价格展牌新库为空；
- [ ] backup service 手动运行成功且已检查 manifest；
- [ ] daily timer 已启用；
- [ ] 已生成受控异地备份并做过恢复演练。

### 签名更新

- [ ] Ed25519 公钥指纹严格等于 `79e8d0b7c054d44f812c8cb36403b104abdca189393b491ec7b1732b03b9cadf`；
- [ ] `current`/`previous` 均直接指向 `releases`；
- [ ] updater service/path、tmpfiles 和状态目录权限正确；
- [ ] 环境文件包含三个 updater 路径和 enable 开关；
- [ ] Portal 能检查 Release；运行最新版本时不显示可安装按钮是正常现象；
- [ ] 签名拒绝、health 回滚、断电恢复和 `rollback-failed` 已在隔离机演练；
- [ ] 运维人员知道人工回退前必须先停 path/service 并检查三个状态文件；
- [ ] 生产机没有使用 NVM Node 作为 updater Node；
- [ ] 未在不可变 release 中手工执行 npm 修补。

## 24. 常用状态命令

```bash
# 主服务
sudo systemctl status lenovo-store-operations.service --no-pager
sudo journalctl -u lenovo-store-operations.service -n 200 --no-pager

# updater
sudo systemctl status lenovo-store-updater.path --no-pager
sudo systemctl status lenovo-store-updater.service --no-pager
sudo journalctl -u lenovo-store-updater.service -n 300 --no-pager

# 备份
sudo systemctl status lenovo-store-backup.timer --no-pager
sudo journalctl -u lenovo-store-backup.service -n 100 --no-pager
systemctl list-timers lenovo-store-backup.timer --all

# health 和 release
curl -fsS http://127.0.0.1:8900/api/system/health | python3 -m json.tool
sudo readlink -f /opt/lenovo-store-operations/current
sudo readlink -f /opt/lenovo-store-operations/previous

# 数据和磁盘
sudo find /var/lib/lenovo-store-operations -maxdepth 2 -type f \
  -printf '%M %u:%g %s %p\n'
df -hT /opt /var/lib /var/backups
```

## 参考资料

- [Node.js v22.21.1 官方归档与 Linux ARM64 下载](https://nodejs.org/en/download/archive/v22.21.1)
- [通用 Ubuntu 部署、数据持久化与备份恢复指南](ubuntu-deployment.md)
- [项目 README](../README.md)
- [项目更新日志](../CHANGELOG.md)

Content was rephrased for compliance with licensing restrictions.
