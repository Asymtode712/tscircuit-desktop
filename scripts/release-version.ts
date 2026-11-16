/**
 * Prints the number of the next release. See scripts/lib/release-version.ts.
 *
 * Usage: node scripts/release-version.ts <patch|minor> < the tags of the releases so far, one a line
 */
import { readFileSync } from "node:fs"
import { fail } from "./lib/exec.ts"
import { nextVersion } from "./lib/release-version.ts"

const bump = process.argv[2] ?? "patch"
if (bump !== "patch" && bump !== "minor") fail("Usage: release-version.ts <patch|minor> < release tags")
console.log(nextVersion(readFileSync(0, "utf8").split("\n"), bump))
