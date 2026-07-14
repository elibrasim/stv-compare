#!/usr/bin/env node
/**
 * pretest hook (runs automatically before `npm test`, see package.json).
 *
 * Playwright's webServer.reuseExistingServer decides "already running" purely by whether the
 * configured port is listening — it doesn't check whether the process behind it actually answers
 * HTTP requests. A devServer.sh process can stay alive and bound to the port while its webpack
 * compile is hung/crashed (see C:\dev\CLAUDE.md gotcha #14), in which case Playwright's readiness
 * probe blocks for the full 5-minute webServer timeout instead of failing fast.
 *
 * For each configured version's port: if nothing is listening, leave it (Playwright will spawn a
 * fresh server). If something is listening AND responds to an HTTP(S) request, leave it (Playwright
 * will reuse it). If something is listening but does NOT respond within PROBE_TIMEOUT_MS, treat it
 * as stale and kill the owning process(es) so Playwright starts a clean one instead of hanging.
 */
const http = require('http');
const https = require('https');
const {execSync} = require('child_process');
const {loadConfig} = require('../lib/config');

const PROBE_TIMEOUT_MS = 8000;

/** @returns {string[]} PIDs currently LISTENING on `port`, per `netstat -ano`. */
function findListeningPids(port) {
  let out;
  try {
    out = execSync('netstat -ano', {encoding: 'utf8'});
  } catch (err) {
    console.warn(`[kill-stale-ports] netstat failed, skipping stale-port check for port ${port}: ${err.message}`);
    return [];
  }
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (!line.includes('LISTENING')) continue;
    const match = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (match && Number(match[1]) === Number(port)) {
      pids.add(match[2]);
    }
  }
  return [...pids];
}

/** @returns {Promise<boolean>} whether `url` answered (any status) within PROBE_TIMEOUT_MS. */
function probe(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS}, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function main() {
  const config = loadConfig();
  for (const version of config.versions) {
    const port = version.port;
    const pids = findListeningPids(port);
    if (pids.length === 0) {
      console.log(`[kill-stale-ports] ${version.name} (port ${port}): nothing listening — Playwright will start a fresh server.`);
      continue;
    }

    const protocol = Number(port) === 443 ? 'https' : 'http';
    const url = `${protocol}://localhost:${port}/`;
    console.log(`[kill-stale-ports] ${version.name} (port ${port}): pid(s) ${pids.join(',')} listening, probing ${url}...`);
    const responded = await probe(url);
    if (responded) {
      console.log(`[kill-stale-ports] ${version.name} (port ${port}): responded — Playwright will reuse it.`);
      continue;
    }

    console.warn(`[kill-stale-ports] ${version.name} (port ${port}): listening but did not respond within ${PROBE_TIMEOUT_MS}ms — stale, killing pid(s) ${pids.join(',')}.`);
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, {stdio: 'ignore'});
        console.warn(`[kill-stale-ports] killed pid ${pid}.`);
      } catch (err) {
        console.warn(`[kill-stale-ports] failed to kill pid ${pid} (may have already exited): ${err.message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('[kill-stale-ports] failed:', err);
  process.exit(1);
});
