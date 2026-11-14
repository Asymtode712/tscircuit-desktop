/**
 * The file the app's updater reads from a release to learn what the newest
 * version is and how to check what it downloaded (latest-mac.yml on a Mac,
 * latest.yml on Windows).
 *
 * The build writes one for each package it makes. On a Mac the app is signed
 * after the build, which changes the zip, so the release workflow writes the
 * Mac one again here for the signed zip. Before a release is published, every
 * one is checked against the files that go out with it: an update whose size
 * or hash differs from its manifest is refused by every copy of the app.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"

export interface ManifestFile {
  readonly url: string
  readonly sha512: string
  readonly size: number
}

/** The updater compares the SHA-512 of a download, in base64, with the one listed. */
export const sha512Of = (path: string): string =>
  createHash("sha512").update(readFileSync(path)).digest("base64")

/** The manifest for a release whose only update package is `file`. */
export function composeManifest(input: {
  readonly version: string
  readonly file: ManifestFile
  readonly releaseDate: Date
}): string {
  const { version, file, releaseDate } = input
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${file.url}`,
    `    sha512: ${file.sha512}`,
    `    size: ${file.size}`,
    `path: ${file.url}`,
    `sha512: ${file.sha512}`,
    `releaseDate: '${releaseDate.toISOString()}'`,
    "",
  ].join("\n")
}

export function manifestFor(input: {
  readonly version: string
  readonly filePath: string
  readonly releaseDate: Date
}): string {
  return composeManifest({
    version: input.version,
    releaseDate: input.releaseDate,
    file: {
      url: basename(input.filePath),
      sha512: sha512Of(input.filePath),
      size: statSync(input.filePath).size,
    },
  })
}

const unquote = (value: string): string => value.trim().replace(/^(['"])(.*)\1$/, "$2")

/** The version and the files a manifest lists. Reads only what the build and this file write. */
export function readManifest(text: string): {
  readonly version: string | null
  readonly files: ReadonlyArray<ManifestFile>
} {
  let version: string | null = null
  const files: Array<{ url?: string; sha512?: string; size?: number }> = []
  let inFiles = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inFiles = line.trim() === "files:"
      const top = /^version:\s*(.+)$/.exec(line)
      if (top) version = unquote(top[1]!)
      continue
    }
    if (!inFiles) continue
    const entry = /^\s*(-\s+)?(url|sha512|size):\s*(.+)$/.exec(line)
    if (!entry) continue
    if (entry[1] || files.length === 0) files.push({})
    const file = files.at(-1)!
    if (entry[2] === "size") file.size = Number(unquote(entry[3]!))
    else file[entry[2] as "url" | "sha512"] = unquote(entry[3]!)
  }
  return {
    version,
    files: files.map((file) => ({
      url: file.url ?? "",
      sha512: file.sha512 ?? "",
      size: file.size ?? Number.NaN,
    })),
  }
}

/** What is wrong with a manifest, given the files beside it. Empty when it can be published. */
export function manifestProblems(manifestPath: string, expectedVersion: string): string[] {
  const name = basename(manifestPath)
  if (!existsSync(manifestPath)) return [`${name} is missing, so the app could not find this release`]
  const { version, files } = readManifest(readFileSync(manifestPath, "utf8"))
  const problems: string[] = []
  if (version !== expectedVersion) {
    problems.push(`${name} is for version ${version ?? "(none)"}, not ${expectedVersion}`)
  }
  if (files.length === 0) problems.push(`${name} lists no files`)
  for (const file of files) {
    const path = join(dirname(manifestPath), file.url)
    if (file.url === "" || !existsSync(path)) {
      problems.push(`${name} lists ${file.url || "a file with no name"}, which is not being published`)
      continue
    }
    const size = statSync(path).size
    if (size !== file.size) {
      problems.push(`${name} says ${file.url} is ${file.size} bytes, but it is ${size}`)
    } else if (sha512Of(path) !== file.sha512) {
      problems.push(`${name} has a different SHA-512 for ${file.url} than the file being published`)
    }
  }
  return problems
}
