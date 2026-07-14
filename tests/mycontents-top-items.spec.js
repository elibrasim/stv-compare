const {test, expect} = require('@playwright/test');
const {loadConfig, pairwiseVersions, buildAppUrl} = require('../lib/config');
const {collectAllRails, navigateToMyContents} = require('../lib/navigation');
const {listProfiles, selectProfile} = require('../lib/profiles');
const {compareOrderedLists, formatDiff} = require('../lib/compareLists');

const config = loadConfig();

/** Fresh context per call — same reasoning as mycontents-categories.spec.js: guarantees the
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

/** Selects the profile, opens "Meine Inhalte", and reads every category rail there
 * together with the first 3 content names in each (rail.item.contents, read straight
 * off the pivot-grid-row/carousel-proxy component — see collectAllRails in navigation.js). */
async function getMyContentsRailsForProfile(browser, version, profileName) {
  return withFreshPage(browser, async (page) => {
    await page.goto(buildAppUrl(version, config), {waitUntil: 'domcontentloaded'});
    await selectProfile(page, profileName);
    await navigateToMyContents(page);
    return collectAllRails(page);
  });
}

function assertNonEmpty(rails, label) {
  expect(rails.length, `${label}: no se encontró ninguna categoría en Meine Inhalte. ` +
    'Probablemente la navegación al menú "Meine Inhalte" falló ' +
    '(revisa la consola/log del webServer de esta versión), no que la pantalla esté vacía de verdad.').toBeGreaterThan(0);
}

for (const [versionA, versionB] of pairwiseVersions(config.versions)) {
  test(`Meine Inhalte por perfil: mismos 3 primeros elementos por categoría en ${versionA.name} vs ${versionB.name} (env=${config.env})`, async ({browser}) => {
    // expect.soft means every category for every profile gets checked (no bailing out at the first
    // mismatch, unlike home-rails/mycontents-categories), so this routinely runs past the default
    // 5-minute budget once there's more than a couple of profiles/categories to walk.
    test.slow();

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
        const [railsA, railsB] = await Promise.all([
          getMyContentsRailsForProfile(browser, versionA, profileName),
          getMyContentsRailsForProfile(browser, versionB, profileName),
        ]);

        assertNonEmpty(railsA, `${versionA.name} / ${profileName}`);
        assertNonEmpty(railsB, `${versionB.name} / ${profileName}`);

        const railsBByName = new Map(railsB.map((rail) => [rail.name, rail]));
        const categoryNamesA = railsA.map((rail) => rail.name);
        const categoryNamesB = railsB.map((rail) => rail.name);
        const categoryDiff = compareOrderedLists(categoryNamesA, categoryNamesB);

        // Categories only present in one version (e.g. a rename) have nothing to compare items
        // against — that mismatch is already covered by mycontents-categories.spec.js. Here we only
        // note it for context, and compare the first-3-items for every category common to both.
        if (categoryDiff.added.length || categoryDiff.removed.length) {
          await test.info().attach(`categorias-no-comunes-${profileName}.txt`, {
            body: formatDiff(categoryDiff, versionA.name, versionB.name),
            contentType: 'text/plain',
          });
        }

        for (const categoryName of categoryDiff.commonOrderA) {
          await test.step(`Categoría "${categoryName}"`, async () => {
            const railA = railsA.find((rail) => rail.name === categoryName);
            const railB = railsBByName.get(categoryName);

            const itemsDiff = compareOrderedLists(railA.topItemNames, railB.topItemNames);

            await test.info().attach(`top-items-${profileName}-${categoryName}.txt`, {
              body: [
                `${versionA.name}: ${railA.topItemNames.join(' | ') || '(vacío)'}`,
                `${versionB.name}: ${railB.topItemNames.join(' | ') || '(vacío)'}`,
                '',
                formatDiff(itemsDiff, versionA.name, versionB.name),
              ].join('\n'),
              contentType: 'text/plain',
            });

            // expect.soft: a mismatch in one category must not stop the remaining categories
            // (or remaining profiles) from being checked — this test's value is the full diff
            // report across every rail, not just the first one that happens to differ.
            expect.soft(railA.topItemNames, `Perfil "${profileName}", categoría "${categoryName}": ` +
              `${formatDiff(itemsDiff, versionA.name, versionB.name)}`).toEqual(railB.topItemNames);
          });
        }
      });
    }
  });
}
