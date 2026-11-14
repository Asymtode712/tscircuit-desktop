import type { EnvironmentId } from "@t3tools/contracts";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";

import { isHashedDirectory, isHashedSourceFile } from "./builtCircuit";

/** Files RunFrame can evaluate or import, keyed by workspace-relative path. */
export type ProjectFsMap = Record<string, string>;

export interface LoadedProject {
  readonly fsMap: ProjectFsMap;
  /** True when the project was too large to send whole. */
  readonly truncated: boolean;
  /**
   * Every file `tsci build` hashes to say which sources a build was made from. Null when they
   * could not all be read exactly, and so no build can be shown to be current.
   */
  readonly hashedFiles: ProjectFsMap | null;
}

const SOURCE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|json)$/i;
const LOCK_FILE = /(^|\/)(package-lock\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 2_000_000;
const MAX_DEPTH = 6;
const READ_BATCH_SIZE = 8;
const MAX_HASHED_FILES = 400;
const MAX_HASHED_BYTES = 8_000_000;
const MAX_HASHED_DEPTH = 16;
/** Folders the viewer has no use for, such as ones git ignores, that are listed for the hash alone. */
const MAX_HASH_ONLY_DIRECTORIES = 50;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Dependencies and build output are resolved by RunFrame itself, not sent from disk. */
export const shouldWalkDirectory = (path: string): boolean => {
  const name = baseName(path);
  return !name.startsWith(".") && !SKIPPED_DIRECTORIES.has(name);
};

export const isProjectSourceFile = (path: string): boolean =>
  SOURCE_FILE.test(path) && !LOCK_FILE.test(path) && !baseName(path).startsWith(".");

const ENTRY_FILE_NAMES = ["index.tsx", "index.circuit.tsx", "main.tsx", "main.circuit.tsx"];

/** The file to render when the user has not picked one. */
export function pickEntryFile(fsMap: ProjectFsMap): string | null {
  const configured = readConfiguredEntrypoint(fsMap["tscircuit.config.json"]);
  if (configured !== null && configured in fsMap) return configured;
  for (const name of ENTRY_FILE_NAMES) {
    if (name in fsMap) return name;
  }
  const circuits = tsxFiles(fsMap);
  return circuits.find((path) => /\.circuit\.tsx$/i.test(path)) ?? circuits[0] ?? null;
}

/** Shallowest first, then by name. */
function tsxFiles(fsMap: ProjectFsMap): string[] {
  const depth = (path: string) => path.split("/").length;
  return Object.keys(fsMap)
    .filter((path) => /\.tsx$/i.test(path))
    .toSorted((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

/** The files that may hold a circuit, the project's entry file first. */
export function circuitFileCandidates(fsMap: ProjectFsMap): string[] {
  const entry = pickEntryFile(fsMap);
  const others = tsxFiles(fsMap).filter((path) => path !== entry);
  return entry === null ? others : [entry, ...others];
}

/**
 * The file the Order tab orders: the one chosen there, else the Circuit tab's,
 * else the project's only circuit. Null when it has to ask.
 */
export function pickFileToOrder(input: {
  readonly fsMap: ProjectFsMap;
  readonly chosen: string | null;
  /** Undefined when the Circuit tab shows the entry file, null with no Circuit tab. */
  readonly circuitTabFile: string | undefined | null;
}): string | null {
  const { fsMap, chosen, circuitTabFile } = input;
  if (chosen !== null && chosen in fsMap) return chosen;
  if (circuitTabFile !== null) {
    return circuitTabFile !== undefined && circuitTabFile in fsMap
      ? circuitTabFile
      : pickEntryFile(fsMap);
  }
  const candidates = circuitFileCandidates(fsMap);
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function readConfiguredEntrypoint(config: string | undefined): string | null {
  if (config === undefined) return null;
  try {
    const entrypoint = (JSON.parse(config) as { mainEntrypoint?: unknown }).mainEntrypoint;
    return typeof entrypoint === "string" ? entrypoint.replace(/^\.\//, "") : null;
  } catch {
    return null;
  }
}

const QUERY_OPTIONS = { refresh: true, reportDefect: false, reportFailure: false } as const;

interface FileRead {
  readonly contents: string;
  readonly byteLength: number;
  readonly truncated: boolean;
  readonly exists?: boolean | undefined;
}

/** How a project's folders and files are read. Either answer is null when the read failed. */
export interface ProjectReader {
  readonly list: (directoryPath: string) => Promise<{
    readonly entries: ReadonlyArray<{
      readonly path: string;
      readonly kind: "file" | "directory";
      readonly ignored?: boolean | undefined;
    }>;
    readonly truncated: boolean;
  } | null>;
  readonly read: (relativePath: string) => Promise<FileRead | null>;
}

type OnFile = (path: string, file: FileRead | null) => void;

const encodedLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * Reads the project's source files through the environment, so it works for
 * remote environments too. Always refetches: the point is to see new edits.
 */
export function loadProjectFsMap(
  environmentId: EnvironmentId,
  cwd: string,
  signal: AbortSignal,
): Promise<LoadedProject> {
  const query = { ...QUERY_OPTIONS, signal };
  return readProject({
    list: async (directoryPath) => {
      const listing = await executeAtomQuery(
        appAtomRegistry,
        // Always pass a path: without one the server lists the whole indexed tree.
        projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath } }),
        query,
      );
      return listing._tag === "Success" ? listing.value : null;
    },
    read: async (relativePath) => {
      const file = await executeAtomQuery(
        appAtomRegistry,
        projectEnvironment.readFile({ environmentId, input: { cwd, relativePath } }),
        query,
      );
      return file._tag === "Success" ? file.value : null;
    },
  });
}

/** The files the viewer is sent, and the ones `tsci build` hashes, which are not quite the same. */
export async function readProject(reader: ProjectReader): Promise<LoadedProject> {
  const filePaths: string[] = [];
  const hashedPaths: string[] = [];
  let truncated = false;
  let hashable = true;
  let hashOnlyDirectories = 0;
  let directories = [{ path: "", forViewer: true }];

  for (let depth = 0; depth <= MAX_HASHED_DEPTH && directories.length > 0; depth += 1) {
    const listings = await Promise.all(directories.map((directory) => reader.list(directory.path)));
    const nextDirectories: typeof directories = [];
    for (const [index, listing] of listings.entries()) {
      const forViewer = directories[index]?.forViewer === true;
      if (listing === null) {
        hashable = false;
        continue;
      }
      if (listing.truncated) {
        hashable = false;
        truncated ||= forViewer;
      }
      for (const entry of listing.entries) {
        const shown = forViewer && !entry.ignored;
        if (entry.kind === "directory") {
          const walkForViewer = shown && shouldWalkDirectory(entry.path);
          if (walkForViewer && depth >= MAX_DEPTH) truncated = true;
          if (isHashedDirectory(entry.path)) {
            nextDirectories.push({
              path: entry.path,
              forViewer: walkForViewer && depth < MAX_DEPTH,
            });
          }
          continue;
        }
        if (shown && isProjectSourceFile(entry.path)) filePaths.push(entry.path);
        if (isHashedSourceFile(entry.path)) hashedPaths.push(entry.path);
      }
    }
    hashOnlyDirectories += nextDirectories.filter((directory) => !directory.forViewer).length;
    if (hashOnlyDirectories > MAX_HASH_ONLY_DIRECTORIES || hashedPaths.length > MAX_HASHED_FILES) {
      hashable = false;
    }
    // Without a hash to work out, only the folders the viewer is sent are worth listing.
    directories = hashable
      ? nextDirectories
      : nextDirectories.filter((directory) => directory.forViewer);
  }
  if (directories.length > 0) hashable = false;

  const readFiles = async (
    paths: ReadonlyArray<string>,
    onFile: OnFile,
    keepGoing: () => boolean,
  ) => {
    for (let start = 0; start < paths.length && keepGoing(); start += READ_BATCH_SIZE) {
      const batch = paths.slice(start, start + READ_BATCH_SIZE);
      const files = await Promise.all(batch.map((relativePath) => reader.read(relativePath)));
      for (const [index, file] of files.entries()) {
        const path = batch[index];
        if (path !== undefined) onFile(path, file);
      }
    }
  };

  const hashed = new Set(hashable ? hashedPaths : []);
  const hashedFiles: ProjectFsMap = {};
  let hashedBytes = 0;
  /** The hash is over a file's bytes, so text that does not encode back to them is no use. */
  const keepForHash: OnFile = (path, file) => {
    if (!hashed.has(path) || file?.exists === false) return;
    if (file === null || file.truncated || encodedLength(file.contents) !== file.byteLength) {
      hashable = false;
      return;
    }
    hashedBytes += file.byteLength;
    if (hashedBytes > MAX_HASHED_BYTES) hashable = false;
    hashedFiles[path] = file.contents;
  };

  const fsMap: ProjectFsMap = {};
  let totalBytes = 0;
  const wanted = filePaths.toSorted().slice(0, MAX_FILES);
  if (wanted.length < filePaths.length) truncated = true;

  await readFiles(
    wanted,
    (path, file) => {
      keepForHash(path, file);
      if (file === null || file.exists === false) return;
      if (file.truncated || totalBytes + file.byteLength > MAX_TOTAL_BYTES) {
        truncated = true;
        return;
      }
      totalBytes += file.byteLength;
      fsMap[path] = file.contents;
    },
    () => true,
  );
  const sentToViewer = new Set(wanted);
  await readFiles(
    [...hashed].filter((path) => !sentToViewer.has(path)),
    keepForHash,
    () => hashable,
  );

  return { fsMap, truncated, hashedFiles: hashable ? hashedFiles : null };
}

/** The text of a build's Circuit JSON, or null when there is none that can be read whole. */
export async function readBuiltCircuitJson(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<string | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    projectEnvironment.readFile({
      environmentId,
      input: { cwd, relativePath, allowMissing: true },
    }),
    { ...QUERY_OPTIONS, signal },
  );
  if (result._tag !== "Success") return null;
  const file = result.value;
  return file.exists === false || file.truncated ? null : file.contents;
}
