const {test, expect} = require('@playwright/test');
const {loadConfig, pairwiseVersions, buildAppUrl} = require('../lib/config');
const {collectAllRailNames, navigateToMyContents} = require('../lib/navigation');
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

/** Selects the profile, opens "Meine Inhalte" from the side menu (item id 'MyContent'),
 * and reads the category names shown there (Verfügbare Aufnahmen, Meine Liste, ...) —
 * that screen renders through the same pivot-grid-row pattern as Home, so it can reuse
 * collectAllRailNames as-is. */
async function getMyContentsCategoriesForProfile(browser, version, profileName) {
  return withFreshPage(browser, async (page) => {
    await page.goto(buildAppUrl(version, config), {waitUntil: 'domcontentloaded'});
    await selectProfile(page, profileName);
    await navigateToMyContents(page);
    return collectAllRailNames(page);
  });
}

function assertNonEmpty(categories, label) {
  expect(categories.length, `${label}: no se encontró ninguna categoría en Meine Inhalte. ` +
    'Probablemente la navegación al menú "Meine Inhalte" falló ' +
    '(revisa la consola/log del webServer de esta versión), no que la pantalla esté vacía de verdad.').toBeGreaterThan(0);
}

for (const [versionA, versionB] of pairwiseVersions(config.versions)) {
  test(`Meine Inhalte por perfil: mismas categorías y mismo orden en ${versionA.name} vs ${versionB.name} (env=${config.env})`, async ({browser}) => {
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
        const [categoriesA, categoriesB] = await Promise.all([
          getMyContentsCategoriesForProfile(browser, versionA, profileName),
          getMyContentsCategoriesForProfile(browser, versionB, profileName),
        ]);

        assertNonEmpty(categoriesA, `${versionA.name} / ${profileName}`);
        assertNonEmpty(categoriesB, `${versionB.name} / ${profileName}`);

        const diff = compareOrderedLists(categoriesA, categoriesB);

        await test.info().attach(`mycontents-categorias-${profileName}.txt`, {
          body: [
            `${versionA.name}: ${categoriesA.join(' | ')}`,
            `${versionB.name}: ${categoriesB.join(' | ')}`,
            '',
            formatDiff(diff, versionA.name, versionB.name),
          ].join('\n'),
          contentType: 'text/plain',
        });

        expect(categoriesA, `Perfil "${profileName}": ${formatDiff(diff, versionA.name, versionB.name)}`).toEqual(categoriesB);
      });
    }
  });
}
