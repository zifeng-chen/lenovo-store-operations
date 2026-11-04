// 统一错误目录：每个错误码都配一份"人话解释 + 解决方案"，供后端与前端共用。
// 新增错误码时必须在此登记，scripts/verify-error-catalog.js 会在 npm run check 中强制校验。

const FALLBACK = Object.freeze({
  title: '未登记的错误',
  explanation: '系统遇到了一个尚未收录说明的异常，详细原因见下方原始信息。',
  solutions: [
    '先重试一次，很多临时性故障重试即可恢复。',
    '如果反复出现，请把这条原始错误信息连同时间点反馈给系统维护人员。'
  ],
  retryable: true,
  severity: 'error'
})

function entry(title, explanation, solutions, options = {}) {
  return Object.freeze({
    title,
    explanation,
    solutions: Object.freeze([...solutions]),
    retryable: options.retryable !== false,
    severity: options.severity || 'error'
  })
}

export const ERROR_CATALOG = Object.freeze({
  // ── 升级流程：被中断与恢复 ─────────────────────────────
  INTERRUPTED_BEFORE_SWITCH: entry(
    '升级被中断（当前版本没有任何改变）',
    '升级过程中，更新程序被意外终止了（例如机器重启、断电、进程被杀），终止发生在切换到新版本之前。'
      + '系统已经确认您当前运行的仍是原来的版本，线上业务不受影响，这次升级等于没有生效。',
    [
      '确认服务器网络通畅：能正常打开 GitHub、代理服务在线。',
      '回到本页点击"检查更新"，确认最新版本号能被正常检测到。',
      '再次点击"立即升级"重新提交一次。'
    ]
  ),
  INTERRUPTED_UPDATE_RECOVERED: entry(
    '上次升级被中断，已自动回滚到原版本',
    '上一次升级在切换版本的过程中被中断（例如机器重启或进程被终止）。系统按保守策略把 current 指回原来的版本，并重新通过了健康检查。',
    [
      '当前业务可以正常使用，无需处理。',
      '在"升级记录"中确认当前版本仍是您期望的旧版本。',
      '需要升级时重新点击"检查更新"并再次提交安装。'
    ],
    { severity: 'warning' }
  ),
  ORPHANED_UPDATE_STATE: entry(
    '发现残留的升级任务，已安全清理',
    '系统发现了一个没有完整记录的遗留升级任务。经核对，当前版本并没有被这个任务切换过，因此服务状态是安全的，残留任务已被清除。',
    [
      '无需处理，当前版本未受影响。',
      '重新点击"检查更新"→"立即升级"即可再次尝试。',
      '如果多次出现该提示，请检查服务器是否频繁重启。'
    ],
    { severity: 'warning' }
  ),
  RECOVERY_FAILED: entry(
    '中断任务的自动恢复失败',
    '系统在尝试把中断的升级恢复到一致状态时失败了，这通常意味着磁盘、权限或服务状态存在更底层的问题。',
    [
      '先不要重复提交升级，避免状态进一步混乱。',
      '登录服务器执行 systemctl status lenovo-store.service 确认业务服务是否正常运行。',
      '执行 journalctl -u lenovo-store-updater --no-pager -n 200 查看完整日志。',
      '联系系统维护人员，把上面的日志一起提供。'
    ],
    { retryable: false }
  ),
  ROLLBACK_FAILED: entry(
    '升级失败且回滚未能完成',
    '新版本没有通过验证，系统尝试回滚到原版本时也失败了。此时线上可能仍指向一个不可用的版本，属于需要人工介入的严重故障。',
    [
      '立即登录服务器执行 systemctl status lenovo-store.service 检查服务状态。',
      '执行 readlink -f /opt/lenovo-store-operations/current 查看当前指向的版本目录。',
      '执行 journalctl -u lenovo-store-updater --no-pager -n 200 获取完整失败原因。',
      '联系系统维护人员按日志手动把 current 指回上一个正常版本，再重启业务服务。'
    ],
    { retryable: false, severity: 'critical' }
  ),

  // ── 升级流程：通用失败 ─────────────────────────────────
  UPDATER_FAILED: entry(
    '更新程序执行失败',
    '更新程序在处理这次任务时异常退出，具体原因见下方原始信息。',
    [
      '先重试一次，临时性网络或磁盘抖动重试通常可恢复。',
      '确认服务器能正常访问外网（GitHub）。',
      '若持续失败，执行 journalctl -u lenovo-store-updater --no-pager -n 200 查看详情。'
    ]
  ),
  UPDATER_FATAL: entry(
    '更新程序启动阶段就失败',
    '更新程序还没开始处理升级任务就退出了，通常与配置文件、目录权限或运行身份有关。',
    [
      '确认 /etc/lenovo-store-updater.json 存在且权限为 root 独占（600/640）。',
      '确认 /run/lenovo-store-updater 与 /var/lib/lenovo-store-updater 目录存在且权限正确。',
      '执行 journalctl -u lenovo-store-updater --no-pager -n 200 查看具体报错。'
    ],
    { retryable: false }
  ),
  UPDATE_FAILED: entry(
    '升级失败',
    '升级过程中出现了未分类的错误，系统已尽量恢复到安全状态，具体原因见下方原始信息。',
    [
      '确认当前版本是否仍是升级前的版本（本页顶部会显示当前版本）。',
      '重新"检查更新"后再试一次。',
      '若反复失败，请提供原始错误信息给维护人员。'
    ]
  ),
  ORIGINAL_SERVICE_RESTART_FAILED: entry(
    '升级失败后原服务未能重新启动',
    '新版本安装失败，系统把版本指回原版本后，业务服务没有成功启动。这会导致页面无法访问。',
    [
      '登录服务器执行 systemctl status lenovo-store.service 查看服务状态。',
      '执行 systemctl restart lenovo-store.service 手动重启业务服务。',
      '仍无法启动时执行 journalctl -u lenovo-store.service --no-pager -n 200 收集日志并联系维护人员。'
    ],
    { retryable: false }
  ),
  CANDIDATE_CLEANUP_FAILED: entry(
    '升级失败后临时文件未能清理',
    '新版本安装失败，系统尝试清理这次产生的临时目录时出错。业务仍运行在原版本上，但会残留占用磁盘的目录。',
    [
      '当前业务不受影响，可以先继续使用。',
      '登录服务器检查 /opt/lenovo-store-operations/releases 与 staging 目录下的残留内容。',
      '联系维护人员手动清理残留目录，避免磁盘被占满。'
    ],
    { severity: 'warning' }
  ),

  // ── 升级流程：下载与发布包 ─────────────────────────────
  DOWNLOAD_FAILED: entry(
    '下载升级包失败',
    '系统无法从 GitHub 下载升级文件。最常见的原因是服务器访问 GitHub 不稳定，或代理服务没有运行。',
    [
      '确认服务器能正常访问 GitHub（或代理服务处于运行状态）。',
      '稍等几分钟后重新点击"检查更新"和"立即升级"。',
      '检查 /etc/systemd/system/lenovo-store-updater.service 里的代理配置是否指向可用的代理地址。'
    ]
  ),
  DOWNLOAD_TOO_LARGE: entry(
    '升级包大小超出限制',
    '下载到的文件体积超过了系统允许的最大值，可能是下载内容异常或配置的上限过小。',
    [
      '重新提交一次升级，排除下载过程中内容损坏的可能。',
      '若持续出现，联系维护人员核对更新器配置里的 maxArtifactBytes 上限。'
    ]
  ),
  EMPTY_DOWNLOAD: entry(
    '下载到的升级包是空的',
    '从 GitHub 拿到的文件内容为空，通常是网络被中途截断或代理返回了空响应。',
    [
      '确认代理服务与网络是否正常。',
      '重新点击"检查更新"后再提交升级。'
    ]
  ),
  UNSAFE_DOWNLOAD_URL: entry(
    '下载地址不在允许的信任域名内',
    '系统只允许从 GitHub 官方域名下载升级文件，当前拿到的地址不在白名单中，出于安全考虑已拒绝下载。',
    [
      '确认发布来源是官方仓库，不要使用第三方镜像。',
      '若您自行部署并修改了下载源，请同步更新更新器的允许域名配置。'
    ],
    { retryable: false }
  ),
  INVALID_REDIRECT: entry(
    '下载跳转地址无效',
    'GitHub 返回的下载跳转缺少目标地址，属于对方服务异常。',
    ['稍后重试即可，通常是临时性问题。']
  ),
  TOO_MANY_REDIRECTS: entry(
    '下载跳转次数过多',
    '下载过程中的跳转次数超过上限，通常是网络中间设备（代理、防火墙）在反复重定向。',
    [
      '检查代理服务器是否工作正常。',
      '若有企业防火墙或网关，确认没有对 GitHub 域名做异常拦截。'
    ]
  ),
  ARTIFACT_SIZE_MISMATCH: entry(
    '升级包大小与官方签名清单不一致',
    '下载到的文件大小和官方清单里登记的不一致，说明文件在传输中损坏或被篡改，系统已拒绝安装。',
    ['重新下载一次即可，多数是传输中断导致。', '若持续出现，检查代理或中间设备是否改写了响应内容。']
  ),
  ARTIFACT_DIGEST_MISMATCH: entry(
    '升级包校验值不匹配（文件已损坏或被篡改）',
    '下载文件的 SHA-256 和官方签名清单不一致，出于安全考虑系统拒绝安装。',
    ['重新下载一次。', '若反复出现，请检查网络链路上是否存在篡改，并联系维护人员。'],
    { retryable: false }
  ),
  RELEASE_TAG_MISMATCH: entry(
    '官方返回的版本号与请求不一致',
    'GitHub 返回的 Release 版本号与本次请求的版本号不同，可能是发布方刚更新了 Release。',
    ['重新点击"检查更新"，然后重新提交升级。']
  ),
  MISSING_ASSET: entry(
    '官方 Release 缺少必需文件',
    '这次发布的 Release 里缺少升级必需的文件（升级包、清单或签名），属于发布侧不完整。',
    ['等待发布方补齐文件后重新检查更新。', '联系维护人员确认该版本是否发布完整。'],
    { retryable: false }
  ),
  DUPLICATE_ASSET: entry(
    '官方 Release 里存在重复文件',
    '同一个文件名在 Release 里出现了多次，系统无法判断以哪个为准，已拒绝安装。',
    ['联系维护人员修复该 Release 的重复资产后重新检查更新。'],
    { retryable: false }
  ),
  INVALID_RELEASE: entry(
    '官方 Release 信息无效',
    'Release 可能是草稿、预发布版，或信息字段缺失，系统只接受正式稳定版。',
    ['确认要升级的版本已正式发布（非草稿、非预发布）。', '重新检查更新后再提交。'],
    { retryable: false }
  ),

  // ──  升级流程：清单与签名 ───────────────────────────────
  UNSUPPORTED_MANIFEST: entry(
    '发布清单版本不受支持',
    '这个版本的发布清单使用了当前更新器还不认识的格式，通常是版本跨度过大。',
    ['联系维护人员按部署文档手动升级一次更新平台。'],
    { retryable: false }
  ),
  MANIFEST_SOURCE_MISMATCH: entry(
    '发布清单来源或通道不正确',
    '清单里的仓库地址或发布通道不是预期的官方稳定通道，出于安全考虑已拒绝。',
    ['确认升级来源是官方仓库的稳定通道。', '联系维护人员核对发布配置。'],
    { retryable: false }
  ),
  MANIFEST_TAG_MISMATCH: entry(
    '发布清单的版本号与请求不一致',
    '签名清单里写的版本号和本次请求的版本号对不上。',
    ['重新检查更新后再提交一次。', '若持续出现，联系维护人员核对发布产物。'],
    { retryable: false }
  ),
  MANIFEST_VERSION_MISMATCH: entry(
    '发布清单版本号与 tag 不一致',
    '清单中的 version 字段与 tag 推导出的版本号不同，属于发布产物制作错误。',
    ['联系维护人员修正该版本的发布产物。'],
    { retryable: false }
  ),
  INVALID_COMMIT: entry(
    '发布清单中的提交号无效',
    '清单里的代码提交号格式不正确，无法核对版本来源。',
    ['联系维护人员修正发布产物。'],
    { retryable: false }
  ),
  INVALID_MANIFEST: entry(
    '发布清单内容不完整',
    '清单缺少必要字段，无法据此安全安装。',
    ['联系维护人员重新发布该版本。'],
    { retryable: false }
  ),
  INVALID_HEALTH_PATH: entry(
    '发布清单的健康检查路径无效',
    '清单里声明的健康检查地址不是系统约定的地址，安装后无法判断服务是否真的起来了。',
    ['联系维护人员修正发布清单。'],
    { retryable: false }
  ),
  INVALID_ARTIFACT_NAME: entry(
    '升级包文件名不符合约定',
    '发布包的文件名不是系统约定的格式，无法安全匹配。',
    ['联系维护人员重新打包发布。'],
    { retryable: false }
  ),
  INVALID_ARTIFACT_SIZE: entry(
    '升级包声明大小无效',
    '清单里登记的升级包大小不是一个合理的数值。',
    ['联系维护人员修正发布清单。'],
    { retryable: false }
  ),
  INVALID_ARTIFACT_DIGEST: entry(
    '升级包声明校验值无效',
    '清单里登记的 SHA-256 格式不正确，无法做完整性校验。',
    ['联系维护人员修正发布清单。'],
    { retryable: false }
  ),
  INVALID_INSTALL_MODE: entry(
    '升级包安装模式不受支持',
    '这个发布包的安装方式不是当前更新平台支持的模式。',
    ['联系维护人员按部署文档手动升级更新平台后再试。'],
    { retryable: false }
  ),
  UNSAFE_PUBLIC_KEY: entry(
    '用于验证签名的公钥权限不安全',
    '服务器上存放的 Release 签名公钥权限过于开放，可能被非授权账号替换，系统拒绝继续。',
    ['登录服务器把公钥文件改成 root 所有且对其他账号不可写。', '联系维护人员核对公钥指纹是否仍是官方发布的那个。'],
    { retryable: false }
  ),
  INVALID_SIGNATURE: entry(
    '发布签名格式无效',
    '下载到的签名文件格式不正确，可能下载不完整或被篡改。',
    ['重新检查更新后再提交一次。', '若反复出现，请联系维护人员核对官方发布。'],
    { retryable: false }
  ),
  SIGNATURE_VERIFICATION_FAILED: entry(
    '发布清单签名验证失败',
    '发布清单的签名无法用服务器上的公钥验证通过，可能是产物被篡改，或服务器上的公钥不是官方公钥。',
    [
      '先确认服务器上的公钥是否为官方公布的那一份，核对指纹。',
      '若公钥正确，说明发布产物异常，请联系维护人员。',
      '切勿在验证失败的情况下手动跳过校验安装。'
    ],
    { retryable: false, severity: 'critical' }
  ),
  INVALID_CHECKSUMS: entry(
    'SHA256SUMS 校验清单格式无效',
    '官方发布的校验清单格式不正确或存在重复条目。',
    ['联系维护人员重新发布该版本。'],
    { retryable: false }
  ),
  CHECKSUM_MISMATCH: entry(
    '校验清单与签名清单不一致',
    'SHA256SUMS 里登记的摘要与实际文件或签名清单对不上。',
    ['重新检查更新后再提交一次。', '若持续出现，联系维护人员核对发布产物。'],
    { retryable: false }
  ),

  // ── 升级流程：压缩包与目录结构 ─────────────────────────
  ARCHIVE_ENTRY_LIMIT: entry(
    '升级包内文件数量异常',
    '压缩包内文件条目数超出合理范围，可能不是正常的发布包。',
    ['联系维护人员确认发布包是否正确。'],
    { retryable: false }
  ),
  UNSAFE_ARCHIVE_PATH: entry(
    '升级包内包含不安全的路径',
    '压缩包里存在可能覆盖系统文件的路径写法（例如 .. 或绝对路径），系统已拒绝解压。',
    ['联系维护人员重新打包，确认打包工具没有引入异常路径。'],
    { retryable: false, severity: 'critical' }
  ),
  INVALID_ARCHIVE_ROOT: entry(
    '升级包顶层目录结构不正确',
    '发布包必须包含且只包含一个固定名字的顶层目录，当前不符合。',
    ['联系维护人员按发布规范重新打包。'],
    { retryable: false }
  ),
  DUPLICATE_ARCHIVE_ENTRY: entry(
    '升级包内存在重复条目',
    '压缩包里有同名条目重复出现，无法确定解压结果。',
    ['联系维护人员重新打包。'],
    { retryable: false }
  ),
  UNSAFE_ARCHIVE_TYPE: entry(
    '升级包内包含链接或特殊文件',
    '发布包只允许普通文件和目录，检测到符号链接、设备等特殊文件，已拒绝安装。',
    ['联系维护人员重新打包。'],
    { retryable: false, severity: 'critical' }
  ),
  ARCHIVE_SIZE_LIMIT: entry(
    '升级包解压后体积超出限制',
    '压缩包解压后的总大小超过允许上限，继续解压可能撑爆磁盘。',
    ['联系维护人员确认发布包内容是否异常。', '检查服务器磁盘剩余空间。'],
    { retryable: false }
  ),
  INVALID_ARCHIVE: entry(
    '升级包结构无法验证',
    '系统无法解析压缩包的目录清单或文件大小，文件可能损坏。',
    ['重新提交一次升级。', '若持续失败，联系维护人员重新发布。'],
    { retryable: false }
  ),
  INVALID_RELEASE_TREE: entry(
    '解压后的版本目录缺少必需文件',
    '候选版本目录里缺少启动或描述版本所必需的文件。',
    ['联系维护人员核对发布产物完整性。'],
    { retryable: false }
  ),
  RELEASE_TREE_LIMIT: entry(
    '候选版本文件数量超出上限',
    '解压后的版本目录文件数量异常偏多。',
    ['联系维护人员确认发布产物。'],
    { retryable: false }
  ),
  UNSAFE_RELEASE_TREE: entry(
    '候选版本目录包含不允许的文件类型',
    '解压结果里出现了符号链接或特殊文件，系统拒绝启用该版本。',
    ['联系维护人员重新打包发布。'],
    { retryable: false, severity: 'critical' }
  ),
  PACKAGE_VERSION_MISMATCH: entry(
    '版本号与发布清单不一致',
    '发布包里 package.json / package-lock.json 的版本号和签名清单不一致，属于产物制作错误。',
    ['联系维护人员修正发布产物。'],
    { retryable: false }
  ),
  RELEASE_INFO_MISMATCH: entry(
    '版本描述文件与签名清单不一致',
    'release-info 中的字段和签名清单对不上，无法确认这个包的来源。',
    ['联系维护人员修正发布产物。'],
    { retryable: false, severity: 'critical' }
  ),
  INVALID_RELEASE_INFO: entry(
    '版本描述文件无效',
    'release-info 文件格式或字段不正确。',
    ['联系维护人员重新生成并发布。'],
    { retryable: false }
  ),

  // ── 升级流程：数据兼容性 ───────────────────────────────
  INCOMPATIBLE_DATA_SCHEMA: entry(
    '数据库结构与当前版本不兼容',
    '这个版本的数据库结构与当前系统约定不一致，直接安装可能导致数据无法读取。',
    ['联系维护人员确认升级路径，必要时先升级中间版本。'],
    { retryable: false }
  ),
  IRREVERSIBLE_MIGRATION: entry(
    '该版本包含不可逆的数据迁移，不能自动安装',
    '安装后会改动数据结构且无法回退，系统按策略禁止自动执行，需要人工确认并做好备份后再升级。',
    [
      '先做一次完整备份（系统维护 → 数据备份）。',
      '联系维护人员按手动升级流程操作。'
    ],
    { retryable: false, severity: 'warning' }
  ),
  INCOMPATIBLE_UPDATER_CONTRACT: entry(
    '需要先人工升级更新平台',
    '这个版本的升级机制比当前服务器上的更新程序更新，无法在线自动完成。',
    ['联系维护人员按部署文档手动升级一次 systemd 更新平台，之后即可恢复在线升级。'],
    { retryable: false }
  ),

  // ── 升级流程：服务与进程 ───────────────────────────────
  HEALTH_CHECK_FAILED: entry(
    '新版本启动后健康检查未通过',
    '新版本安装完成后，服务在限定时间内没有返回健康的响应，系统判定这次升级不可用。',
    [
      '查看下方日志确认服务报错的具体原因（常见为端口占用、配置缺失、数据库文件权限）。',
      '若系统已自动回滚，当前版本可正常使用，修复问题后再重新升级。',
      '执行 journalctl -u lenovo-store.service --no-pager -n 200 获取详细日志。'
    ]
  ),
  BUILDER_NOT_IDLE: entry(
    '构建账号还有残留进程',
    '用于安装依赖的专用低权限账号上仍有进程在运行，系统无法安全地开始安装。',
    ['稍后重试一次。', '若持续出现，登录服务器确认该账号下是否有异常常驻进程。']
  ),
  BUILDER_PROCESS_CLEANUP_FAILED: entry(
    '无法终止构建账号的残留进程',
    '系统尝试清理专用账号下的进程失败，为避免影响安装已中止本次升级。',
    ['登录服务器手动检查该账号下的进程。', '联系维护人员处理后再重新提交升级。'],
    { retryable: false }
  ),
  UPDATER_PAYLOAD_CHANGED: entry(
    '更新程序文件在安装过程中被修改',
    '系统检测到更新程序自身文件在降权构建期间发生了变化，出于安全考虑中止了本次升级。',
    ['确认服务器上没有其他人在同时改动部署目录。', '重新提交一次升级。'],
    { retryable: false, severity: 'critical' }
  ),
  INVALID_UPDATER_PAYLOAD: entry(
    '候选版本中的更新程序文件无效',
    '新版本里的更新程序文件缺失、过大或不是普通文件。',
    ['联系维护人员核对发布产物。'],
    { retryable: false }
  ),
  UNSAFE_UPDATER_PATH: entry(
    '更新程序安装目录指向了符号链接',
    '更新程序的安装目录不能是符号链接，否则存在被劫持的风险。',
    ['联系维护人员按部署文档重新创建该目录。'],
    { retryable: false }
  ),

  // ── 升级流程：事务、目录与请求 ─────────────────────────
  INVALID_TRANSACTION: entry(
    '升级事务记录不一致',
    '记录这次升级过程的 journal 文件与实际目录状态对不上，系统拒绝继续以免造成版本错乱。',
    [
      '当前版本不会被这个事务改变，业务可继续使用。',
      '执行 journalctl -u lenovo-store-updater --no-pager -n 200 收集日志。',
      '联系维护人员核对 /var/lib/lenovo-store-operations 下的事务文件。'
    ],
    { retryable: false }
  ),
  UNSAFE_TRANSACTION: entry(
    '升级事务文件权限不安全',
    '记录升级状态的文件不是由 root 独占，存在被篡改的风险。',
    ['联系维护人员修正该文件的属主与权限。'],
    { retryable: false }
  ),
  UNSAFE_CLEANUP_PATH: entry(
    '待清理目录不安全，已跳过清理',
    '系统要清理的目录可能仍被版本链接引用，或路径不符合预期，为避免误删已跳过。',
    ['业务不受影响，可继续使用。', '联系维护人员在确认后手动清理残留目录。'],
    { severity: 'warning' }
  ),
  UNSAFE_RELEASE_ROOT: entry(
    '版本根目录指向了符号链接',
    'releases 目录必须是真实目录，不能是符号链接。',
    ['联系维护人员按部署文档重建该目录。'],
    { retryable: false }
  ),
  INVALID_RELEASE_LINK: entry(
    'current / previous 链接状态异常',
    '版本切换用的软链接不存在或类型不对。',
    ['联系维护人员按部署文档重建 current、previous 两个软链接。'],
    { retryable: false }
  ),
  UNSAFE_RELEASE_LINK: entry(
    '版本链接指向了 releases 目录之外',
    '版本切换链接的目标不在允许的目录内，存在安全隐患，系统拒绝继续。',
    ['联系维护人员核对 current / previous 的指向。'],
    { retryable: false, severity: 'critical' }
  ),
  UPDATE_NOT_NEWER: entry(
    '目标版本不高于当前版本',
    '系统只允许升级到更高的版本号，当前请求的版本没有比正在运行的版本新。',
    ['点击"检查更新"确认是否有更高版本。', '若当前已经是最高版本，无需升级。']
  ),
  STAGING_EXISTS: entry(
    '升级临时目录已存在',
    '上一次升级留下的临时目录还占着位置，本次升级无法开始。',
    ['稍等片刻后重试（系统会尝试自动清理）。', '若持续出现，联系维护人员手动清理 staging 目录。']
  ),
  RELEASE_EXISTS: entry(
    '目标版本目录已存在',
    '要安装的版本目录已经存在，系统拒绝覆盖以防损坏已有文件。',
    ['确认当前是否已经安装过该版本。', '联系维护人员确认后可清理残留目录再重试。']
  ),
  INVALID_REQUEST: entry(
    '升级请求格式无效',
    '提交给更新程序的请求内容不符合约定，可能是版本号或任务编号非法。',
    ['刷新本页后重新点击"检查更新"和"立即升级"。']
  ),
  PROCESSING_REQUEST_EXISTS: entry(
    '已有一个升级任务正在处理',
    '更新程序正在处理上一个任务，暂不接受新任务。',
    ['等待当前任务结束后再提交。', '刷新本页查看当前任务状态。']
  ),
  REQUEST_EXPIRED: entry(
    '升级请求已过期',
    '从点击"立即升级"到现在超过了允许的处理时限（30 分钟），请求已作废。',
    ['重新点击"检查更新"，然后重新提交升级。']
  ),
  INVALID_REQUEST_LINKS: entry(
    '升级请求文件状态异常',
    '请求文件的硬链接计数不符合预期，可能被其他程序改动过。',
    ['重新提交一次升级。', '若持续出现，联系维护人员排查是否有其他程序在写该目录。']
  ),
  REQUEST_PUBLICATION_TIMEOUT: entry(
    '升级请求未能及时送达更新程序',
    '业务服务投递升级请求时超时，通常是更新程序没有正常运行。',
    ['确认 lenovo-store-updater 服务处于 enabled 状态。', '稍后重试一次。', '持续失败请联系维护人员检查服务状态。']
  ),
  INVALID_REQUEST_FILE: entry(
    '升级请求文件无效',
    '请求文件不是受限的普通文件，或大小异常。',
    ['重新提交一次升级。', '若持续出现，联系维护人员检查 /run/lenovo-store-updater 目录。']
  ),
  INVALID_REQUEST_PERMISSIONS: entry(
    '升级请求文件权限不正确',
    '请求文件的属主或权限不符合约定，系统拒绝执行。',
    ['重新提交一次升级。', '若持续出现，联系维护人员检查 IPC 目录权限配置（tmpfiles.d 中的 0770）。']
  ),
  REQUEST_CHANGED: entry(
    '升级请求在读取过程中发生变化',
    '有人在升级请求被处理的同时改动了该文件，系统为避免执行不确定的内容已中止。',
    ['重新提交一次升级。']
  ),

  // ── 升级流程：配置与运行环境 ───────────────────────────
  INVALID_CONFIG: entry(
    '更新程序配置不正确',
    '更新程序的配置文件存在字段缺失、路径非法或取值越界。',
    [
      '确认 /etc/lenovo-store-updater.json 存在且内容与部署文档一致。',
      '检查日志中给出的具体字段名后按文档修正。',
      '修改后执行 systemctl restart lenovo-store-updater 使配置生效。'
    ],
    { retryable: false }
  ),
  INVALID_CONFIG_PERMISSIONS: entry(
    '更新程序配置文件权限不安全',
    '配置文件必须由 root 独占，当前权限允许其他账号读取或修改。',
    ['执行 chown root:root /etc/lenovo-store-updater.json && chmod 600 /etc/lenovo-store-updater.json 修正权限。'],
    { retryable: false }
  ),
  INVALID_JSON: entry(
    '配置文件不是合法 JSON',
    '配置文件内容存在语法错误（例如多写了逗号、引号不匹配）。',
    ['按部署文档校对配置文件内容。', '修正后重启更新程序服务。'],
    { retryable: false }
  ),
  UNSAFE_FILE: entry(
    'required 文件类型不安全',
    '系统要求某个路径下必须是普通文件，当前是目录或符号链接。',
    ['联系维护人员核对该路径的实际状态。'],
    { retryable: false }
  ),
  FILE_SIZE_INVALID: entry(
    '文件大小不符合要求',
    '某个文件为空或超过允许的最大体积。',
    ['联系维护人员核对该文件是否正确生成。'],
    { retryable: false }
  ),
  INVALID_VERSION: entry(
    '版本号格式无效',
    '版本号不符合 vX.Y.Z 的格式要求。',
    ['重新检查更新后再提交升级。'],
    { retryable: false }
  ),
  UNSUPPORTED_PLATFORM: entry(
    '当前操作系统不受支持',
    '在线升级目前只支持 Linux 服务器。',
    ['在受支持的环境中部署，或联系维护人员使用手动升级流程。'],
    { retryable: false }
  ),
  ROOT_REQUIRED: entry(
    '更新程序未以 root 身份运行',
    '升级需要由系统的 root 服务执行，当前运行身份不足。',
    ['确认 systemd 服务里配置了 User=root（或未指定 User）。', '执行 systemctl restart lenovo-store-updater 重新拉起。'],
    { retryable: false }
  ),
  INVALID_ARGUMENT: entry(
    '更新程序启动参数无效',
    '手动执行更新程序时传入了不认识的参数。',
    ['不带参数执行，或只使用文档中给出的参数。'],
    { retryable: false }
  ),

  // ── 升级入口（业务服务侧）──────────────────────────────
  INSTALL_REQUEST_FAILED: entry(
    '提交升级请求失败',
    '业务服务在把升级请求交给更新程序时出错，具体原因见下方原始信息。',
    ['刷新页面后重试一次。', '若持续失败，联系维护人员检查更新平台的 IPC 目录与权限。']
  ),
  UPDATE_IPC_ERROR: entry(
    '更新通道异常',
    '业务服务与更新程序之间的通信通道出错。',
    ['稍后重试一次。', '若持续失败，执行 journalctl -u lenovo-store.service --no-pager -n 100 查看详情。']
  ),
  UPDATE_STATE_INVALID: entry(
    '升级状态文件无效或已损坏',
    '记录升级进度的文件内容异常，系统无法读取本次升级的真实状态。',
    ['刷新本页重新读取。', '若持续出现，联系维护人员检查 /var/lib/lenovo-store-updater 下的状态文件。']
  ),
  UPDATE_STATE_PERMISSIONS: entry(
    '升级状态文件权限不安全',
    '升级状态文件不是由 root 独占，存在被篡改的风险。',
    ['联系维护人员修正该文件的属主与权限。']
  ),
  UPDATE_REQUEST_INVALID: entry(
    '待处理的升级请求格式无效',
    '队列里的升级请求内容不符合约定，已被拒绝执行。',
    ['登录服务器清理该请求文件后重新提交升级。', '若持续出现，联系维护人员检查队列目录。']
  ),
  UPDATE_QUEUE_UNAVAILABLE: entry(
    '升级队列目录不可用',
    '更新程序使用的队列目录不存在或权限不对，无法接收升级任务。',
    [
      '确认 /run/lenovo-store-updater 目录存在，权限为 0770，属主 root:tianxi。',
      '执行 systemctl restart lenovo-store-updater 重新创建运行目录。'
    ]
  ),
  UPDATE_CLAIM_TIMEOUT: entry(
    '更新器长时间没有领取升级任务',
    '升级任务已提交超过 3 分钟，但更新器始终没有领取，任务已自动取消。通常是更新器服务没在运行、被停用，或运行目录权限不对。',
    [
      '执行 systemctl status lenovo-store-updater 查看更新器服务是否在运行。',
      '若服务未运行，执行 systemctl start lenovo-store-updater 后重新发起升级。',
      '确认 /run/lenovo-store-updater 目录存在，权限 0770，属主 root:tianxi。',
      '以上都正常仍无进展时，查看 journalctl -u lenovo-store-updater 的报错。'
    ]
  ),
  UPDATE_ALREADY_QUEUED: entry(
    '已有升级任务在队列中等待',
    '同一时间只允许一个升级任务，当前队列里已有一个未处理的任务。',
    ['等待队列中的任务执行完成，或刷新页面查看其状态。']
  ),
  UPDATE_IN_PROGRESS: entry(
    '已有升级任务正在执行',
    '系统同一时间只允许执行一个升级任务，当前已有一个任务正在运行，新的升级请求会被拒绝。',
    ['等待当前任务结束后再提交新的升级。', '刷新本页可以查看当前任务的实时进度。']
  ),
  UPDATE_INSTALL_DISABLED: entry(
    '在线安装未启用',
    '当前部署没有开放在线安装能力，只能做版本检查。',
    [
      '按部署文档安装 root 更新平台（systemd 服务 + 签名公钥）。',
      '或在环境文件中显式设置 LENOVO_STORE_UPDATE_ENABLED=true 后重启业务服务。'
    ],
    { retryable: false }
  ),
  UPDATE_NOT_CONFIGURED: entry(
    '更新器尚未完成配置',
    '在线安装已启用，但更新器的目录、权限或公钥还没配置完整。',
    [
      '按部署文档检查 /etc/lenovo-store-updater.json、/run/lenovo-store-updater 与 /var/lib/lenovo-store-updater。',
      '确认 Release 签名公钥已放置且权限正确。',
      '修正后执行 systemctl restart lenovo-store-updater 并刷新本页。'
    ],
    { retryable: false }
  ),
  INVALID_UPDATE_TAG: entry(
    '安装版本号格式无效',
    '安装请求里的版本号不符合 vX.Y.Z 格式。',
    ['重新点击"检查更新"后再提交升级。'],
    { retryable: false }
  ),
  INVALID_CONTENT_TYPE: entry(
    '安装请求的内容类型不正确',
    '安装接口只接受 JSON 请求，当前请求类型不符。',
    ['刷新页面后重新点击"立即升级"。']
  ),
  UPDATE_CHECK_REQUIRED: entry(
    '需要先成功检查更新',
    '安装只接受刚刚成功检查到的最新版本，缓存结果或失败结果不能用于安装。',
    ['点击"检查更新"，成功后再点击"立即升级"。']
  ),
  NO_UPDATE_AVAILABLE: entry(
    '当前没有可安装的新版本',
    '系统没有检测到比当前版本更高的稳定版。',
    ['确认当前版本是否已经是最新。', '如刚发布新版本，GitHub 同步可能有延迟，稍等几分钟再检查。']
  ),
  UPDATE_TAG_MISMATCH: entry(
    '只能安装刚刚检查到的最新版本',
    '提交的版本号与最近一次检查获得的最新版本不一致，可能是检查结果已过期。',
    ['重新点击"检查更新"后再提交升级。']
  ),
  UPDATE_REQUEST_ERROR: entry(
    '升级请求处理失败',
    '业务服务处理升级请求时出现未分类错误，具体原因见下方原始信息。',
    ['刷新页面后重试一次。', '若持续失败，联系维护人员查看业务服务日志。']
  ),

  // ── 版本检查（GitHub）──────────────────────────────────
  UPDATE_CHECK_FAILED: entry(
    '检查更新失败',
    '连接 GitHub 查询最新版本时出错，具体原因见下方原始信息。检查更新失败不影响业务功能。',
    ['稍后重试一次。', '确认服务器能访问 GitHub（或代理服务在线）。']
  ),
  GITHUB_RATE_LIMITED: entry(
    'GitHub 访问过于频繁，被临时限流',
    '短时间内请求次数超过 GitHub 限制，暂时无法检查更新。',
    ['等待几分钟后重新点击"检查更新"。', '若长期出现，建议配置只读访问令牌以提高配额。']
  ),
  GITHUB_AUTH_FAILED: entry(
    'GitHub 身份验证失败',
    '用于访问 GitHub 的只读令牌无效或已过期。',
    ['联系维护人员更新服务器上的只读 GitHub 令牌。', '更新后重启业务服务。']
  ),
  GITHUB_FORBIDDEN: entry(
    'GitHub 拒绝访问',
    '令牌权限不足，无法读取 Release 信息。',
    ['联系维护人员确认令牌具备仓库内容的只读权限。', '更新后重启业务服务。']
  ),
  GITHUB_UNAVAILABLE: entry(
    'GitHub 服务暂时不可用',
    'GitHub 服务端当前返回不可用状态，通常是对方正在维护或出现故障，与本地系统无关。',
    ['稍后再试。', '可访问 GitHub Status 页面确认是否为对方故障。']
  ),
  GITHUB_REQUEST_FAILED: entry(
    'GitHub 请求失败',
    'GitHub 返回了非预期的状态码。',
    ['稍后重试。', '若持续失败，联系维护人员检查代理与令牌配置。']
  ),
  GITHUB_TIMEOUT: entry(
    '连接 GitHub 超时',
    '在规定时间内没有等来 GitHub 的响应，通常是网络或代理较慢。',
    ['稍后重试一次。', '检查代理服务是否响应缓慢或处于离线状态。']
  ),
  GITHUB_NETWORK_ERROR: entry(
    '无法连接 GitHub',
    '服务器到 GitHub 的网络连接失败，常见于断网或代理未启动。',
    ['确认服务器能正常上外网。', '确认代理服务在线且地址配置正确。']
  ),
  GITHUB_RETRY_BACKOFF: entry(
    'GitHub 检查正在退避重试中',
    '上一次检查失败后系统进入了短暂退避期，避免持续冲击对方接口。',
    ['稍等一会儿再点击"检查更新"。']
  ),

  // ── 备份与恢复 ─────────────────────────────────────────
  SYSTEM_BACKUP_ERROR: entry(
    '数据备份或恢复失败',
    '备份、恢复流程中出现错误，具体原因见下方原始信息。',
    ['确认磁盘空间充足。', '重试一次。', '若持续失败，联系维护人员查看业务服务日志。']
  ),
  INVALID_BACKUP_PACKAGE: entry(
    '备份包无效',
    '上传的文件不是系统生成的 .lsbackup 包，或包内容已损坏。',
    ['确认选择的是本系统导出的 .lsbackup 文件。', '重新导出备份后再尝试恢复。']
  ),
  INVALID_BACKUP_DATA: entry(
    '备份数据内容无法解析',
    '备份包里的数据结构不符合预期，可能来自其他版本或文件被改写。',
    ['确认备份包来源版本与当前系统兼容。', '联系维护人员协助恢复。']
  ),
  RESTORE_SESSION_EXPIRED: entry(
    '恢复会话已过期',
    '恢复流程的会话超过有效时限，需要重新上传备份包。',
    ['重新选择备份文件并再次开始恢复。']
  ),
  UNKNOWN_MODULE: entry(
    '不支持恢复该模块',
    '备份里包含当前系统不认识的业务模块。',
    ['确认备份包是否来自其他版本。', '联系维护人员确认模块对应关系。']
  ),
  MODULE_NOT_IN_BACKUP: entry(
    '该模块的数据不在备份中',
    '所选模块没有被包含在这个备份包里，无法单独恢复。',
    ['换用包含该模块的备份包。', '或改为恢复整个备份。']
  ),

  // ── 付款凭证识别（OCR）────────────────────────────────
  OCR_NOT_CONFIGURED: entry(
    '尚未配置文字识别服务',
    '付款凭证识别需要百度 OCR 的密钥，当前还没有配置。',
    ['进入"付款凭证打印"页面的设置区填写 OCR 的 API Key 与 Secret Key。', '保存后重新上传图片识别。']
  ),
  OCR_CONFIG_DECRYPT_FAILED: entry(
    'OCR 配置无法解密',
    '保存的 OCR 密钥密文无法用当前密钥解开，通常是本机密钥文件被替换或迁移环境导致。',
    ['重新在本机录入一次 OCR 密钥。', '若仍失败，联系维护人员检查本机密钥文件。']
  ),
  OCR_CONFIG_VERSION_CONFLICT: entry(
    'OCR 配置已被其他人修改',
    '多人同时修改 OCR 配置产生版本冲突，本次保存被拒绝。',
    ['刷新页面，确认最新配置后重新保存。']
  ),
  OCR_CONFIG_VALIDATION_TIMEOUT: entry(
    'OCR 配置校验超时',
    '验证密钥是否可用时超时，通常是网络到百度较慢。',
    ['稍后重新保存配置以再次校验。', '确认服务器能访问百度 OCR 服务。']
  ),
  OCR_NO_TEXT: entry(
    '图片中没有识别到文字',
    '上传的图片过于模糊、过暗，或根本不含票据内容。',
    ['换一张清晰、光线均匀、票据完整的照片重试。', '尽量正对拍摄，避免反光和模糊。']
  ),
  OCR_IMAGE_TOO_LARGE: entry(
    '图片体积过大',
    '上传的图片超过识别服务的大小限制。',
    ['压缩或裁剪图片后重新上传。']
  ),
  OCR_DEADLINE_EXCEEDED: entry(
    '识别耗时超出上限',
    '识别过程超过了允许的总时长，通常是图片复杂或网络较慢。',
    ['重新上传一次。', '换用更清晰、尺寸更小的图片。']
  ),
  OCR_REQUEST_ABORTED: entry(
    '识别请求被中断',
    '识别过程中页面被关闭或请求被取消。',
    ['重新上传图片识别。']
  ),
  OCR_CLIENT_ABORTED: entry(
    '客户端中断了识别过程',
    '识别过程中浏览器端主动取消了本次请求，通常发生在关闭页面、切换页面或重复点击上传时。',
    ['重新上传图片识别。']
  ),
  OCR_HISTORY_PERSIST_FAILED: entry(
    '识别记录保存失败',
    '识别结果没能写入数据库，通常是磁盘或数据库状态异常。',
    ['确认磁盘空间充足。', '重试一次。', '若持续失败，联系维护人员检查数据库。']
  ),
  OCR_USAGE_PERSIST_FAILED: entry(
    '识别用量记录保存失败',
    '统计调用次数的记录写入失败，不影响本次识别结果。',
    ['可忽略；若频繁出现，联系维护人员检查数据库写入。']
  ),
  OCR_USAGE_INVALID: entry(
    '识别用量数据无效',
    '上报识别用量时传入的参数格式不正确（例如月份或条数不是合法数字），本次统计被丢弃。',
    ['刷新页面后重试。', '若持续出现，请联系维护人员。']
  ),
  OCR_BILLING_MONTH_INVALID: entry(
    '统计月份格式无效',
    '查询用量时传入的月份不是 YYYY-MM 格式。',
    ['重新选择月份后再查询。']
  ),
  OCR_BILLING_MONTH_ERROR: entry(
    '统计月份查询失败',
    '按月统计识别用量时数据库查询失败，通常是数据库文件异常或磁盘空间不足。',
    ['重新选择月份查询一次。', '若持续失败，联系维护人员。']
  ),
  OCR_EXPORT_LIMIT_INVALID: entry(
    '导出条数参数无效',
    '导出时指定的条数超出允许范围。',
    ['使用默认导出设置重新导出。']
  ),
  BAIDU_TIMEOUT: entry(
    '百度 OCR 响应超时',
    '请求百度识别服务在限定时间内没有返回。',
    ['稍后重试一次。', '确认服务器到外网连接稳定。']
  ),
  BAIDU_NETWORK_ERROR: entry(
    '无法连接百度 OCR',
    '服务器到百度服务端的网络连接失败。',
    ['确认服务器能访问外网。', '检查防火墙或代理是否拦截了百度域名。']
  ),
  BAIDU_TOKEN_ERROR: entry(
    '百度 OCR 密钥验证失败',
    'API Key 或 Secret Key 不正确，无法换取访问令牌。',
    ['进入付款凭证识别设置，核对 API Key 与 Secret Key。', '确认密钥未被停用或删除。']
  ),
  BAIDU_HTTP_ERROR: entry(
    '百度 OCR 返回错误',
    '百度服务返回了错误状态或错误码，具体原因见原始信息。',
    ['稍后重试一次。', '若提示配额用尽，请续费或更换密钥。', '若持续失败，联系维护人员核对密钥权限。']
  ),
  BAIDU_INVALID_RESPONSE: entry(
    '百度 OCR 返回内容无法解析',
    '百度识别服务返回的数据结构与系统预期不符，可能是对方接口升级或响应被截断。',
    ['稍后重试一次。', '若持续出现，联系维护人员。']
  ),
  BAIDU_RESPONSE_ABORTED: entry(
    '百度 OCR 响应被中断',
    '从百度识别服务读取响应时网络连接被中断，通常与网络抖动或代理不稳定有关。',
    ['重新上传图片识别。']
  ),
  BAIDU_RESPONSE_TOO_LARGE: entry(
    '百度 OCR 响应体积超出限制',
    '返回内容异常偏大，可能是图片过于复杂。',
    ['换用更清晰、更简单的图片重试。']
  ),
  AMOUNT_NOT_FOUND: entry(
    '没有从图片中识别出金额',
    '识别到了文字，但没有找到可判断为付款金额的内容。',
    ['确认图片中包含完整的金额信息。', '换一张更清晰的图片重试。', '必要时手动填写金额。']
  ),
  RECEIPT_OPERATIONS_ACTIVE: entry(
    '凭证识别任务正在进行',
    '当前有正在执行的识别或维护操作，请等待其完成。',
    ['稍等片刻后重试。']
  ),
  RECEIPT_MAINTENANCE_ACTIVE: entry(
    '凭证模块正在维护中',
    '该模块正在进行维护操作，暂时不接受新的请求。',
    ['稍后重试。']
  ),
  INVALID_ENCRYPTION_KEY: entry(
    '本机加密密钥无效',
    '用于加密保存 OCR 密钥的本地密钥格式不正确。',
    ['联系维护人员重新生成本机密钥文件。']
  ),
  INVALID_LOCAL_KEY: entry(
    '本机密钥无效',
    '服务器上存放的本机加密密钥内容不符合要求（长度或编码不正确），无法用于加解密 OCR 密钥。',
    ['联系维护人员重新生成本机密钥。']
  ),
  INVALID_LOCAL_KEY_FILE: entry(
    '本机密钥文件无效',
    '密钥文件不是普通文件或内容损坏。',
    ['联系维护人员重新生成本机密钥。']
  ),
  INVALID_LOCAL_KEY_DIRECTORY: entry(
    '本机密钥目录无效',
    '存放密钥的目录不存在或不是目录。',
    ['联系维护人员确认密钥目录已正确创建。']
  ),
  INSECURE_LOCAL_KEY_MODE: entry(
    '本机密钥文件权限过于开放',
    '密钥文件允许其他账号读取，存在泄露风险，系统拒绝使用。',
    ['联系维护人员把密钥文件权限收紧为仅服务账号可读（0600）。']
  ),
  INSECURE_LOCAL_KEY_DIRECTORY_MODE: entry(
    '本机密钥目录权限过于开放',
    '密钥所在目录允许其他账号访问，存在泄露风险。',
    ['联系维护人员把密钥目录权限收紧为 0700。']
  ),
  LIMIT_FILE_SIZE: entry(
    '上传文件超过大小限制',
    '上传的备份包超过了允许的最大体积（1GB），服务器拒绝接收。',
    [
      '确认选择的是单个 .lsbackup 备份包，而不是整个目录或多个文件。',
      '若备份包确实超过 1GB，联系维护人员在服务器上直接恢复。'
    ]
  ),
  LOCAL_KEY_NOT_FOUND: entry(
    '本机密钥不存在',
    '服务器上还没有生成本机加密密钥，因此无法安全保存 OCR 密钥，需要先完成初始化。',
    ['联系维护人员按部署文档初始化本机密钥。']
  )
})

export function getErrorDocumentation(code) {
  if (typeof code !== 'string' || !code) return FALLBACK
  return ERROR_CATALOG[code] || FALLBACK
}

export function hasErrorDocumentation(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code)
}

// 把任意错误对象整理成前端可直接渲染的结构。
export function describeError(error, fallbackCode = 'UPDATE_FAILED') {
  const raw = error && typeof error === 'object' ? error : {}
  const code = typeof raw.code === 'string' && raw.code ? raw.code : fallbackCode
  const doc = getErrorDocumentation(code)
  const rawMessage = typeof raw.message === 'string' ? raw.message : (typeof error === 'string' ? error : '')
  return {
    code,
    documented: hasErrorDocumentation(code),
    title: doc.title,
    explanation: doc.explanation,
    solutions: [...doc.solutions],
    retryable: doc.retryable,
    severity: doc.severity,
    rawMessage
  }
}
