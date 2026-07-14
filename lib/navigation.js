const {collectComponentsByTagNameInBrowser, collectComponentPropInBrowser, waitForComponents, RAIL_TAG_NAMES} = require('./pixiInspector');

/**
 * Presses the Back key (Z, mapped to Key.BACK in KeyMap.js -- not Home/Escape, which navigate
 * away instead of just closing whatever's on top). Confirmed empirically safe as a no-op: pressed
 * on Home with nothing open, focus and URL are unchanged. Used to clear interstitial dialogs/nudges
 * (e.g. a "recording storage low" notification on a real account with DVR usage) that silently
 * swallow all further ArrowDown presses -- collectAllRailNames would otherwise mistake that for
 * "reached the end" and stop far short of the real last rail. Some of these nudges don't render as
 * part of window.__PIXI_APP__.stage at all (confirmed by full-tree inspection while one was visible
 * on screen) and never appear in the a11y tree either, so they can't be reliably detected up front --
 * pressing Back speculatively on every idle attempt is the only mechanism that reaches them.
 */
async function pressBack(page) {
  await page.keyboard.press('z');
}

/** Route path only (e.g. '#/mycollections'), ignoring the query string. */
async function currentRoute(page) {
  return page.evaluate(() => window.location.hash.split('?')[0]);
}

/** ~26.1-style vertical main menu, reached with ArrowLeft from content. */
const MENU_TAG_OLD = 'uic-image-menu-item';

/**
 * Reads the old-style side menu's items in on-screen order (top to bottom), by internal
 * `item.id` (e.g. 'MyContent', 'Home') rather than by display name -- the built-in entries
 * (Search, Home, OnNowGuide, MyContent, MyAccount) have no `item.name`/i18n label of their
 * own, only this stable id, while the backend-driven entries (Mediathek, Videothek...) have both.
 */
async function snapshotMenuItems(page) {
  const components = await page.evaluate(collectComponentsByTagNameInBrowser, [MENU_TAG_OLD]);
  return components.map((c) => ({id: (c.item || {}).id, isFocused: c.isFocused}));
}

/**
 * Moves focus into the old-style vertical side menu (ArrowLeft from content) and down/up to
 * the item whose `item.id` matches `targetId`, then presses Enter. Same defensive-Back pattern
 * as collectAllRailNames: an idle press (menu selection unchanged) presses Back before retrying,
 * in case an interstitial dialog/nudge is eating the arrow key.
 * @param {Object} opts
 * @param {number} [opts.menuWaitMs] How long to wait for the menu itself to mount, separate from
 *   initialWaitMs (which waits for content rails) -- pass a short value when using this to probe
 *   whether the old-style menu exists at all (e.g. from navigateToMyContents), so a version that
 *   doesn't have it (the menu itself never materializes) fails fast instead of waiting the full
 *   default.
 */
async function navigateToMenuItem(page, targetId, opts = {}) {
  const {keyDelayMs = 500, maxAttemptsPerStep = 4, initialWaitMs = 25000, menuWaitMs = initialWaitMs} = opts;

  // The caller may have just landed on Home (e.g. right after selectProfile), which needs a
  // moment to mount before anything (menu included) exists -- wait for the content rails first
  // (mirrors collectAllRailNames's own initial wait). The menu items themselves only seem to
  // materialize once ArrowLeft moves focus into that section, so poll for them *after* pressing
  // it rather than before, which would otherwise time out against a component that never mounts.
  await waitForComponents(page, RAIL_TAG_NAMES, {timeoutMs: initialWaitMs});
  await page.keyboard.press('ArrowLeft');
  await waitForComponents(page, [MENU_TAG_OLD], {timeoutMs: menuWaitMs});
  await page.waitForTimeout(keyDelayMs);

  let items = await snapshotMenuItems(page);
  const targetIndex = items.findIndex((it) => it.id === targetId);
  if (targetIndex === -1) {
    throw new Error(`Menu item "${targetId}" not found. Items on screen: ${items.map((it) => it.id).join(', ') || '(ninguno)'}`);
  }

  let currentIndex = items.findIndex((it) => it.isFocused);
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  const key = targetIndex > currentIndex ? 'ArrowDown' : 'ArrowUp';
  const stepsNeeded = Math.abs(targetIndex - currentIndex);
  for (let step = 0; step < stepsNeeded; step++) {
    for (let attempt = 0; attempt < maxAttemptsPerStep; attempt++) {
      const before = JSON.stringify(await snapshotMenuItems(page));
      await page.keyboard.press(key);
      await page.waitForTimeout(keyDelayMs);
      const after = JSON.stringify(await snapshotMenuItems(page));
      if (after !== before) {
        break;
      }
      await page.keyboard.press('z');
      await page.waitForTimeout(keyDelayMs);
    }
  }

  await page.keyboard.press('Enter');
}

/**
 * Navigates from Home to "Meine Inhalte" (the my-content categories screen: Verfügbare
 * Aufnahmen, Meine Liste, Du schaust gerade...), trying each known app version's layout:
 *  - ~26.1: a dedicated entry (fixed `item.id` 'MyContent') in the vertical main menu.
 *  - ~26.6: the main menu is a horizontal top bar with no such entry at all -- instead it's the
 *    first item ("Mein o2 TV") of the profile/avatar dropdown. Reaching it takes ArrowUp (focuses
 *    the avatar and opens the dropdown), then ArrowLeft, ArrowLeft, ArrowDown, Enter -- captured
 *    by recording a real keydown/focus timeline while driving it by hand (the two ArrowLefts are
 *    easy to miss blind-guessing the sequence, which is what earlier attempts here did; without
 *    them the dropdown never gets past the avatar itself).
 * Both paths finish with Enter, landing on the categories screen (route differs too: 26.1's is
 * `/mycollections`, 26.6's is `/collections` -- callers should match on rail content, not route).
 */
/** ~26.6-style horizontal top-bar menu -- always mounted from Home's first render, unlike
 * MENU_TAG_OLD which only materializes once ArrowLeft focuses that section. Its presence (or
 * absence) is used as a non-destructive version signal: checking for it costs no keypresses,
 * unlike actually trying the old-style menu first and catching failure, which left focus wherever
 * that attempt's ArrowLeft happened to land and made the fallback path unreliable. */
const MENU_TAG_NEW = 'uic-new-menu-item';

/** Container component (~26.6) whose `mainMenuItems` prop already holds the full top-bar
 * menu array in real screen order (UICHomeHeader.js:97-100/706-722) -- a top-level component
 * property, not nested under `.item` like the rail/card components, hence the dedicated
 * collectComponentPropInBrowser reader instead of collectComponentsByTagNameInBrowser. */
const HOME_HEADER_TAG = 'uic-home-header';

/**
 * Resolves a menu item's display label the same way the app itself does (see
 * getItemTranslatedName in stv-core/src/util/object.js: name -> i18name -> id) without actually
 * invoking the app's i18n translator -- comparing the untranslated key is just as valid for a
 * diff and avoids depending on which locale happens to be loaded. An icon-only ~26.6 item
 * (item.iconUrl set, no name/i18name -- see UICNewMenuItem.js's getName()) renders no visible
 * text at all, so its icon URL is used as the label instead, so it still shows up in a diff
 * rather than comparing as an indistinguishable empty string.
 *
 * Known caveat (confirmed env=de): ~26.1's built-in items (Search/Home/OnNowGuide/MyContent/
 * MyAccount) carry no `name`/`i18name` at all -- only `id` -- so they fall back to that raw,
 * untranslated id here, while ~26.6's equivalent entries arrive pre-translated in `name` straight
 * from the backend (gvp.screens.home.fetchHomeMenus). A diff on e.g. "Search" vs "Suche" is that
 * representation gap, not necessarily a removed/renamed menu entry -- read those pairs by
 * position/meaning, not as a real content mismatch.
 */
function menuItemLabel(item) {
  if (!item) {
    return '';
  }
  if (item.iconUrl && !item.name && !item.i18name) {
    return `icon:${item.iconUrl}`;
  }
  return item.name || item.i18name || item.id || '';
}

/**
 * Reads the app's main menu, in genuine on-screen order, for whichever generation is running:
 *  - ~26.6: the horizontal top bar. `uic-home-header`'s `mainMenuItems` prop already holds the
 *    full array in real screen order -- no keypresses needed.
 *  - ~26.1: the vertical side menu (MENU_TAG_OLD), which only materializes once ArrowLeft moves
 *    focus into it. Unlike content rails, this component's `isFocused` never turns true here --
 *    confirmed empirically (env=de): it stays `false` on every item both right after ArrowLeft and
 *    after repeated ArrowDown presses, so there's no focus signal to walk with (the keyboard still
 *    visibly moves a selection ring on screen; the component instances just don't expose it via
 *    `isFocused`). Falling back to plain tree-traversal order instead -- confirmed correct for this
 *    screen's actual sizes (top section maxes out around 8 items, bottom section is a fixed
 *    2-item list) where nothing scrolls/recycles, same reasoning as the "top list ≤8, no scroll"
 *    case noted for the equivalent rail-recycling risk. A country config large enough to make the
 *    top section scroll would reintroduce that risk; no such case is in scope today.
 */
async function collectMainMenuItems(page, opts = {}) {
  const {keyDelayMs = 500, menuWaitMs = 25000} = opts;

  // The caller may have just landed on Home (e.g. right after selectProfile), which needs a
  // moment to mount before anything -- including the top bar or the side menu -- reliably exists.
  await waitForComponents(page, RAIL_TAG_NAMES, {timeoutMs: menuWaitMs});

  const hasNewMenu = (await page.evaluate(collectComponentsByTagNameInBrowser, [MENU_TAG_NEW])).length > 0;
  if (hasNewMenu) {
    const mainMenuItems = await page.evaluate(collectComponentPropInBrowser, [HOME_HEADER_TAG, 'mainMenuItems']);
    return (mainMenuItems || []).map(menuItemLabel);
  }

  await page.keyboard.press('ArrowLeft');
  await waitForComponents(page, [MENU_TAG_OLD], {timeoutMs: menuWaitMs});
  await page.waitForTimeout(keyDelayMs);

  const components = await page.evaluate(collectComponentsByTagNameInBrowser, [MENU_TAG_OLD]);
  return components.map((c) => menuItemLabel(c.item));
}

async function navigateToMyContents(page, opts = {}) {
  const {keyDelayMs = 600, initialWaitMs = 25000, maxAttempts = 4} = opts;

  await waitForComponents(page, RAIL_TAG_NAMES, {timeoutMs: initialWaitMs});
  const hasNewMenu = (await page.evaluate(collectComponentsByTagNameInBrowser, [MENU_TAG_NEW])).length > 0;

  if (!hasNewMenu) {
    // Same defensive retry as the ~26.6 path below: a stray interstitial dialog can eat the Enter
    // meant for the menu selection (or one of the ArrowDown steps within navigateToMenuItem),
    // leaving us still on Home with no error thrown -- confirmed happening under the real test's
    // concurrent-context load even though isolated runs of this same call were reliable.
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await navigateToMenuItem(page, 'MyContent', {keyDelayMs, initialWaitMs});
      await page.waitForTimeout(keyDelayMs);
      if ((await currentRoute(page)) === '#/mycollections') {
        return;
      }
      await page.keyboard.press('Escape');
      await waitForComponents(page, RAIL_TAG_NAMES, {timeoutMs: initialWaitMs});
    }
    throw new Error(
      `navigateToMyContents: still not on /mycollections after ${maxAttempts} attempts ` +
      `(last route: ${await currentRoute(page)}).`,
    );
  }

  // Deliberately not using agentBridge to drive this directly, even though it's reachable on this
  // version and was used earlier to double check the target route: agentBridge registers under
  // one fixed hub name ('stv-app'), so a second page connecting under that same name (as every
  // fresh Playwright context navigating to this dev server would) collides with whatever instance
  // is already registered -- unsafe to rely on from an automated multi-context test.
  const keySequence = ['ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'Enter'];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const key of keySequence) {
      await page.keyboard.press(key);
      await page.waitForTimeout(keyDelayMs);
    }
    await page.waitForTimeout(keyDelayMs);

    if ((await currentRoute(page)) === '#/collections') {
      return;
    }

    // Didn't land where expected (dialog ate a key, landed one level too deep, etc.). Escape is
    // mapped to Key.HOME (KeyMap.js) regardless of current screen, so it's a reliable way back to
    // a known-good state before retrying, rather than compounding whatever state we ended up in.
    await page.keyboard.press('Escape');
    await waitForComponents(page, RAIL_TAG_NAMES, {timeoutMs: initialWaitMs});
  }

  throw new Error(
    `navigateToMyContents: still not on /collections after ${maxAttempts} attempts ` +
    `(last route: ${await currentRoute(page)}).`,
  );
}

/** Row title field renamed `header` (26.1) -> `name` (26.6); read whichever exists. */
function toRail(component) {
  const item = component.item || {};
  const name = item.header != null ? item.header : (item.name != null ? item.name : '');
  const id = item.id != null ? String(item.id) : `${component.tagName}:${component.uid}`;
  // `item.contents` is the row's own content array (both versions -- confirmed in
  // UICPivotGridRow.js/UICCarouselProxy.js), each entry named `.name`. Reading it off
  // the row/proxy itself (rather than the mounted uic-preview children) works
  // regardless of which of the two are actually mounted/recycled at any moment.
  const contents = Array.isArray(item.contents) ? item.contents : [];
  const topItemNames = contents.slice(0, 3).map((c) => (c && c.name) || '');
  return {id, name, topItemNames};
}

/**
 * Reads the rails currently mounted on the Pixi stage (only the rails near
 * the viewport are mounted at any time — the pivot list virtualizes/recycles
 * row components, see pixiInspector.js), normalized to {id, name}.
 */
async function snapshotVisibleRails(page) {
  const components = await page.evaluate(collectComponentsByTagNameInBrowser, RAIL_TAG_NAMES);
  return components.map(toRail).filter((rail) => rail.name);
}

/**
 * Reads whichever single rail currently has focus, or null if none does (e.g.
 * mid-transition). This is the only reliable signal of true on-screen
 * top-to-bottom order — DOM-tree traversal order (as returned by
 * collectComponentsByTagNameInBrowser/snapshotVisibleRails) does NOT track
 * visual position: recycled row instances get reused for whichever rail
 * mounts next regardless of where that rail sits on screen, so a rail can
 * appear early in stage-traversal order despite being the very last one
 * visually. Confirmed empirically (env=de, profile "Benutzer", 26.1): a
 * traversal-order collector placed "Genres" 3rd, but stepping ArrowDown
 * through real focus showed it landing last, right before wraparound.
 */
async function focusedRail(page) {
  const components = await page.evaluate(collectComponentsByTagNameInBrowser, RAIL_TAG_NAMES);
  const focused = components.find((c) => c.isFocused);
  if (!focused) {
    return null;
  }
  // A row can be mounted and focused before its `item` data has arrived (seen right after
  // selectProfile, before Home's first rail finishes loading) -- treat that the same as
  // "nothing focused yet" rather than recording a bogus blank-named rail.
  const rail = toRail(focused);
  return rail.name ? rail : null;
}

/** Polls focusedRail until it returns a real (non-empty) rail or the timeout elapses. */
async function waitForFocusedRail(page, {timeoutMs = 20000, intervalMs = 300} = {}) {
  const deadline = Date.now() + timeoutMs;
  let rail = await focusedRail(page);
  while (!rail && Date.now() < deadline) {
    await page.waitForTimeout(intervalMs);
    rail = await focusedRail(page);
  }
  return rail;
}

/**
 * Collects every rail shown on the current screen, as {id, name, topItemNames}
 * records, in genuine on-screen order, by repeatedly pressing "down" and
 * recording which rail gains focus at each step until a run of presses stops
 * turning up an unseen rail (either genuinely the end of the list, or focus
 * has wrapped back around to one already recorded). Works for any screen
 * built on the same pivot-list/carousel pattern, not just Home.
 */
async function collectAllRails(page, opts = {}) {
  const {maxIdleAttempts = 4, keyDelayMs = 700, maxPresses = 200, initialWaitMs = 25000} = opts;

  await page.waitForFunction(() => !!window.__PIXI_APP__, null, {timeout: 30000});

  const order = []; // rail records ({id, name, topItemNames}), in genuine focus-navigation (top-to-bottom) order
  const seenIds = new Set();
  const recordIfNew = (rail) => {
    if (!rail || seenIds.has(rail.id)) {
      return false;
    }
    seenIds.add(rail.id);
    order.push(rail);
    return true;
  };

  // The screen may still be transitioning/loading (e.g. right after a
  // profile switch: loading spinner + network call before Home mounts), so
  // wait for the *first* rail rather than assuming it's already there.
  await waitForComponents(page, RAIL_TAG_NAMES, {timeoutMs: initialWaitMs});
  recordIfNew(await waitForFocusedRail(page, {timeoutMs: initialWaitMs}));

  let idleStreak = 0;
  let presses = 0;
  while (idleStreak < maxIdleAttempts && presses < maxPresses) {
    await page.keyboard.press('ArrowDown');
    presses += 1;
    await page.waitForTimeout(keyDelayMs);
    let addedAny = recordIfNew(await focusedRail(page));
    if (!addedAny) {
      // No progress -- could genuinely be the end of the list (or focus wrapped back to an
      // already-seen rail), or an undetectable overlay eating the ArrowDown. Back closes an
      // overlay in place on some screens (confirmed a no-op on Home with nothing open); on
      // others (e.g. mycollections) it navigates away instead, which would otherwise silently
      // start collecting the next screen's rails. Bail out the moment the route itself changes
      // rather than treating that as progress.
      const routeBeforeBack = await currentRoute(page);
      await pressBack(page);
      await page.waitForTimeout(keyDelayMs);
      if ((await currentRoute(page)) !== routeBeforeBack) {
        break;
      }
      addedAny = recordIfNew(await focusedRail(page));
    }
    idleStreak = addedAny ? 0 : idleStreak + 1;
  }

  return order;
}

/** Thin wrapper over collectAllRails for callers that only need rail names (e.g. home-rails.spec.js). */
async function collectAllRailNames(page, opts = {}) {
  return (await collectAllRails(page, opts)).map((rail) => rail.name);
}

module.exports = {
  collectAllRails,
  collectAllRailNames,
  collectMainMenuItems,
  snapshotVisibleRails,
  navigateToMenuItem,
  snapshotMenuItems,
  navigateToMyContents,
};
