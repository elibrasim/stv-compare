const {test, expect} = require('@playwright/test');
const {loadConfig, pairwiseVersions, buildAppUrl} = require('../lib/config');
const {collectAllRailNames} = require('../lib/navigation');
const {listProfiles, selectProfile} = require('../lib/profiles');
const {compareOrderedLists, formatDiff} = require('../lib/compareLists');

const config = loadConfig();

/** Fresh context per call — each profile is checked from a clean session,
 * since there's no known in-app "switch profile" path from Home back to
 * the profile screen, and a fresh context guarantees the profile-selection
 * screen shows (no "remember last profile" state carried over). */
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

async function getHomeRailsForProfile(browser, version, profileName) {
  return withFreshPage(browser, async (page) => {
    await page.goto(buildAppUrl(version, config), {waitUntil: 'domcontentloaded'});
    await selectProfile(page, profileName);
    return collectAllRailNames(page);
  });
}

function assertNonEmpty(rails, label) {
  expect(rails.length, `${label}: no se encontró ninguna tira en Home. ` +
    'Probablemente la selección de perfil o la navegación a Home falló ' +
    '(revisa la consola/log del webServer de esta versión), no que la Home esté vacía de verdad.').toBeGreaterThan(0);
}

for (const [versionA, versionB] of pairwiseVersions(config.versions)) {
  test(`Home por perfil: mismas tiras y mismo orden en ${versionA.name} vs ${versionB.name} (env=${config.env})`, async ({browser}) => {
    const [profilesA, profilesB] = await Promise.all([
      discoverProfiles(browser, versionA),
      discoverProfiles(browser, versionB),
    ]);

    const namesA = profilesA.map((p) => p.name);
    const namesB = new Set(profilesB.map((p) => p.name));
    const commonProfiles = namesA.filter((name) => namesB.has(name));

    const onlyInA = namesA.filter((name) => !namesB.has(name));
    const onlyInB = profilesB.map((p) => p.name).filter((name) => !new Set(namesA).has(name));
    if (onlyInA.length || onlyInB.length) {
      await test.info().attach('perfiles-no-comunes.txt', {
        body: `Solo en ${versionA.name}: ${onlyInA.join(', ') || '(ninguno)'}\nSolo en ${versionB.name}: ${onlyInB.join(', ') || '(ninguno)'}`,
        contentType: 'text/plain',
      });
    }

    expect(commonProfiles.length, `${versionA.name} tiene perfiles [${namesA.join(', ')}], ` +
      `${versionB.name} tiene [${[...namesB].join(', ')}] — ningún nombre coincide, no se puede comparar.`).toBeGreaterThan(0);

    for (const profileName of commonProfiles) {
      await test.step(`Perfil "${profileName}"`, async () => {
        const [railsA, railsB] = await Promise.all([
          getHomeRailsForProfile(browser, versionA, profileName),
          getHomeRailsForProfile(browser, versionB, profileName),
        ]);

        assertNonEmpty(railsA, `${versionA.name} / ${profileName}`);
        assertNonEmpty(railsB, `${versionB.name} / ${profileName}`);

        const diff = compareOrderedLists(railsA, railsB);

        await test.info().attach(`rails-${profileName}.txt`, {
          body: [
            `${versionA.name}: ${railsA.join(' | ')}`,
            `${versionB.name}: ${railsB.join(' | ')}`,
            '',
            formatDiff(diff, versionA.name, versionB.name),
          ].join('\n'),
          contentType: 'text/plain',
        });

        expect(railsA, `Perfil "${profileName}": ${formatDiff(diff, versionA.name, versionB.name)}`).toEqual(railsB);
      });
    }
  });
}
