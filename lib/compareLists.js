function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Order-sensitive comparison of two ordered lists (e.g. rail names on two
 * app versions). Generic on purpose so any future scenario (menu sections,
 * "see all" pages, ...) can reuse it instead of writing a new diff each time.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{equal: boolean, added: string[], removed: string[], reordered: boolean, commonOrderA: string[], commonOrderB: string[]}}
 */
function compareOrderedLists(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);

  const removed = a.filter((value) => !setB.has(value));
  const added = b.filter((value) => !setA.has(value));
  const commonOrderA = a.filter((value) => setB.has(value));
  const commonOrderB = b.filter((value) => setA.has(value));

  return {
    equal: arraysEqual(a, b),
    added,
    removed,
    reordered: !arraysEqual(commonOrderA, commonOrderB),
    commonOrderA,
    commonOrderB,
  };
}

/** Human-readable summary for test failure messages / reports. */
function formatDiff(diff, labelA, labelB) {
  const lines = [];
  if (diff.removed.length) {
    lines.push(`Solo en ${labelA} (${diff.removed.length}): ${diff.removed.join(', ')}`);
  }
  if (diff.added.length) {
    lines.push(`Solo en ${labelB} (${diff.added.length}): ${diff.added.join(', ')}`);
  }
  if (diff.reordered) {
    lines.push(`Orden distinto para las tiras comunes:\n  ${labelA}: ${diff.commonOrderA.join(' | ')}\n  ${labelB}: ${diff.commonOrderB.join(' | ')}`);
  }
  return lines.length ? lines.join('\n') : 'Sin diferencias.';
}

module.exports = {compareOrderedLists, formatDiff};
