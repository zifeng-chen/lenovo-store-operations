import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildZip } from './zip-writer.js';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const UPLOAD_KEEP = 20;

const DEPLOY_README = `========================================
  LAN Agent 安装使用指南（联想门店运营系统 · 样机设备管理）
========================================

【安装步骤】

1. 解压本压缩包到目标电脑的任意位置（deploy.conf 必须与 bat 在同一目录）
2. 右键点击 reinstall.bat → 以管理员身份运行
3. 脚本依次显示 权限检查 / 找到 LanAgent.exe / 停止旧服务 / 复制文件 / 安装启动
4. 看到「安装成功！服务正在运行」即完成
5. 管理端约 10 秒内可见该设备上线

【已安装旧版本的升级方式】

方式一（推荐，无需卸载）：
  右键点击 reinstall.bat → 以管理员身份运行
  脚本会自动停止旧服务、等待其完全退出、替换文件并启动新服务。

方式二（等同方式一，便于命令行执行）：
  以管理员身份打开命令提示符，进入本压缩包的解压目录，执行：
  LanAgent.exe /silent
  该命令读取同目录的 deploy.conf 完成安装，不会清理桌面密码。

【卸载步骤】

1. 右键点击 uninstall.bat → 以管理员身份运行
2. 等待显示卸载完成

【密码被改、登录提示「密码不正确」的修复】

若机器执行过旧版 Sysprep 后无法登录，用已知密码进入桌面后：

1. 右键点击 reset-password.bat → 以管理员身份运行
2. 输入 Y 确认
3. 显示「密码已清空」后重启，即可空密码直接进桌面

该脚本只清空当前登录账户的密码，不影响其他账户。

【注意事项】

- 必须以管理员身份运行，否则安装会失败
- 同一个安装包可以安装到任意多台设备
- 安装后服务开机自启，无需手动操作
- 覆盖安装会自动停止旧服务、替换文件、重启服务
- deploy.conf 文件不要删除，服务运行需要读取该文件
- deploy.conf 内含注册密钥，请勿外传；管理端更换密钥后需重新生成安装包

========================================
`;

const UNINSTALL_BAT = [
  '@echo off',
  'title LAN Agent Uninstall',
  'net session >nul 2>&1',
  'if %ERRORLEVEL% neq 0 (',
  '    echo [ERROR] Please run as Administrator!',
  '    pause',
  '    exit /b 1',
  ')',
  '"C:\\Windows\\LanAgent\\LanAgent.exe" /uninstall',
  'echo Uninstall complete',
  'pause',
  ''
].join('\r\n');

export function detectLanIp() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

export function resolveServerUrl(req, fallbackPort) {
  const host = String(req.headers.host || `localhost:${fallbackPort}`);
  const [hostname, port = String(fallbackPort)] = host.split(':');
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const lanIp = detectLanIp();
    if (!lanIp) throw new Error('无法检测宿主机局域网 IP，请改用局域网 IP 访问管理端后重试');
    return { serverUrl: `http://${lanIp}:${port}`, port };
  }
  return { serverUrl: `http://${host}`, port };
}

// 部署包里的 Agent 要连的是 Agent 契约端口（8080），不是浏览器访问的管理端端口（8900）。
// 沿用 Host 头的主机名，仅把端口换成 Agent 端口。
export function resolveAgentServerUrl(req, agentPort, fallbackPort) {
  const host = String(req.headers.host || `localhost:${fallbackPort}`);
  const [hostname] = host.split(':');
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const lanIp = detectLanIp();
    if (!lanIp) throw new Error('无法检测宿主机局域网 IP，请改用局域网 IP 访问管理端后重试');
    return { serverUrl: `http://${lanIp}:${agentPort}`, port: String(agentPort) };
  }
  return { serverUrl: `http://${hostname}:${agentPort}`, port: String(agentPort) };
}

export function isPortableExecutable(buffer) {
  if (!buffer || buffer.length < 0x40) return false;
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) return false;
  const offset = buffer.readUInt32LE(0x3c);
  if (offset + 4 > buffer.length) return false;
  return buffer.subarray(offset, offset + 4).toString('latin1') === 'PE\u0000\u0000';
}

export function extractBuildVersion(buffer) {
  const text = buffer.toString('latin1');
  const match = /buildVersion=(\d+\.\d+\.\d+)/.exec(text);
  return match ? match[1] : null;
}

export function createUploadStore({ uploadDir, agentExePath, installerDir }) {
  fs.mkdirSync(uploadDir, { recursive: true });

  function cleanup(keep = UPLOAD_KEEP) {
    let names;
    try {
      names = fs.readdirSync(uploadDir);
    } catch {
      return;
    }
    const entries = names
      .map(name => path.join(uploadDir, name))
      .filter(filePath => fs.statSync(filePath).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const filePath of entries.slice(keep)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // 清理失败不影响主流程
      }
    }
  }

  function list() {
    try {
      return fs.readdirSync(uploadDir)
        .map(name => {
          const filePath = path.join(uploadDir, name);
          const stat = fs.statSync(filePath);
          return { filename: name, size: stat.size, modified_at: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.modified_at.localeCompare(a.modified_at));
    } catch {
      return [];
    }
  }

  function resolve(filename) {
    const base = path.basename(String(filename ?? ''));
    if (!base || base !== String(filename)) return null;
    const target = path.resolve(uploadDir, base);
    if (!target.startsWith(path.resolve(uploadDir) + path.sep)) return null;
    return fs.existsSync(target) ? target : null;
  }

  function saveExe(buffer) {
    const filename = `agent-${randomUUID().slice(0, 8)}.exe`;
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    cleanup();
    return filename;
  }

  function saveFile(buffer, originalName) {
    const safeName = String(originalName ?? 'file').replace(/[/\\]/g, '_');
    const filename = `file-${randomUUID().slice(0, 8)}-${safeName}`;
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    cleanup();
    return { filename, original_name: safeName };
  }

  function latestAgent() {
    if (!fs.existsSync(agentExePath)) return null;
    const stat = fs.statSync(agentExePath);
    const buffer = fs.readFileSync(agentExePath);
    return {
      path: agentExePath,
      size: stat.size,
      version: extractBuildVersion(buffer)
    };
  }

  function buildPackage(serverUrl, enrollSecret) {
    if (!fs.existsSync(agentExePath)) throw new Error('服务器上未找到 LanAgent.exe');
    const entries = [
      { name: 'LanAgent.exe', data: fs.readFileSync(agentExePath) },
      { name: 'deploy.conf', data: `# LAN Agent deploy config\nserver=${serverUrl}\nenroll=${enrollSecret}\n` },
      {
        name: '安装请阅读此文档.txt',
        data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(DEPLOY_README, 'utf8')])
      },
      { name: 'uninstall.bat', data: Buffer.from(UNINSTALL_BAT, 'ascii') }
    ];
    for (const name of ['reinstall.bat', 'reset-password.bat']) {
      const source = path.join(installerDir, name);
      if (!fs.existsSync(source)) continue;
      const normalized = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      entries.push({ name, data: Buffer.from(normalized, 'utf8') });
    }
    return buildZip(entries);
  }

  return { cleanup, list, resolve, saveExe, saveFile, latestAgent, buildPackage, uploadDir };
}
