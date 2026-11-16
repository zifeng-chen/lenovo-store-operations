const agents = new Map();
const taskSubscribers = new Map();

const key = (id) => String(id);

export function attachAgent(deviceId, socket) {
  const id = key(deviceId);
  const previous = agents.get(id);
  if (previous && previous !== socket) {
    try {
      previous.close(4002, 'Replaced by newer connection');
    } catch {
      // 旧连接可能已断开，忽略
    }
  }
  agents.set(id, socket);
}

export function detachAgent(deviceId, socket) {
  if (agents.get(key(deviceId)) === socket) agents.delete(key(deviceId));
  return isAgentOnline(deviceId);
}

export function isAgentOnline(deviceId) {
  return agents.has(key(deviceId));
}

export function onlineAgentIds() {
  return [...agents.keys()];
}

export function sendCommand(deviceId, command) {
  const socket = agents.get(key(deviceId));
  if (!socket || socket.readyState !== 1) return false;
  try {
    // Agent 侧按小写动作名分发（sysprep/shutdown/...），库里存的是大写任务类型，这里统一转换。
    const payload = command?.action ? { ...command, action: String(command.action).toLowerCase() } : command;
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function subscribeTask(taskId, socket) {
  const id = key(taskId);
  if (!taskSubscribers.has(id)) taskSubscribers.set(id, new Set());
  taskSubscribers.get(id).add(socket);
}

export function unsubscribeTask(taskId, socket) {
  const set = taskSubscribers.get(key(taskId));
  if (!set) return;
  set.delete(socket);
  if (!set.size) taskSubscribers.delete(key(taskId));
}

export function broadcastTaskUpdate(taskId, payload) {
  const set = taskSubscribers.get(key(taskId));
  if (!set?.size) return;
  const text = JSON.stringify(payload);
  for (const socket of [...set]) {
    try {
      if (socket.readyState === 1) socket.send(text);
      else set.delete(socket);
    } catch {
      set.delete(socket);
    }
  }
}
