/**
 * Minimal AgentsTalk hub client (send + poll over plain HTTP), used only as an optional,
 * more-reliable alternative to keyboard-simulated navigation for app versions that expose
 * agentBridge (~26.6+). Not a dependency of stv-compare's core flow -- every call site falls
 * back to keyboard simulation when the hub isn't reachable, so `npm test` keeps working
 * standalone for anyone who hasn't launched a hub.
 */

let _msgCounter = 0;
function _nextId() {
  _msgCounter += 1;
  return `stv-compare-${Date.now()}-${_msgCounter}`;
}

/**
 * Sends one command to an agentBridge-connected app instance and waits for its reply.
 * @param {Object} opts
 * @param {string} [opts.hubUrl] AgentsTalk hub base URL.
 * @param {string} [opts.agentName] Hub name the app registered as (fixed 'stv-app' unless
 *   AGENTSTALK_NAME was overridden at launch).
 * @param {string} [opts.from] Our own hub name for this call.
 * @param {string} cmd agentBridge command name (e.g. 'navigate', 'getRoute').
 * @param {Object} [args] Command arguments.
 * @param {number} [timeoutMs] Give up waiting for a reply after this long.
 * @returns {Promise<any>} The command's `result` on success.
 * @throws If the hub/agent is unreachable, or the command errors.
 */
async function callAgentBridge(cmd, args, opts = {}) {
  const {
    hubUrl = 'http://localhost:8765',
    agentName = 'stv-app',
    from = 'stv-compare',
    timeoutMs = 8000,
  } = opts;

  const id = _nextId();
  const content = JSON.stringify({v: 1, id, cmd, args});

  const sendController = new AbortController();
  const sendTimeout = setTimeout(() => sendController.abort(), timeoutMs);
  try {
    const sendRes = await fetch(`${hubUrl}/send`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({from, to: agentName, content}),
      signal: sendController.signal,
    });
    if (!sendRes.ok) {
      throw new Error(`hub /send returned ${sendRes.status}`);
    }
  } finally {
    clearTimeout(sendTimeout);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingS = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    const pollController = new AbortController();
    const pollTimeout = setTimeout(() => pollController.abort(), (remainingS + 2) * 1000);
    let messages;
    try {
      const pollRes = await fetch(
        `${hubUrl}/poll?name=${encodeURIComponent(from)}&wait=${remainingS}`,
        {signal: pollController.signal},
      );
      messages = await pollRes.json();
    } finally {
      clearTimeout(pollTimeout);
    }

    for (const msg of messages || []) {
      let parsed;
      try {
        parsed = JSON.parse(msg.content);
      } catch (e) {
        continue;
      }
      if (parsed.id !== id) {
        continue; // a reply to some other in-flight call, or an announce broadcast
      }
      if (parsed.ok) {
        return parsed.result;
      }
      throw new Error(`agentBridge command "${cmd}" failed: ${parsed.error || 'unknown error'}`);
    }
  }

  throw new Error(`Timed out waiting for agentBridge reply to "${cmd}" from "${agentName}".`);
}

/** True if a hub is reachable and `agentName` is currently registered on it. */
async function isAgentBridgeAvailable(opts = {}) {
  const {hubUrl = 'http://localhost:8765', agentName = 'stv-app'} = opts;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${hubUrl}/who`, {signal: controller.signal});
      if (!res.ok) return false;
      const data = await res.json();
      return Array.isArray(data.online) && data.online.includes(agentName);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    return false;
  }
}

module.exports = {callAgentBridge, isAgentBridgeAvailable};
