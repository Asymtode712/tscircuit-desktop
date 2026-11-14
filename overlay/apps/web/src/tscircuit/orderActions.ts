import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import {
  rightPanelHostRef,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { orderSurface } from "./orderSurface";

/** The panel with the Order tab ordering `relativePath`, or leaving the choice open again. */
export const withOrderFile = (
  panel: ThreadRightPanelState,
  relativePath: string | undefined,
): ThreadRightPanelState => ({
  ...panel,
  surfaces: panel.surfaces.map((surface) =>
    surface.kind === "order" ? orderSurface(relativePath) : surface,
  ),
});

/** The file of the circuit on screen: null without one, undefined for the project's entry file. */
export function focusedCircuitFile(panel: ThreadRightPanelState): string | undefined | null {
  if (!panel.isOpen) return null;
  const active = panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId);
  return active?.kind === "circuit" ? active.relativePath : null;
}

export function setOrderFile(ref: ScopedThreadRef, relativePath: string | undefined): void {
  const key = scopedThreadKey(rightPanelHostRef(ref));
  useRightPanelStore.setState((state) => {
    const panel = state.byThreadKey[key];
    return panel === undefined
      ? state
      : { byThreadKey: { ...state.byThreadKey, [key]: withOrderFile(panel, relativePath) } };
  });
}

/**
 * Opens the Order tab, from its button, `/order` or the command palette. A
 * circuit on screen is the one to order. Without one the tab keeps the file it
 * had, and asks which circuit when it has none to go by.
 */
export function openOrderPane(ref: ScopedThreadRef): void {
  const store = useRightPanelStore.getState();
  const focused = focusedCircuitFile(
    selectThreadRightPanelState(store.byThreadKey, rightPanelHostRef(ref)),
  );
  store.open(ref, "order");
  if (focused !== null) setOrderFile(ref, focused);
}
