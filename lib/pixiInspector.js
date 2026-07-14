/**
 * Generic Pixi-stage inspector for this app.
 *
 * The whole UI renders to a WebGL/Pixi canvas (no real DOM for on-screen
 * content), so normal Playwright DOM queries don't work. Every Pixi
 * DisplayObject created by the app's `createGui()` helper gets a back
 * reference `displayObject.uicParent` pointing at the owning UIC component
 * instance (see stv-core `src/util/uicHelper.js`), and each component class
 * exposes a static `tagName` plus, for data-bound components, an `item`
 * prop holding its data model. That's enough to read any component's data
 * straight off the live instance, without touching pixels or the DOM.
 *
 * `window.__PIXI_APP__` is only set when the build has `DEBUG` on, which
 * `devServerLocal` always does (`devServer.sh` hardcodes `KEEP_LOG=true`).
 */

/**
 * Runs inside the browser via `page.evaluate(collectComponentsByTagNameInBrowser, tagNames)`.
 * Walks the full Pixi stage and returns one entry per distinct component
 * instance whose `constructor.tagName` is in `tagNames`.
 * @param {string[]} tagNames
 * @returns {Array<{tagName: string, uid: string, item: object|null, isFocused: boolean}>}
 */
function collectComponentsByTagNameInBrowser(tagNames) {
  const app = window.__PIXI_APP__;
  if (!app || !app.stage) {
    return [];
  }

  const tagSet = new Set(tagNames);
  const seenComponents = new Set();
  const results = [];

  (function visit(node) {
    if (!node) {
      return;
    }

    const owner = node.uicParent;
    if (owner && !seenComponents.has(owner)) {
      const tagName = owner.constructor && owner.constructor.tagName;
      if (tagName && tagSet.has(tagName)) {
        seenComponents.add(owner);
        results.push({
          tagName,
          uid: owner.UID || null,
          item: owner.item || null,
          isFocused: !!owner.isFocused,
        });
      }
    }

    const children = node.children;
    if (children && children.length) {
      for (let i = 0; i < children.length; i++) {
        visit(children[i]);
      }
    }
  })(app.stage);

  return results;
}

/**
 * Runs inside the browser via `page.evaluate(collectComponentPropInBrowser, [tagName, propName])`.
 * Finds the first mounted component instance whose `constructor.tagName` matches and returns the
 * named property read directly off that instance (not off `.item` -- for components like
 * `uic-home-header`, whose `mainMenuItems` array is its own top-level prop rather than nested
 * under a generic `item`, unlike the rail/card components `collectComponentsByTagNameInBrowser`
 * was built for).
 * @param {[string, string]} args
 * @returns {*} the prop's value, or null if no matching component is mounted
 */
function collectComponentPropInBrowser([tagName, propName]) {
  const app = window.__PIXI_APP__;
  if (!app || !app.stage) {
    return null;
  }

  let found;
  (function visit(node) {
    if (!node || found !== undefined) {
      return;
    }

    const owner = node.uicParent;
    if (owner && owner.constructor && owner.constructor.tagName === tagName) {
      found = owner[propName];
      return;
    }

    const children = node.children;
    if (children && children.length) {
      for (let i = 0; i < children.length; i++) {
        visit(children[i]);
      }
    }
  })(app.stage);

  return found !== undefined ? found : null;
}

/**
 * Polls the stage until at least one component matching `tagNames` mounts,
 * or the timeout elapses (returns whatever was found, possibly empty).
 * Screens can take a moment to render after a navigation (network fetch,
 * loading spinner), so a single evaluate() right after goto()/keypress
 * often sees nothing yet.
 */
async function waitForComponents(page, tagNames, {timeoutMs = 20000, intervalMs = 500} = {}) {
  const deadline = Date.now() + timeoutMs;
  let components = await page.evaluate(collectComponentsByTagNameInBrowser, tagNames);
  while (!components.length && Date.now() < deadline) {
    await page.waitForTimeout(intervalMs);
    components = await page.evaluate(collectComponentsByTagNameInBrowser, tagNames);
  }
  return components;
}

/**
 * Tag names of the components that render one content rail ("tira").
 * 26.1 renders every rail through one generic component; 26.6 introduced
 * per-layout carousel components behind a recycling `uic-carousel-proxy`
 * (the proxy is the stable per-slot container, so we read from it rather
 * than the specific carousel it currently wraps — the proxy caches/reuses
 * hidden carousel instances internally, which would otherwise risk double
 * counting or reading stale off-screen data).
 */
const RAIL_TAG_NAMES = ['uic-pivot-grid-row', 'uic-carousel-proxy'];

module.exports = {
  collectComponentsByTagNameInBrowser,
  collectComponentPropInBrowser,
  waitForComponents,
  RAIL_TAG_NAMES,
};
