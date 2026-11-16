import express from 'express';
import { WebSocketServer } from 'ws';
import { DEVICES, DEVICE_STATUS, writeAudit } from './database.js';
import { createRegistrationLock, handleHeartbeat } from './agent-service.js';
import { attachAgent, detachAgent, isAgentOnline, subscribeTask, unsubscribeTask } from './connection-hub.js';
import {
  dispatchPendingCommands,
  markOfflineIfDisconnected,
  recordAgentResult
} from './task-service.js';
import { nowIso, safeText, tokensEqual } from './tokens.js';

const MAX_OUTPUT_CHARS = 100_000;

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = (raw ? String(raw).split(',')[0] : req.socket?.remoteAddress) || '';
  return candidate.replace(/^::ffff:/, '').trim() || null;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function createAgentContractRouter({ enrollSecret, offlineSelfDestructHours = 0 }) {
  const router = express.Router();
  const runLocked = createRegistrationLock();

  // 契约 #1：心跳。四种响应动作 ok / updated / re-enrolled / deleted，失败 401
  router.post('/api/agents/heartbeat', express.json({ limit: '1mb' }), async (req, res) => {
    const payload = req.body ?? {};
    const agentToken = bearerToken(req);
    const headerSecret = String(req.headers['x-enroll-secret'] || '');
    const enrollValid = Boolean(enrollSecret) && tokensEqual(headerSecret, enrollSecret);
    const result = await runLocked(() =>
      handleHeartbeat(req.app.locals.sampleDevicesDb(), {
        payload,
        ip: clientIp(req),
        agentToken,
        enrollValid
      })
    );
    if (result.status === 200 && result.body?.data) {
      result.body.data.offline_selfdestruct_hours = offlineSelfDestructHours;
    }
    res.status(result.status).json(result.body);
  });

  // 契约 #3：Sysprep 后恢复上报
  router.post('/api/agents/recover', express.json({ limit: '256kb' }), (req, res) => {
    const db = req.app.locals.sampleDevicesDb();
    const payload = req.body ?? {};
    const deviceId = Number(payload.device_id);
    if (!Number.isInteger(deviceId)) {
      return res.status(400).json({ code: 1, data: null, msg: '缺少 device_id' });
    }
    const device = db.prepare(`SELECT * FROM ${DEVICES} WHERE id = ?`).get(deviceId);
    if (!device) return res.status(404).json({ code: 1, data: null, msg: '设备不存在' });

    const agentToken = bearerToken(req);
    if (device.token && !tokensEqual(device.token, agentToken)) {
      writeAudit({ action: 'recover.rejected', deviceId, detail: '令牌不一致', sourceIp: clientIp(req) });
      return res.status(401).json({ code: 1, data: null, msg: '设备令牌无效' });
    }

    const assignments = ['status = ?', 'last_heartbeat = ?', 'updated_at = ?'];
    const values = [DEVICE_STATUS.ONLINE, nowIso(), nowIso()];
    const hostname = safeText(payload.hostname, 255);
    if (hostname && !device.hostname_locked) {
      assignments.push('hostname = ?');
      values.push(hostname);
    }
    values.push(deviceId);
    db.prepare(`UPDATE ${DEVICES} SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    return res.json({ code: 0, data: { status: 'recovered', device_id: deviceId }, msg: 'success' });
  });

  router.get('/api/agents/latest', (_req, res) => {
    const db = _req.app.locals.sampleDevicesDb();
    const row = db
      .prepare(`SELECT agent_version FROM ${DEVICES} WHERE deleted_at IS NULL AND agent_version IS NOT NULL
                ORDER BY last_heartbeat DESC LIMIT 1`)
      .get();
    res.set('Cache-Control', 'no-store');
    res.json({ code: 0, data: { version: row?.agent_version ?? null }, msg: 'success' });
  });

  return router;
}

export function createAgentWebSocketServer({ server, getDatabase }) {
  const wss = new WebSocketServer({ noServer: true });

  // ws 在 handleUpgrade 后若无 connection 监听器会立刻关闭连接，必须显式接管。
  wss.on('connection', (ws, request) => {
    const url = new URL(request.url, 'http://localhost');
    const agentMatch = /^\/ws\/agents\/(\d+)$/.exec(url.pathname);
    if (agentMatch) {
      handleAgentConnection(ws, Number(agentMatch[1]));
      return;
    }
    const taskMatch = /^\/ws\/tasks\/(\d+)$/.exec(url.pathname);
    if (taskMatch) {
      const taskId = Number(taskMatch[1]);
      subscribeTask(taskId, ws);
      ws.on('close', () => unsubscribeTask(taskId, ws));
      ws.on('error', () => unsubscribeTask(taskId, ws));
      return;
    }
    ws.close(4000, 'Unknown endpoint');
  });

  server.on('upgrade', (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      return;
    }

    const agentMatch = /^\/ws\/agents\/(\d+)$/.exec(url.pathname);
    const taskMatch = /^\/ws\/tasks\/(\d+)$/.exec(url.pathname);
    if (!agentMatch && !taskMatch) {
      socket.destroy();
      return;
    }

    if (agentMatch) {
      const deviceId = Number(agentMatch[1]);
      const token = url.searchParams.get('token') || '';
      const db = getDatabase();
      const device = db.prepare(`SELECT id, token, deleted_at FROM ${DEVICES} WHERE id = ?`).get(deviceId);
      if (!device || !device.token || !tokensEqual(device.token, token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (device.deleted_at) {
        socket.write('HTTP/1.1 410 Gone\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
      });
      return;
    }

    const taskId = Number(taskMatch[1]);
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });

  function handleAgentConnection(ws, deviceId) {
    const db = getDatabase();
    attachAgent(deviceId, ws);
    db.prepare(`UPDATE ${DEVICES} SET status = ?, last_heartbeat = ?, updated_at = ? WHERE id = ?`)
      .run(DEVICE_STATUS.ONLINE, nowIso(), nowIso(), deviceId);
    dispatchPendingCommands(db, deviceId);

    ws.on('message', raw => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      const commandId = message.command_id ?? message.id;
      if (!commandId) return;
      recordAgentResult(db, {
        deviceId,
        commandId,
        status: message.status ?? 'unknown',
        output: message.output
      });
    });

    ws.on('close', () => {
      const stillOnline = detachAgent(deviceId, ws);
      if (!stillOnline) {
        // 契约 #5：仅在没有任何活跃连接时才标记离线
        markOfflineIfDisconnected(db, deviceId);
      }
    });
    ws.on('error', () => {});
  }

  return wss;
}

export { isAgentOnline, MAX_OUTPUT_CHARS };
