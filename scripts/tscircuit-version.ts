/**
 * Prints the version of the tscircuit package a build made now would bundle.
 * The release workflow names it in the release's title and holds every
 * platform's build to it.
 *
 * Usage: node scripts/tscircuit-version.ts
 */
import { fail } from "./lib/exec.ts"
import { readViewerSource, resolveTscircuitVersion, viewerFile } from "./lib/viewer.ts"

const source = readViewerSource()
if (!source) fail(`${viewerFile} is missing, so the app bundles no tscircuit.`)
console.log(resolveTscircuitVersion(source))
