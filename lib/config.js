const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'compare.config.json');

/**
 * Loads and validates compare.config.json — the single place that says which
 * app versions (boilerplate checkouts + ports) and which backend env to compare.
 * Edit that file to change what gets compared; nothing else needs to change.
 */
function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);

  if (!config.env || typeof config.env !== 'string') {
    throw new Error(`compare.config.json: "env" must be a non-empty string (e.g. "de", "pe").`);
  }
  if (!Array.isArray(config.versions) || config.versions.length < 2) {
    throw new Error('compare.config.json: "versions" must list at least 2 entries to compare.');
  }
  if (config.device !== undefined) {
    if (!config.device || config.device.id == null || config.device.type == null) {
      throw new Error('compare.config.json: "device" must be {"id": "...", "type": ...} when present (this pins the same user/session on both versions via ?did=&dtype=).');
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      'compare.config.json: no "device" configured — each version falls back to its own default ' +
      'device id for this env, which may belong to a different user/session and make the comparison unfair. ' +
      'Set "device": {"id": "...", "type": ...} to pin the same user on both versions.'
    );
  }

  const seenPorts = new Set();
  const seenNames = new Set();
  for (const version of config.versions) {
    if (!version.name || !version.path || !version.port) {
      throw new Error(`compare.config.json: each version needs "name", "path" and "port". Got: ${JSON.stringify(version)}`);
    }
    if (seenPorts.has(version.port)) {
      throw new Error(`compare.config.json: duplicate port ${version.port} across versions.`);
    }
    if (seenNames.has(version.name)) {
      throw new Error(`compare.config.json: duplicate version name "${version.name}".`);
    }
    seenPorts.add(version.port);
    seenNames.add(version.name);

    const absPath = path.resolve(path.dirname(CONFIG_PATH), version.path);
    if (!fs.existsSync(absPath)) {
      throw new Error(`compare.config.json: version "${version.name}" points at "${version.path}" (resolved to ${absPath}), which does not exist.`);
    }
  }

  return config;
}

/** All unique unordered pairs of versions, e.g. [[26.1,26.6],[26.1,27.0],[26.6,27.0]]. */
function pairwiseVersions(versions) {
  const pairs = [];
  for (let i = 0; i < versions.length; i++) {
    for (let j = i + 1; j < versions.length; j++) {
      pairs.push([versions[i], versions[j]]);
    }
  }
  return pairs;
}

/**
 * Builds the URL to open a given version at, pinning the same backend env
 * and (when configured) the same device id/type — the device id is what
 * ties the session to a user/account on this backend, so pinning it is what
 * makes "same env" also mean "same user" across versions.
 */
function buildAppUrl(version, config) {
  const params = new URLSearchParams({env: config.env});
  if (config.device) {
    params.set('did', config.device.id);
    params.set('dtype', String(config.device.type));
  }
  // devServer.sh only serves HTTPS when the port is literally 443 (see C:\dev\CLAUDE.md gotcha #9);
  // every other port is plain HTTP.
  const protocol = Number(version.port) === 443 ? 'https' : 'http';
  return `${protocol}://localhost:${version.port}/?${params.toString()}`;
}

module.exports = {loadConfig, pairwiseVersions, buildAppUrl, CONFIG_PATH};
