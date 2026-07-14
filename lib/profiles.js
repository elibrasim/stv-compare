const {collectComponentsByTagNameInBrowser, waitForComponents} = require('./pixiInspector');

const PROFILE_TAG = 'uic-profile';
const CONSENT_ACCEPT_TEXT = 'Alles Akzeptieren';

/**
 * Each fresh Playwright context starts with no accepted UserCentrics consent, so the very
 * first navigation shows the CMP overlay (a real DOM/shadow-DOM element, not a Pixi component)
 * on top of the canvas before the profile-selection screen can render. Without accepting it,
 * no uic-profile component ever mounts and waitForComponents silently times out to []. Accept
 * it if present; do nothing if it never appears (already consented, or this env skips it).
 */
async function dismissConsentIfPresent(page, {timeoutMs = 15000} = {}) {
  try {
    await page.locator('#usercentrics-cmp-ui').getByText(CONSENT_ACCEPT_TEXT, {exact: false}).first()
      .click({timeout: timeoutMs});
  } catch (e) {
    // No consent banner appeared within timeoutMs — assume none will.
  }
}

/** The "Añadir Perfil" tile and the transient loading placeholder are not real profiles. */
function isSelectableProfile(item) {
  return !!item && item.type !== 'BUTTON' && !item.isFake;
}

function toProfile(component) {
  const item = component.item || {};
  return {
    name: item.name || '',
    isFocused: component.isFocused,
  };
}

/**
 * Reads the real (non-"add profile") profiles shown on the profile-selection
 * screen, in on-screen order, waiting for them to mount first.
 * @returns {Promise<Array<{name: string, isFocused: boolean}>>}
 */
async function listProfiles(page) {
  await dismissConsentIfPresent(page);
  const components = await waitForComponents(page, [PROFILE_TAG]);
  return components
    .filter((c) => isSelectableProfile(c.item))
    .map(toProfile);
}

/**
 * Selects a profile by name on the profile-selection screen (ArrowLeft/Right
 * to move focus, Enter to confirm — never Up/Down, which move focus onto the
 * tile's "Modificar" button instead of selecting the profile) and waits for
 * the resulting navigation to Home.
 */
async function selectProfile(page, targetName, opts = {}) {
  const {keyDelayMs = 500} = opts;

  const profiles = await listProfiles(page);
  const targetIndex = profiles.findIndex((p) => p.name === targetName);
  if (targetIndex === -1) {
    throw new Error(`Perfil "${targetName}" no encontrado. Perfiles disponibles: ${profiles.map((p) => p.name).join(', ') || '(ninguno)'}`);
  }

  let currentIndex = profiles.findIndex((p) => p.isFocused);
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  const delta = targetIndex - currentIndex;
  const key = delta > 0 ? 'ArrowRight' : 'ArrowLeft';
  for (let i = 0; i < Math.abs(delta); i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(keyDelayMs);
  }

  await page.keyboard.press('Enter');
}

module.exports = {listProfiles, selectProfile};
