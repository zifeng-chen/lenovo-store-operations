// 更新器的错误提示表：更新器以独立 root 进程运行，不能依赖 workspace 包，
// 因此在这里内置一份精简版说明。运维在 journalctl 中即可看到解释与处理步骤。
// 完整版见 packages/shared/src/error-catalog.js（两者由 scripts/verify-error-catalog.js 校验收敛）。

export const UPDATER_HINTS = Object.freeze({
  INTERRUPTED_BEFORE_SWITCH: {
    title: '升级被中断，当前版本没有任何改变',
    explanation: '升级过程中更新程序被意外终止（重启、断电或进程被杀），终止点在切换到新版本之前。当前运行的仍是原版本，业务未受影响，这次升级等同于没有生效。',
    solutions: [
      '确认服务器能正常访问 GitHub，代理服务在线。',
      '在系统页面重新点击"检查更新"，确认能检测到最新版本。',
      '再次点击"立即升级"重新提交。'
    ]
  },
  INTERRUPTED_UPDATE_RECOVERED: {
    title: '上次升级被中断，已自动回滚到原版本',
    explanation: '上一次升级在切换版本的过程中被中断，系统已把 current 指回原版本并重新通过健康检查，业务可正常使用。',
    solutions: ['无需处理，当前版本可正常使用。', '需要升级时重新"检查更新"后再提交安装。']
  },
  ORPHANED_UPDATE_STATE: {
    title: '发现残留的升级任务，已安全清理',
    explanation: '系统发现一个没有完整记录的遗留升级任务。经核对当前版本并未被该任务切换过，服务状态安全，残留任务已清除。',
    solutions: ['无需处理，当前版本未受影响。', '重新"检查更新"后再提交升级。']
  },
  RECOVERY_FAILED: {
    title: '中断任务的自动恢复失败',
    explanation: '系统在把中断的升级恢复到一致状态时失败，通常意味着磁盘、权限或服务状态存在更底层的问题。',
    solutions: [
      '先不要重复提交升级。',
      '执行 systemctl status lenovo-store.service 确认业务服务状态。',
      '执行 journalctl -u lenovo-store-updater --no-pager -n 200 查看完整日志并联系维护人员。'
    ]
  },
  ROLLBACK_FAILED: {
    title: '升级失败且回滚未能完成',
    explanation: '新版本未通过验证，回滚到原版本时也失败了，线上可能仍指向一个不可用的版本，属于需要人工介入的严重故障。',
    solutions: [
      '立即执行 systemctl status lenovo-store.service 检查服务状态。',
      '执行 readlink -f /opt/lenovo-store-operations/current 查看当前指向。',
      '执行 journalctl -u lenovo-store-updater --no-pager -n 200 获取失败原因，并按日志手动回退。'
    ]
  },
  DOWNLOAD_FAILED: {
    title: '下载升级包失败',
    explanation: '无法从 GitHub 下载升级文件，最常见的原因是服务器访问 GitHub 不稳定，或代理服务没有运行。',
    solutions: [
      '确认服务器能访问 GitHub，或代理服务处于运行状态。',
      '稍后重新提交升级。',
      '检查 lenovo-store-updater.service 中的代理配置是否指向可用地址。'
    ]
  },
  ARTIFACT_DIGEST_MISMATCH: {
    title: '升级包校验值不匹配（文件损坏或被篡改）',
    explanation: '下载文件的 SHA-256 与官方签名清单不一致，出于安全考虑系统拒绝安装。',
    solutions: ['重新提交一次升级。', '若反复出现，检查网络链路上是否存在篡改。']
  },
  SIGNATURE_VERIFICATION_FAILED: {
    title: '发布清单签名验证失败',
    explanation: '发布清单签名无法用服务器上的公钥验证通过，可能是产物被篡改，或服务器上的公钥不是官方公钥。',
    solutions: [
      '核对服务器上的公钥指纹是否为官方公布的那一份。',
      '公钥正确时说明发布产物异常，请联系维护人员。',
      '切勿在验证失败的情况下跳过校验安装。'
    ]
  },
  HEALTH_CHECK_FAILED: {
    title: '新版本启动后健康检查未通过',
    explanation: '新版本安装完成后，服务在限定时间内没有返回健康响应，系统判定本次升级不可用。',
    solutions: [
      '执行 journalctl -u lenovo-store.service --no-pager -n 200 查看服务报错原因。',
      '系统已自动回滚时，当前版本可正常使用，修复问题后再升级。'
    ]
  },
  ORIGINAL_SERVICE_RESTART_FAILED: {
    title: '升级失败后原服务未能重新启动',
    explanation: '新版本安装失败，系统把版本指回原版本后业务服务没有成功启动，此时页面会无法访问。',
    solutions: [
      '执行 systemctl status lenovo-store.service 查看状态。',
      '执行 systemctl restart lenovo-store.service 手动重启。',
      '仍无法启动时收集 journalctl 日志并联系维护人员。'
    ]
  },
  INVALID_CONFIG: {
    title: '更新程序配置不正确',
    explanation: '更新程序配置文件存在字段缺失、路径非法或取值越界。',
    solutions: [
      '核对 /etc/lenovo-store-updater.json 是否与部署文档一致。',
      '按日志提示的具体字段修正后执行 systemctl restart lenovo-store-updater。'
    ]
  },
  INVALID_CONFIG_PERMISSIONS: {
    title: '更新程序配置文件权限不安全',
    explanation: '配置文件必须由 root 独占，当前权限允许其他账号读取或修改。',
    solutions: ['执行 chown root:root /etc/lenovo-store-updater.json && chmod 600 /etc/lenovo-store-updater.json。']
  },
  BUILDER_NOT_IDLE: {
    title: '构建账号还有残留进程',
    explanation: '用于安装依赖的专用低权限账号上仍有进程在运行，系统无法安全开始安装。',
    solutions: ['稍后重试一次。', '若持续出现，检查该账号下是否有异常常驻进程。']
  },
  UPDATE_NOT_NEWER: {
    title: '目标版本不高于当前版本',
    explanation: '系统只允许升级到更高的版本号，本次请求的版本不比正在运行的版本新。',
    solutions: ['重新"检查更新"确认是否有更高版本。', '当前已是最高版本时无需升级。']
  },
  STAGING_EXISTS: {
    title: '升级临时目录已存在',
    explanation: '上一次升级留下的临时目录还占着位置，本次升级无法开始。',
    solutions: ['稍等后重试（系统会尝试自动清理）。', '持续出现时联系维护人员清理 staging 目录。']
  },
  RELEASE_EXISTS: {
    title: '目标版本目录已存在',
    explanation: '要安装的版本目录已存在，系统拒绝覆盖以防损坏已有文件。',
    solutions: ['确认是否已安装过该版本。', '联系维护人员确认后清理残留目录再重试。']
  }
})

export function describeUpdaterError(code, message) {
  const hint = UPDATER_HINTS[code]
  return {
    code,
    title: hint?.title || '升级失败',
    explanation: hint?.explanation || '升级过程中出现了未登记说明的异常，具体原因见原始信息。',
    solutions: hint?.solutions?.length ? [...hint.solutions] : ['重新提交一次升级。', '若持续失败，请收集日志并联系维护人员。'],
    rawMessage: message
  }
}

// 把"人话 + 处理步骤"打到日志里，运维无需对照文档。
export function logUpdaterError(code, message) {
  const doc = describeUpdaterError(code, message)
  console.error(`[${code}] ${message}`)
  console.error(`  说明：${doc.title} —— ${doc.explanation}`)
  doc.solutions.forEach((step, index) => console.error(`  处理 ${index + 1}：${step}`))
}
