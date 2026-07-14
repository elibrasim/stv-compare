// @ts-check
const path = require('path');
const {defineConfig} = require('@playwright/test');
const {loadConfig} = require('./lib/config');

const config = loadConfig();

module.exports = defineConfig({
  testDir: './tests',
  timeout: 5 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', {open: 'never'}]],
  use: {
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  // reuseExistingServer: true means Playwright only runs `command` if nothing already answers at
  // `url`. All of today's versions are expected to already be running (launched manually per
  // C:\dev\CLAUDE.md's standard launch sequence), so this just attaches to them.
  webServer: config.versions.map((/** @type {{name: string, path: string, port: number}} */ version) => {
    // devServer.sh only serves HTTPS when the port is literally 443; every other port is HTTP.
    const protocol = Number(version.port) === 443 ? 'https' : 'http';
    return {
      command: `PATH="$(pwd)/node_modules/.bin:$PATH" bash ../${path.basename(version.path).replace('stv-boilerplate', 'stv-core')}/scripts/devices/devServer.sh --device-family ott --country-codes ${config.env} --config webpack.config.local.dev.js --themes graphene,polaris --theme polaris --port ${version.port}`,
      cwd: version.path,
      url: `${protocol}://localhost:${version.port}`,
      // The readiness probe Playwright uses to decide whether to reuse an existing server does its
      // own HTTPS request and does NOT inherit `use.ignoreHTTPSErrors` — without this, it fails the
      // self-signed cert on port 443, concludes nothing is running, and tries (and fails) to spawn a
      // second server on the same already-occupied port.
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 5 * 60 * 1000,
      stdout: 'pipe',
      stderr: 'pipe',
    };
  }),
});
