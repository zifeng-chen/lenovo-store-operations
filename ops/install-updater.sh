#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/lenovo-store-operations
ENV_FILE=/etc/lenovo-store-operations.env
UPDATER_CONFIG=/etc/lenovo-store-updater.json
PUBLIC_KEY_TARGET=/etc/lenovo-store-release-signing.pub
UPDATER_LIB=/usr/local/lib/lenovo-store-updater
SYSTEMD_DIR=/etc/systemd/system
TMPFILES_TARGET=/etc/tmpfiles.d/lenovo-store-updater.conf
STATE_ROOT=/var/lib/lenovo-store-updater
RUNTIME_ROOT=/run/lenovo-store-updater
SERVICE_NAME=lenovo-store-operations.service
BACKUP_SERVICE=lenovo-store-backup.service
BUILDER_USER=lenovo-store-builder
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
SOURCE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

SERVICE_USER=
PUBLIC_KEY_SOURCE=
EXPECTED_PUBLIC_KEY_SHA256=
NODE_PATH=/usr/bin/node
NPM_PATH=/usr/bin/npm
CONFIRMED=false
SUCCESS=false
CHANGES_STARTED=false
ROOT_MOVED=false
WORK=
RELEASE_NAME=
BOOTSTRAP=
CANDIDATE=
VERSION=
COMMIT=
ORIGINAL_ROOT_UID=
ORIGINAL_ROOT_GID=
ORIGINAL_ROOT_MODE=
BUILDER_UID=
BUILDER_GID=

usage() {
  cat <<'EOF'
用法：
  sudo ./ops/install-updater.sh \
    --service-user <运行服务的账号> \
    --public-key /root/release-signing-public.pem \
    --public-key-sha256 <GitHub变量中的64位指纹> \
    [--node-path /usr/bin/node] [--npm-path /usr/bin/npm] \
    --confirm-migration

脚本会先从已提交且已推送的 HEAD 构建只含受控文件的候选版本，再运行现有一致性备份，
最后把旧 checkout 原样移到 bootstrap 备份并建立 current/previous/releases。
安装 root-owned 更新器和 systemd 单元；任一步失败都会恢复旧目录、权限、环境文件和 unit，
并验证旧服务健康。在线更新默认信任同源局域网客户端；若环境已配置
LENOVO_STORE_MAINTENANCE_TOKEN，在线更新会复用该维护令牌。必须使用 UFW/VLAN 限制访问，
禁止暴露到公网，并先在隔离 Ubuntu 主机演练。
EOF
}

while (($#)); do
  case "$1" in
    --service-user) SERVICE_USER=${2:-}; shift 2 ;;
    --public-key) PUBLIC_KEY_SOURCE=${2:-}; shift 2 ;;
    --public-key-sha256) EXPECTED_PUBLIC_KEY_SHA256=${2:-}; shift 2 ;;
    --node-path) NODE_PATH=${2:-}; shift 2 ;;
    --npm-path) NPM_PATH=${2:-}; shift 2 ;;
    --confirm-migration) CONFIRMED=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done

fail() { echo "$1" >&2; exit 1; }

validate_root_controlled_path() {
  local input=$1 resolved current uid mode
  resolved=$(readlink -f -- "$input") || return 1
  [[ -f $resolved && -x $resolved ]] || return 1
  current=$resolved
  while :; do
    uid=$(stat -c '%u' -- "$current") || return 1
    mode=$(stat -c '%a' -- "$current") || return 1
    [[ $uid == 0 ]] || return 1
    (( (8#$mode & 8#022) == 0 )) || return 1
    [[ $current == / ]] && break
    current=$(dirname -- "$current")
  done
  printf '%s\n' "$resolved"
}

validate_root_controlled_file() {
  local input=$1 resolved current uid mode
  resolved=$(readlink -f -- "$input") || return 1
  [[ -f $resolved && ! -L $resolved ]] || return 1
  current=$resolved
  while :; do
    uid=$(stat -c '%u' -- "$current") || return 1
    mode=$(stat -c '%a' -- "$current") || return 1
    [[ $uid == 0 ]] || return 1
    (( (8#$mode & 8#022) == 0 )) || return 1
    [[ $current == / ]] && break
    current=$(dirname -- "$current")
  done
  printf '%s\n' "$resolved"
}

wait_for_health() {
  local expected_version=$1 expected_commit=$2 attempts=${3:-45}
  local attempt consecutive=0
  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS http://127.0.0.1:8900/api/system/health | "$NODE_PATH" -e '
      let text=""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => {
        const body = JSON.parse(text); const data = body.data;
        const expectedIds = ["computer-labels", "price-labels", "receipt-assistant", "employee-badges"];
        const sqliteIds = new Set(["computer-labels", "price-labels", "receipt-assistant"]);
        const modules = Array.isArray(data?.modules) ? data.modules : [];
        const moduleById = new Map(modules.map(module => [module?.id, module]));
        const modulesHealthy = modules.length === expectedIds.length && expectedIds.every(id => {
          const module = moduleById.get(id);
          if (!module || module.moduleReady !== true) return false;
          if (!sqliteIds.has(id)) return module.persistence === "none";
          return module.persistence === "sqlite" && module.apiReady === true
            && module.dataDirectoryReady === true && module.databaseConnected === true;
        });
        const ok = body.code === 0 && data.status === "ok" && data.persistentDataConfigured === true
          && data.build.version === process.argv[1] && data.build.commit === process.argv[2]
          && data.portalReady === true && modulesHealthy;
        process.exit(ok ? 0 : 1);
      });
    ' "$expected_version" "$expected_commit"; then
      consecutive=$((consecutive + 1))
      [[ $consecutive -ge 3 ]] && return 0
    else
      consecutive=0
    fi
    sleep 2
  done
  return 1
}

rollback_on_exit() {
  local exit_code=$? rollback_ok=true
  trap - EXIT
  if [[ $SUCCESS != true && $CHANGES_STARTED == true ]]; then
    echo '安装未完成，正在恢复迁移前目录、配置和 systemd 单元。' >&2
    set +e
    systemctl stop "$SERVICE_NAME" lenovo-store-updater.path lenovo-store-updater.service || rollback_ok=false
    systemctl disable lenovo-store-updater.path lenovo-store-updater.service || true
    rm -f -- "$SYSTEMD_DIR/lenovo-store-updater.path" "$SYSTEMD_DIR/lenovo-store-updater.service" "$TMPFILES_TARGET" || rollback_ok=false
    rm -f -- "$UPDATER_CONFIG" "$PUBLIC_KEY_TARGET" "$UPDATER_LIB/updater.mjs" || rollback_ok=false
    rmdir -- "$UPDATER_LIB" 2>/dev/null || true
    rm -rf -- "$RUNTIME_ROOT" "$STATE_ROOT" || rollback_ok=false

    if [[ $ROOT_MOVED == true && -d $BOOTSTRAP ]]; then
      [[ -d $ROOT && ! -L $ROOT ]] && rm -rf -- "$ROOT"
      if mv -- "$BOOTSTRAP" "$ROOT"; then
        chown "$ORIGINAL_ROOT_UID:$ORIGINAL_ROOT_GID" "$ROOT" || rollback_ok=false
        chmod "$ORIGINAL_ROOT_MODE" "$ROOT" || rollback_ok=false
      else
        rollback_ok=false
      fi
    fi
    [[ -n $CANDIDATE && -d $CANDIDATE ]] && rm -rf -- "$CANDIDATE"
    if getent passwd "$BUILDER_USER" >/dev/null; then
      BUILDER_UID=$(id -u "$BUILDER_USER")
      pkill -KILL -u "$BUILDER_UID" 2>/dev/null || true
      userdel "$BUILDER_USER" || rollback_ok=false
    fi
    if getent group "$BUILDER_USER" >/dev/null; then
      groupdel "$BUILDER_USER" || rollback_ok=false
    fi

    cp -a -- "$WORK/original.env" "$ENV_FILE" || rollback_ok=false
    cp -a -- "$WORK/original-main.service" "$SYSTEMD_DIR/$SERVICE_NAME" || rollback_ok=false
    cp -a -- "$WORK/original-backup.service" "$SYSTEMD_DIR/$BACKUP_SERVICE" || rollback_ok=false
    systemctl daemon-reload || rollback_ok=false
    systemctl start "$SERVICE_NAME" || rollback_ok=false
    if [[ -n $VERSION && -n $COMMIT ]]; then
      wait_for_health "$VERSION" "$COMMIT" 45 || rollback_ok=false
    fi
    if [[ $rollback_ok == true ]]; then
      echo '已精确恢复旧 checkout、配置、unit 和服务健康状态。' >&2
    else
      echo '自动恢复未完整通过，请立即检查目录、systemctl status 和 health；在线更新不得启用。' >&2
      exit_code=1
    fi
  fi
  [[ -n $WORK && -d $WORK ]] && rm -rf -- "$WORK"
  exit "$exit_code"
}
trap rollback_on_exit EXIT

[[ $EUID -eq 0 ]] || fail '必须使用 sudo/root 执行。'
[[ $CONFIRMED == true ]] || fail '缺少 --confirm-migration，未执行任何变更。'
[[ $SERVICE_USER =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || fail 'service-user 无效。'
id "$SERVICE_USER" >/dev/null
[[ $SERVICE_USER != "$BUILDER_USER" ]] || fail 'service-user 不能使用专用构建账号名。'
getent passwd "$BUILDER_USER" >/dev/null && fail "专用构建账号已存在，拒绝复用：$BUILDER_USER"
getent group "$BUILDER_USER" >/dev/null && fail "专用构建组已存在，拒绝复用：$BUILDER_USER"
[[ $EXPECTED_PUBLIC_KEY_SHA256 =~ ^[0-9a-f]{64}$ ]] || fail 'public-key-sha256 必须是 64 位小写 SHA-256 指纹。'
for command in git getent sed curl readlink stat df systemctl systemd-tmpfiles grep awk seq install runuser useradd userdel groupdel pkill pgrep sha256sum; do
  command -v "$command" >/dev/null || fail "缺少必要命令：$command"
done
NODE_PATH=$(validate_root_controlled_path "$NODE_PATH") || fail 'root 更新器的 Node 及全部祖先必须 root-owned、不可由组/其他用户写；不要使用服务账号 NVM。'
[[ -x $NPM_PATH ]] || fail 'npm-path 不可执行。'
PUBLIC_KEY_SOURCE=$(validate_root_controlled_file "$PUBLIC_KEY_SOURCE") || fail '签名公钥及全部祖先必须 root-owned、不可写且不能是符号链接。'
[[ -x /usr/bin/tar && -x /usr/bin/systemctl ]] || fail '缺少固定 /usr/bin/tar 或 /usr/bin/systemctl。'
[[ -f $ENV_FILE && ! -L $ENV_FILE ]] || fail "$ENV_FILE 不存在或不安全。"
[[ -d $ROOT && ! -L $ROOT ]] || fail "$ROOT 必须是当前非符号链接 checkout。"
ORIGINAL_ROOT_UID=$(stat -c '%u' -- "$ROOT")
ORIGINAL_ROOT_GID=$(stat -c '%g' -- "$ROOT")
ORIGINAL_ROOT_MODE=$(stat -c '%a' -- "$ROOT")
[[ $SOURCE_ROOT == "$ROOT" ]] || fail "必须从 $ROOT/ops/install-updater.sh 执行。"
[[ -d $ROOT/.git ]] || fail '首次迁移要求当前目录是 Git checkout。'
[[ -z $(git -C "$ROOT" status --porcelain --untracked-files=all) ]] || fail '工作区包含未提交或未跟踪内容，拒绝迁移。请先提交并推送。'
UPSTREAM=$(git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}') || fail '当前分支没有 upstream，无法确认提交已推送。'
[[ $(git -C "$ROOT" rev-parse HEAD) == "$(git -C "$ROOT" rev-parse "$UPSTREAM")" ]] || fail '当前 HEAD 与 upstream 不一致，请先 fetch、提交并推送。'
while IFS= read -r -d '' ignored_path; do
  case "$ignored_path" in
    node_modules/|apps/*/node_modules/|packages/*/node_modules/|apps/*/dist/|packages/*/dist/) ;;
    *) fail "checkout 包含非受控 ignored 内容，拒绝迁移：$ignored_path" ;;
  esac
done < <(git -C "$ROOT" ls-files --others --ignored --exclude-standard --directory -z)
[[ -f $SYSTEMD_DIR/$SERVICE_NAME && -f $SYSTEMD_DIR/$BACKUP_SERVICE ]] || fail '主服务或备份 service 不存在。'
for path_to_create in "$UPDATER_CONFIG" "$PUBLIC_KEY_TARGET" "$UPDATER_LIB" "$SYSTEMD_DIR/lenovo-store-updater.service" "$SYSTEMD_DIR/lenovo-store-updater.path" "$TMPFILES_TARGET" "$STATE_ROOT" "$RUNTIME_ROOT"; do
  [[ ! -e $path_to_create ]] || fail "目标已存在，拒绝覆盖：$path_to_create"
done

grep -Fxq 'NODE_ENV=production' "$ENV_FILE" || fail '环境文件必须显式包含 NODE_ENV=production。'
grep -Eq '^HOST=(127\.0\.0\.1|0\.0\.0\.0)$' "$ENV_FILE" || fail '环境文件要求 HOST=127.0.0.1 或 HOST=0.0.0.0。'
grep -Fxq 'PORT=8900' "$ENV_FILE" || fail '在线更新部署模板要求 PORT=8900。'
grep -Fxq 'LENOVO_STORE_DATA_DIR=/var/lib/lenovo-store-operations' "$ENV_FILE" || fail '在线更新部署模板只允许固定外部数据目录 /var/lib/lenovo-store-operations。'
grep -Fxq 'LENOVO_STORE_BACKUP_DIR=/var/backups/lenovo-store-operations' "$ENV_FILE" || fail '在线更新部署模板只允许固定备份目录 /var/backups/lenovo-store-operations。'
for key in \
  LENOVO_STORE_UPDATE_ENABLED \
  LENOVO_STORE_UPDATE_REQUEST_PATH \
  LENOVO_STORE_UPDATE_PROCESSING_PATH \
  LENOVO_STORE_UPDATE_STATE_PATH; do
  grep -q "^${key}=" "$ENV_FILE" && fail "$ENV_FILE 已包含 $key；拒绝覆盖现有更新配置。"
done
AVAILABLE_KB=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
[[ $AVAILABLE_KB =~ ^[0-9]+$ && $AVAILABLE_KB -ge 1048576 ]] || fail '/opt 所在文件系统至少需要 1GiB 可用空间。'

WORK=$(mktemp -d /tmp/lenovo-store-updater-install.XXXXXX)
chmod 0700 "$WORK"
cp -a -- "$ENV_FILE" "$WORK/original.env"
cp -a -- "$SYSTEMD_DIR/$SERVICE_NAME" "$WORK/original-main.service"
cp -a -- "$SYSTEMD_DIR/$BACKUP_SERVICE" "$WORK/original-backup.service"
install -m 0600 -o root -g root "$PUBLIC_KEY_SOURCE" "$WORK/release-signing-public.pem"

"$NODE_PATH" -e '
  const { createHash, createPublicKey } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const key = createPublicKey(readFileSync(process.argv[1]));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("只允许 Ed25519 公钥");
  const der = key.export({ type: "spki", format: "der" });
  const actual = createHash("sha256").update(der).digest("hex");
  if (actual !== process.argv[2]) throw new Error(`签名公钥指纹不一致：${actual}`);
' "$WORK/release-signing-public.pem" "$EXPECTED_PUBLIC_KEY_SHA256"
"$NODE_PATH" -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error("Node.js 必须 >=22.12.0");
'

SERVICE_UID=$(id -u "$SERVICE_USER")
SERVICE_GID=$(id -g "$SERVICE_USER")
SERVICE_GROUP=$(id -gn "$SERVICE_USER")
SERVICE_HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)
[[ -n $SERVICE_HOME && $SERVICE_HOME == /* ]] || fail '无法确定服务账号 HOME。'
VERSION=$("$NODE_PATH" -p 'require(process.argv[1]).version' "$ROOT/package.json")
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
[[ $VERSION =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail '根版本无效。'
[[ $COMMIT =~ ^[0-9a-f]{40}$ ]] || fail 'Git commit 无效。'
RELEASE_NAME="${VERSION}-${COMMIT}"
BOOTSTRAP="${ROOT}.bootstrap-${COMMIT:0:8}"
CANDIDATE="${ROOT}.candidate-${COMMIT:0:8}"
[[ ! -e $BOOTSTRAP ]] || fail "$BOOTSTRAP 已存在。"
[[ ! -e $CANDIDATE ]] || fail "$CANDIDATE 已存在。"

cp "$SCRIPT_DIR/systemd/lenovo-store-operations.service" "$WORK/$SERVICE_NAME"
cp "$SCRIPT_DIR/systemd/lenovo-store-backup.service" "$WORK/$BACKUP_SERVICE"
cp "$SCRIPT_DIR/systemd/lenovo-store-updater.service" "$WORK/lenovo-store-updater.service"
cp "$SCRIPT_DIR/systemd/lenovo-store-updater.path" "$WORK/lenovo-store-updater.path"
cp "$SCRIPT_DIR/tmpfiles.d/lenovo-store-updater.conf" "$WORK/lenovo-store-updater.conf"
for file in "$WORK/$SERVICE_NAME" "$WORK/$BACKUP_SERVICE"; do
  sed -i -e "s|<service-user>|$SERVICE_USER|g" -e "s|<service-group>|$SERVICE_GROUP|g" -e "s|/usr/bin/npm|$NPM_PATH|g" "$file"
done
sed -i "s|<node-path>|$NODE_PATH|g" "$WORK/$SERVICE_NAME"
sed -i "s|<node-path>|$NODE_PATH|g" "$WORK/lenovo-store-updater.service"
sed -i "s|<service-group>|$SERVICE_GROUP|g" "$WORK/lenovo-store-updater.conf"
grep -R '<[^>]*>' "$WORK"/*.service "$WORK"/*.conf && fail 'systemd 模板仍包含未替换占位符。'

wait_for_health "$VERSION" "$COMMIT" 10 || fail '迁移前旧服务未连续通过健康检查，未执行任何系统变更。'
CHANGES_STARTED=true
useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin --no-create-home "$BUILDER_USER"
BUILDER_UID=$(id -u "$BUILDER_USER")
BUILDER_GID=$(id -g "$BUILDER_USER")
[[ $BUILDER_UID != "$SERVICE_UID" && $BUILDER_GID != "$SERVICE_GID" ]] || fail '专用构建账号必须与在线服务账号和组完全隔离。'

install -d -m 0750 -o "$BUILDER_USER" -g "$BUILDER_USER" "$CANDIDATE"
git -C "$ROOT" archive --format=tar "$COMMIT" | /usr/bin/tar -xf - -C "$CANDIDATE"
TRUSTED_UPDATER_SHA256=$(sha256sum "$CANDIDATE/ops/updater/updater.mjs" | awk '{print $1}')
chown -R "$BUILDER_USER:$BUILDER_USER" "$CANDIDATE"
chmod -R u=rwX,g=rX,o= "$CANDIDATE"
install -d -m 0700 -o "$BUILDER_USER" -g "$BUILDER_USER" "$CANDIDATE/.builder-home"
(
  cd "$CANDIDATE"
  runuser -u "$BUILDER_USER" -- env \
    HOME="$CANDIDATE/.builder-home" \
    PATH="$(dirname "$NODE_PATH"):$(dirname "$NPM_PATH"):/usr/local/bin:/usr/bin:/bin" \
    NODE_ENV=development \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    npm_config_cache="$CANDIDATE/.npm-cache" \
    "$NPM_PATH" ci --include=dev
  runuser -u "$BUILDER_USER" -- env \
    HOME="$CANDIDATE/.builder-home" \
    PATH="$(dirname "$NODE_PATH"):$(dirname "$NPM_PATH"):/usr/local/bin:/usr/bin:/bin" \
    NODE_ENV=development \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    npm_config_cache="$CANDIDATE/.npm-cache" \
    "$NPM_PATH" run build
  runuser -u "$BUILDER_USER" -- env \
    HOME="$CANDIDATE/.builder-home" \
    PATH="$(dirname "$NODE_PATH"):$(dirname "$NPM_PATH"):/usr/local/bin:/usr/bin:/bin" \
    NODE_ENV=development \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    npm_config_cache="$CANDIDATE/.npm-cache" \
    "$NPM_PATH" run check
)
pkill -KILL -u "$BUILDER_UID" 2>/dev/null || true
sleep 1
! pgrep -u "$BUILDER_UID" >/dev/null || fail '专用构建账号仍有遗留进程，拒绝封存候选。'
rm -rf -- "$CANDIDATE/.npm-cache" "$CANDIDATE/.builder-home"
[[ $(sha256sum "$CANDIDATE/ops/updater/updater.mjs" | awk '{print $1}') == "$TRUSTED_UPDATER_SHA256" ]] || fail '候选更新器在降权构建期间被修改。'

COMMIT_TIMESTAMP=$(git -C "$ROOT" show -s --format=%cI "$COMMIT")
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat >"$CANDIDATE/release-info.json" <<EOF
{
  "manifestSchemaVersion": 1,
  "repository": "zifeng-chen/lenovo-store-operations",
  "channel": "stable",
  "version": "$VERSION",
  "tag": "v$VERSION",
  "commit": "$COMMIT",
  "commitTimestamp": "$COMMIT_TIMESTAMP",
  "builtAt": "$BUILT_AT",
  "nodeVersion": "$("$NODE_PATH" --version | sed 's/^v//')",
  "nodeEngine": ">=22.12.0"
}
EOF
chown -R root:"$SERVICE_GROUP" "$CANDIDATE"
chmod -R u=rwX,g=rX,o= "$CANDIDATE"

systemctl start "$BACKUP_SERVICE"
systemctl stop "$SERVICE_NAME"

mv "$ROOT" "$BOOTSTRAP"
ROOT_MOVED=true
install -d -m 0755 -o root -g root "$ROOT/releases"
mv "$CANDIDATE" "$ROOT/releases/$RELEASE_NAME"
ln -s "releases/$RELEASE_NAME" "$ROOT/current"
ln -s "releases/$RELEASE_NAME" "$ROOT/previous"

install -d -m 0755 -o root -g root "$UPDATER_LIB"
install -m 0755 -o root -g root "$ROOT/current/ops/updater/updater.mjs" "$UPDATER_LIB/updater.mjs"
install -m 0644 -o root -g root "$WORK/release-signing-public.pem" "$PUBLIC_KEY_TARGET"
cat >"$UPDATER_CONFIG" <<EOF
{
  "repository": "zifeng-chen/lenovo-store-operations",
  "releaseRoot": "$ROOT",
  "requestPath": "/run/lenovo-store-updater/request.json",
  "processingPath": "/run/lenovo-store-updater/claimed/processing.json",
  "statePath": "/var/lib/lenovo-store-updater/status.json",
  "transactionPath": "/var/lib/lenovo-store-updater/transaction.json",
  "publicKeyPath": "$PUBLIC_KEY_TARGET",
  "updaterPath": "$UPDATER_LIB/updater.mjs",
  "serviceName": "$SERVICE_NAME",
  "updaterServiceName": "lenovo-store-updater.service",
  "backupServiceName": "$BACKUP_SERVICE",
  "npmPath": "$NPM_PATH",
  "tarPath": "/usr/bin/tar",
  "serviceUid": $SERVICE_UID,
  "serviceGid": $SERVICE_GID,
  "builderUid": $BUILDER_UID,
  "builderGid": $BUILDER_GID,
  "serviceHome": "$SERVICE_HOME",
  "healthUrl": "http://127.0.0.1:8900/api/system/health",
  "downloadTimeoutMs": 30000,
  "installTimeoutMs": 600000,
  "healthTimeoutMs": 90000,
  "maxArtifactBytes": 314572800
}
EOF
chmod 0600 "$UPDATER_CONFIG"
chown root:root "$UPDATER_CONFIG"

install -m 0644 -o root -g root "$WORK/$SERVICE_NAME" "$SYSTEMD_DIR/$SERVICE_NAME"
install -m 0644 -o root -g root "$WORK/$BACKUP_SERVICE" "$SYSTEMD_DIR/$BACKUP_SERVICE"
install -m 0644 -o root -g root "$WORK/lenovo-store-updater.service" "$SYSTEMD_DIR/lenovo-store-updater.service"
install -m 0644 -o root -g root "$WORK/lenovo-store-updater.path" "$SYSTEMD_DIR/lenovo-store-updater.path"
install -m 0644 -o root -g root "$WORK/lenovo-store-updater.conf" "$TMPFILES_TARGET"
systemd-tmpfiles --create "$TMPFILES_TARGET"

printf '\n' >>"$ENV_FILE"
cat >>"$ENV_FILE" <<EOF
LENOVO_STORE_UPDATE_ENABLED=true
LENOVO_STORE_UPDATE_REQUEST_PATH=/run/lenovo-store-updater/request.json
LENOVO_STORE_UPDATE_PROCESSING_PATH=/run/lenovo-store-updater/claimed/processing.json
LENOVO_STORE_UPDATE_STATE_PATH=/var/lib/lenovo-store-updater/status.json
EOF
chmod 0600 "$ENV_FILE"
chown root:root "$ENV_FILE"

systemctl daemon-reload
systemctl enable lenovo-store-updater.service
systemctl enable --now lenovo-store-updater.path
systemctl restart "$SERVICE_NAME"
if wait_for_health "$VERSION" "$COMMIT" 45; then
  chown root:root "$BOOTSTRAP"
  chmod 0700 "$BOOTSTRAP"
  SUCCESS=true
  echo '签名在线更新器安装完成。'
  echo "当前版本：v$VERSION ($COMMIT)"
  echo "签名公钥指纹：$EXPECTED_PUBLIC_KEY_SHA256"
  echo "迁移前 checkout 已按 root:root 0700 保留在：$BOOTSTRAP"
  echo '在线更新默认允许同源可信局域网客户端免令牌操作；如已配置维护令牌，则复用该令牌。'
  echo '请确认 UFW/VLAN 已限制访问，禁止公网暴露；完成故障演练后再人工清理 bootstrap 备份。'
  exit 0
fi

fail '迁移后健康检查失败，将自动精确恢复旧目录、配置、权限和服务。'
