/**
 * Numbers a release.
 *
 * A release is one patch number above the highest release there is, so the
 * numbers go 0.1.61, 0.1.62, 0.1.63 with none skipped. The minor number never
 * moves by itself: a minor release is asked for by hand, and starts its patch
 * numbers again at 0.
 */

export type Bump = "patch" | "minor"

/** What the first release is numbered when there is none to count from. */
const FIRST_VERSION = "0.1.0"

type Version = [major: number, minor: number, patch: number]

/** Tags that are not a plain release number, such as a preview's, are not counted. */
function parseTag(tag: string): Version | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** The version of the release after those tagged `tags`. */
export function nextVersion(tags: readonly string[], bump: Bump): string {
  const highest = tags
    .map(parseTag)
    .filter((version) => version !== null)
    .sort(compare)
    .at(-1)
  if (!highest) return FIRST_VERSION
  const [major, minor, patch] = highest
  return bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}
