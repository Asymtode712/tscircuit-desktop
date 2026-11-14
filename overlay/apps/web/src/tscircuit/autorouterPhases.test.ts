import { describe, expect, it } from "vite-plus/test";

import {
  type AutorouterPhase,
  autorouterPhaseSummary,
  autorouterPhaseTitles,
  defaultAutorouterPhaseId,
  defaultAutorouterReportTitle,
  isSimpleRouteJson,
  readAutorouterPhases,
} from "./autorouterPhases";

const phase = (id: string, rest: Partial<AutorouterPhase> = {}): AutorouterPhase => ({
  id,
  status: "complete",
  ...rest,
});

describe("readAutorouterPhases", () => {
  it("keeps what core says of a phase and drops what is not one", () => {
    expect(
      readAutorouterPhases([
        {
          id: "run1-phase1",
          status: "error",
          errorMessage: "Ran out of iterations",
          subcircuit_id: "subcircuit_source_group_0",
          componentDisplayName: "<board#40 />",
          phaseName: "fanout",
          phaseOrdinal: 1,
          phaseStageIndex: 0,
          phaseStageCount: 2,
          connectionCount: 12,
          obstacleCount: 48,
          isReroutePhase: false,
          solverName: "AutoroutingPipelineSolver",
        },
        { id: "run1-phase2", status: "queued" },
        { status: "running" },
        null,
      ]),
    ).toEqual([
      {
        id: "run1-phase1",
        status: "error",
        errorMessage: "Ran out of iterations",
        subcircuitId: "subcircuit_source_group_0",
        componentDisplayName: "<board#40 />",
        phaseName: "fanout",
        phaseOrdinal: 1,
        phaseStageIndex: 0,
        phaseStageCount: 2,
        connectionCount: 12,
        obstacleCount: 48,
      },
    ]);
    expect(readAutorouterPhases("phases")).toEqual([]);
  });
});

describe("autorouterPhaseTitles", () => {
  it("numbers the phases of one board, and uses a phase's own name", () => {
    expect(
      autorouterPhaseTitles([
        phase("a", { phaseOrdinal: 1 }),
        phase("b", { phaseName: "fanout", phaseStageIndex: 1, phaseStageCount: 3 }),
        phase("c"),
      ]),
    ).toEqual(["Phase 1", "fanout, stage 2 of 3", "Phase 3"]);
  });

  it("says which group a phase routed when several were routed", () => {
    expect(
      autorouterPhaseTitles([
        phase("a", {
          subcircuitId: "group_1",
          componentDisplayName: '<group#12 name=".power" />',
          phaseOrdinal: 1,
        }),
        phase("b", {
          subcircuitId: "group_0",
          componentDisplayName: "<board#40 />",
          phaseOrdinal: 1,
        }),
      ]),
    ).toEqual(["power: Phase 1", "board: Phase 1"]);
  });
});

it("summarises what a phase was asked to route", () => {
  expect(autorouterPhaseSummary(phase("a", { connectionCount: 1, obstacleCount: 6 }))).toBe(
    "1 connection · 6 obstacles",
  );
  expect(autorouterPhaseSummary(phase("a", { connectionCount: 3, isReroutePhase: true }))).toBe(
    "3 connections · reroutes earlier traces",
  );
  expect(autorouterPhaseSummary(phase("a"))).toBe("");
});

it("picks the phase that failed, else the last one", () => {
  expect(defaultAutorouterPhaseId([])).toBeNull();
  expect(defaultAutorouterPhaseId([phase("a"), phase("b")])).toBe("b");
  expect(defaultAutorouterPhaseId([phase("a"), phase("b", { status: "error" }), phase("c")])).toBe(
    "b",
  );
});

it("titles a report after the project, the file and the phase", () => {
  const title = (cwd: string | undefined) =>
    defaultAutorouterReportTitle({ cwd, file: "boards/main.tsx", phaseTitle: "Phase 2" });
  expect(title("/home/seve/motor-controller/")).toBe("motor-controller/boards/main.tsx - Phase 2");
  expect(title("C:\\work\\motor-controller")).toBe("motor-controller/boards/main.tsx - Phase 2");
  expect(title(undefined)).toBe("boards/main.tsx - Phase 2");
});

describe("isSimpleRouteJson", () => {
  const input = {
    layerCount: 2,
    minTraceWidth: 0.15,
    connections: [],
    obstacles: [],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  };

  it("accepts an autorouter input", () => {
    expect(isSimpleRouteJson(input)).toBe(true);
  });

  it.each([
    null,
    [],
    { ...input, layerCount: 0 },
    { ...input, minTraceWidth: 0 },
    { ...input, connections: undefined },
    { ...input, obstacles: {} },
    { ...input, bounds: { ...input.bounds, maxX: -10 } },
    { ...input, bounds: { ...input.bounds, minY: Number.NaN } },
  ])("rejects %j", (value) => {
    expect(isSimpleRouteJson(value)).toBe(false);
  });
});
