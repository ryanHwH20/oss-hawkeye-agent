export function expectedReleaseTag(version) {
  return `v${version}`;
}

export function assertReleaseTag(version, tag) {
  const expected = expectedReleaseTag(version);
  if (tag !== expected) {
    throw new Error(`Release tag ${JSON.stringify(tag)} does not match package version ${JSON.stringify(version)}; expected ${JSON.stringify(expected)}.`);
  }
}
