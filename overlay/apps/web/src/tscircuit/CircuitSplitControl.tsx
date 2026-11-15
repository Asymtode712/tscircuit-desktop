import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { SquareSplitVertical } from "lucide-react";

import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { rightPanelHostRef, useRightPanelStore } from "~/rightPanelStore";

/** The circuit's layout toggle belongs beside the workspace's other layout controls. */
export function CircuitSplitControl(props: {
  readonly threadRef: ScopedThreadRef;
  readonly split: boolean;
}) {
  const label = props.split ? "Close split circuit view" : "Split circuit view";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={props.split}
            onPressedChange={(split) => {
              const key = scopedThreadKey(rightPanelHostRef(props.threadRef));
              useRightPanelStore.setState((state) => {
                const panel = state.byThreadKey[key];
                if (!panel) return state;
                return {
                  byThreadKey: {
                    ...state.byThreadKey,
                    [key]: {
                      ...panel,
                      surfaces: panel.surfaces.map((surface) =>
                        surface.kind === "circuit" ? { ...surface, split } : surface,
                      ),
                    },
                  },
                };
              });
            }}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            <SquareSplitVertical className="size-4" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
