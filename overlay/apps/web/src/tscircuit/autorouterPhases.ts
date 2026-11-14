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
  readonly preview?: RoutedAreaPreview;
}

/** Enough of a phase's routing problem to draw the board or group it routed. */
export interface RoutedAreaPreview {
  readonly bounds: Extent;
  readonly layerCount?: number;
  /** The board's edge as [x, y] points, when it has one. */
  readonly outline?: ReadonlyArray<readonly [number, number]>;
  /** Pads and other obstacles as [centerX, centerY, width, height]. */
  readonly pads: ReadonlyArray<readonly [number, number, number, number]>;
}

interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const numberTuples = <Tuple extends ReadonlyArray<number>>(value: unknown, length: number) =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Tuple =>
          Array.isArray(entry) && entry.length === length && entry.every(isFiniteNumber),
      )
    : [];

function readPreview(value: unknown): RoutedAreaPreview | undefined {
  if (!isRecord(value) || !isRecord(value.bounds)) return undefined;
  const { minX, maxX, minY, maxY } = value.bounds;
  if (![minX, maxX, minY, maxY].every(isFiniteNumber)) return undefined;
  const outline = numberTuples<readonly [number, number]>(value.outline, 2);
  const layerCount = count(value.layerCount);
  return {
    bounds: { minX, maxX, minY, maxY } as Extent,
    ...(layerCount === undefined ? {} : { layerCount }),
    ...(outline.length < 3 ? {} : { outline }),
    pads: numberTuples<readonly [number, number, number, number]>(value.pads, 4),
  };
}

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
        preview: readPreview(entry.preview),
      }),
    ];
  });
}

const plural = (amount: number, noun: string) => `${amount} ${noun}${amount === 1 ? "" : "s"}`;

/** The board edge when the area has one, else the bounds the autorouter was given. */
export function routedAreaExtent(preview: RoutedAreaPreview): Extent {
  const { outline } = preview;
  if (outline === undefined) return preview.bounds;
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

const millimetres = (value: number) => String(Math.round(value * 10) / 10);

function routedAreaDetail(preview: RoutedAreaPreview | null): string {
  if (preview === null) return "";
  const { minX, maxX, minY, maxY } = routedAreaExtent(preview);
  const size = `${millimetres(maxX - minX)} × ${millimetres(maxY - minY)} mm`;
  return preview.layerCount === undefined
    ? size
    : `${size} · ${plural(preview.layerCount, "layer")}`;
}

/** "<group#12 name=".power" />" reads as "power", and "<board#40 />" as "Board". */
function scopeName(display: string | undefined): string {
  if (display === undefined) return "Board";
  const name = /name="\.?([^"]+)"/.exec(display)?.[1];
  if (name !== undefined) return name;
  const kind = /^<\s*([A-Za-z]+)/.exec(display)?.[1];
  return kind === undefined ? display : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/** A board or group the run routed, with the phases it was routed in. */
export interface AutorouterReportScope {
  readonly key: string;
  /** Unlike every other scope's: boards without a name of their own are numbered. */
  readonly label: string;
  /** The routed area's size and layers, as far as the run said. */
  readonly detail: string;
  readonly preview: RoutedAreaPreview | null;
  readonly phases: ReadonlyArray<{
    readonly phase: AutorouterPhase;
    readonly title: string;
    /** The title with the scope's label, when the run routed several scopes. */
    readonly reportTitle: string;
  }>;
}

/** The run's phases under the board or group each one routed, in the order routing began. */
export function autorouterReportScopes(
  phases: ReadonlyArray<AutorouterPhase>,
): AutorouterReportScope[] {
  const byScope = new Map<string, AutorouterPhase[]>();
  for (const phase of phases) {
    const key = phase.subcircuitId ?? "";
    byScope.set(key, [...(byScope.get(key) ?? []), phase]);
  }
  const names = [...byScope.values()].map((group) => scopeName(group[0]?.componentDisplayName));
  const several = byScope.size > 1;
  return [...byScope].map(([key, group], scopeIndex) => {
    const name = names[scopeIndex] ?? "Board";
    const sameName = names.filter((other) => other === name).length > 1;
    const label = sameName
      ? `${name} ${names.slice(0, scopeIndex).filter((other) => other === name).length + 1}`
      : name;
    const preview = group.find((phase) => phase.preview !== undefined)?.preview ?? null;
    return {
      key,
      label,
      detail: routedAreaDetail(preview),
      preview,
      phases: group.map((phase, index) => {
        const stage =
          phase.phaseStageIndex !== undefined && (phase.phaseStageCount ?? 0) > 1
            ? `, stage ${phase.phaseStageIndex + 1} of ${phase.phaseStageCount}`
            : "";
        const title = `${phase.phaseName ?? `Phase ${phase.phaseOrdinal ?? index + 1}`}${stage}`;
        return { phase, title, reportTitle: several ? `${label}: ${title}` : title };
      }),
    };
  });
}

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

/**
 * The phase a report is most likely about: the first that failed, else the last that ran.
 * Null when several boards or groups routed without a failure, as any could be the one meant.
 */
export function defaultAutorouterPhaseId(phases: ReadonlyArray<AutorouterPhase>): string | null {
  const failed = phases.find((phase) => phase.status === "error");
  if (failed !== undefined) return failed.id;
  const severalScopes = new Set(phases.map((phase) => phase.subcircuitId)).size > 1;
  return severalScopes ? null : (phases.at(-1)?.id ?? null);
}

/** A report title that says where the routing problem came from. */
export function defaultAutorouterReportTitle(input: {
  readonly cwd: string | undefined;
  readonly file: string;
  readonly phaseTitle: string;
}): string {
  const project = input.cwd?.split(/[\\/]+/).findLast((segment) => segment !== "");
  return `${project === undefined ? "" : `${project}/`}${input.file} - ${input.phaseTitle}`;
}

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
