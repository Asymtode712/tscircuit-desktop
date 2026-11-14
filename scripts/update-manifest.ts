/**
 * Writes or checks the files the app's updater reads from a release. See
 * scripts/lib/update-manifest.ts.
 *
 *   node scripts/update-manifest.ts write <version> <update package> <manifest to write>
 *   node scripts/update-manifest.ts check <version> <manifest>...
 */
import { writeFileSync } from "node:fs"
import { manifestFor, manifestProblems } from "./lib/update-manifest.ts"

const [command, version, ...paths] = process.argv.slice(2)

if (command === "write" && version && paths.length === 2) {
  const [filePath, manifestPath] = paths as [string, string]
  writeFileSync(manifestPath, manifestFor({ version, filePath, releaseDate: new Date() }))
  console.log(`Wrote ${manifestPath} for ${filePath}`)
} else if (command === "check" && version && paths.length > 0) {
  const problems = paths.flatMap((path) => manifestProblems(path, version))
  for (const problem of problems) console.error(`✗ ${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log(`The update manifests match the files being published: ${paths.join(", ")}`)
} else {
  console.error(
    "Usage: update-manifest.ts write <version> <update package> <manifest> | check <version> <manifest>...",
  )
  process.exit(2)
}
