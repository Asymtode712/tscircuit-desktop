/**
 * tscircuit desktop: the autorouting phases of the run in the viewer, as
 * public/tscircuit-viewer/frame.html reports them, and how a bug report names one.
 */

export interface AutorouterPhase {
  /** Names the phase to the viewer frame. A new run gives every phase a new one. */
  readonly id: string;
  readonly status: "running" | "complete" | "error";
  readonly errorMessage?: string;
  /** The board or group that was routed. A design with routed groups has several. */
  readonly subcircuitId?: string;
  readonly componentDisplayName?: string;
  readonly phaseName?: string;
  /** One-based place in the order the group's phases ran. */
  readonly phaseOrdinal?: number;
  /** Zero-based stage within a named phase that routes in several passes. */
  readonly phaseStageIndex?: number;
  readonly phaseStageCount?: number;
  readonly connectionCount?: number;
  readonly obstacleCount?: number;
  readonly isReroutePhase?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
const count = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
const withoutMissing = (phase: {
  [Field in keyof AutorouterPhase]-?: AutorouterPhase[Field] | undefined;
}) =>
  Object.fromEntries(
    Object.entries(phase).filter(([, entry]) => entry !== undefined),
  ) as unknown as AutorouterPhase;

const STATUSES = new Set(["running", "complete", "error"]);

/** The frame's phase list. An entry that is not a phase is left out. */
export function readAutorouterPhases(value: unknown): AutorouterPhase[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AutorouterPhase[] => {
    if (!isRecord(entry)) return [];
    const { id, status } = entry;
    if (typeof id !== "string" || typeof status !== "string" || !STATUSES.has(status)) return [];
    return [
      withoutMissing({
        id,
        status: status as AutorouterPhase["status"],
        errorMessage: text(entry.errorMessage),
        subcircuitId: text(entry.subcircuit_id),
        componentDisplayName: text(entry.componentDisplayName),
        phaseName: text(entry.phaseName),
        phaseOrdinal: count(entry.phaseOrdinal),
        phaseStageIndex: count(entry.phaseStageIndex),
        phaseStageCount: count(entry.phaseStageCount),
        connectionCount: count(entry.connectionCount),
        obstacleCount: count(entry.obstacleCount),
        isReroutePhase: entry.isReroutePhase === true ? true : undefined,
      }),
    ];
  });
}

/** "<group#12 name=".power" />" reads as "power", and "<board#40 />" as "board". */
function scopeName(phase: AutorouterPhase): string | null {
  const display = phase.componentDisplayName;
  if (display === undefined) return null;
  const name = /name="\.?([^"]+)"/.exec(display)?.[1];
  return name ?? /^<\s*([A-Za-z]+)/.exec(display)?.[1] ?? display;
}

/** What to call each phase. Phases of different groups say which group they routed. */
export function autorouterPhaseTitles(phases: ReadonlyArray<AutorouterPhase>): string[] {
  const severalGroups = new Set(phases.map((phase) => phase.subcircuitId)).size > 1;
  return phases.map((phase, index) => {
    const stage =
      phase.phaseStageIndex !== undefined && (phase.phaseStageCount ?? 0) > 1
        ? `, stage ${phase.phaseStageIndex + 1} of ${phase.phaseStageCount}`
        : "";
    const title = `${phase.phaseName ?? `Phase ${phase.phaseOrdinal ?? index + 1}`}${stage}`;
    const scope = severalGroups ? scopeName(phase) : null;
    return scope === null ? title : `${scope}: ${title}`;
  });
}

const plural = (amount: number, noun: string) => `${amount} ${noun}${amount === 1 ? "" : "s"}`;

/** What the phase was asked to route, as far as the run said. */
export function autorouterPhaseSummary(phase: AutorouterPhase): string {
  return [
    phase.connectionCount === undefined ? null : plural(phase.connectionCount, "connection"),
    phase.obstacleCount === undefined ? null : plural(phase.obstacleCount, "obstacle"),
    phase.isReroutePhase ? "reroutes earlier traces" : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The phase a report is most likely about: the first that failed, else the last that ran. */
export const defaultAutorouterPhaseId = (phases: ReadonlyArray<AutorouterPhase>): string | null =>
  (phases.find((phase) => phase.status === "error") ?? phases.at(-1))?.id ?? null;

/** A report title that says where the routing problem came from. */
export function defaultAutorouterReportTitle(input: {
  readonly cwd: string | undefined;
  readonly file: string;
  readonly phaseTitle: string;
}): string {
  const project = input.cwd?.split(/[\\/]+/).findLast((segment) => segment !== "");
  return `${project === undefined ? "" : `${project}/`}${input.file} - ${input.phaseTitle}`;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Whether a value is an autorouter input. The same test `tsci report autorouter`
 * makes of a file before it uploads it.
 */
export function isSimpleRouteJson(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const { layerCount, minTraceWidth, connections, obstacles, bounds } = value;
  return (
    typeof layerCount === "number" &&
    Number.isInteger(layerCount) &&
    layerCount >= 1 &&
    isFiniteNumber(minTraceWidth) &&
    minTraceWidth > 0 &&
    Array.isArray(connections) &&
    Array.isArray(obstacles) &&
    isRecord(bounds) &&
    isFiniteNumber(bounds.minX) &&
    isFiniteNumber(bounds.maxX) &&
    isFiniteNumber(bounds.minY) &&
    isFiniteNumber(bounds.maxY) &&
    bounds.minX < bounds.maxX &&
    bounds.minY < bounds.maxY
  );
}
