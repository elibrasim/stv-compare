const {test, expect} = require('@playwright/test');
const {loadConfig, pairwiseVersions, buildAppUrl} = require('../lib/config');
const {collectMainMenuItems} = require('../lib/navigation');
const {listProfiles, selectProfile} = require('../lib/profiles');
const {compareOrderedLists, formatDiff} = require('../lib/compareLists');

const config = loadConfig();

/** Fresh context per call — same reasoning as home-rails.spec.js: guarantees the
 * profile-selection screen shows, no state carried over between profiles/versions. */
async function withFreshPage(browser, fn) {
  const context = await browser.newContext();
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

async function discoverProfiles(browser, version) {
  return withFreshPage(browser, async (page) => {
    await page.goto(buildAppUrl(version, config), {waitUntil: 'domcontentloaded'});
    return listProfiles(page);
  });
}

async function getMainMenuForProfile(browser, version, profileName) {
  return withFreshPage(browser, async (page) => {
    await page.goto(buildAppUrl(version, config), {waitUntil: 'domcontentloaded'});
    await selectProfile(page, profileName);
    return collectMainMenuItems(page);
  });
}

function assertNonEmpty(items, label) {
  expect(items.length, `${label}: no se encontró ningún elemento en el menú principal. ` +
    'Probablemente la selección de perfil falló o el menú no llegó a montarse ' +
    '(revisa la consola/log del webServer de esta versión), no que el menú esté vacío de verdad.').toBeGreaterThan(0);
}

for (const [versionA, versionB] of pairwiseVersions(config.versions)) {
  test(`Menú principal por perfil: mismos elementos y mismo orden en ${versionA.name} vs ${versionB.name} (env=${config.env})`, async ({browser}) => {
    const [profilesA, profilesB] = await Promise.all([
      discoverProfiles(browser, versionA),
      discoverProfiles(browser, versionB),
    ]);

    const namesA = profilesA.map((p) => p.name);
    const namesB = new Set(profilesB.map((p) => p.name));
    const commonProfiles = namesA.filter((name) => namesB.has(name));

    expect(commonProfiles.length, `${versionA.name} tiene perfiles [${namesA.join(', ')}], ` +
      `${versionB.name} tiene [${[...namesB].join(', ')}] — ningún nombre coincide, no se puede comparar.`).toBeGreaterThan(0);

    for (const profileName of commonProfiles) {
      await test.step(`Perfil "${profileName}"`, async () => {
        const [itemsA, itemsB] = await Promise.all([
          getMainMenuForProfile(browser, versionA, profileName),
          getMainMenuForProfile(browser, versionB, profileName),
        ]);

        assertNonEmpty(itemsA, `${versionA.name} / ${profileName}`);
        assertNonEmpty(itemsB, `${versionB.name} / ${profileName}`);

        const diff = compareOrderedLists(itemsA, itemsB);

        await test.info().attach(`main-menu-${profileName}.txt`, {
          body: [
            `${versionA.name}: ${itemsA.join(' | ')}`,
            `${versionB.name}: ${itemsB.join(' | ')}`,
            '',
            formatDiff(diff, versionA.name, versionB.name),
          ].join('\n'),
          contentType: 'text/plain',
        });

        expect(itemsA, `Perfil "${profileName}": ${formatDiff(diff, versionA.name, versionB.name)}`).toEqual(itemsB);
      });
    }
  });
}
