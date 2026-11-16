import { type CircuitPanelState, type CircuitViewId, unmutedViews } from "./circuitViews";

/** Prefer the other layout, without opening an unavailable tab in a partial circuit. */
export function secondCircuitView(view: CircuitPanelState["view"]): CircuitViewId {
  const available = unmutedViews(view);
  for (const candidate of ["schematic", "pcb", "cad", "system", "bom", "drawing"] as const) {
    if (candidate !== view.screen && available.has(candidate)) return candidate;
  }
  return "source";
}
