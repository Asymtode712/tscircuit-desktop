/**
 * Prints the version a build of the app is released as: the version of the
 * tscircuit package it bundles, so tscircuit desktop 0.0.3191 is the build with
 * tscircuit 0.0.3191 in it.
 *
 * Usage: node scripts/release-version.ts
 */
import { fail } from "./lib/exec.ts"
import { readViewerSource, resolveTscircuitVersion, viewerFile } from "./lib/viewer.ts"

const source = readViewerSource()
if (!source) fail(`${viewerFile} is missing, so there is no tscircuit version to number a release after.`)
console.log(resolveTscircuitVersion(source))
