import type { ScopedThreadRef } from "@t3tools/contracts";
import { RouteIcon } from "lucide-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { useRightPanelStore } from "~/rightPanelStore";

import { useAutorouterReportRequest } from "./autorouterReportRequest";

/** The thread on screen, whose right panel has the Circuit tab. A new thread is still a draft. */
function useThreadOnScreen(): ScopedThreadRef | null {
  const target = useThreadRouteTarget();
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  if (target?.kind === "server") return target.threadRef;
  return draft ? { environmentId: draft.environmentId, threadId: draft.threadId } : null;
}

/**
 * The command palette's "Report autorouter bug". It opens the Circuit tab, which
 * holds the routing problems of the circuit it built, and the tab opens the report dialog.
 * Null where there is no thread, and so no Circuit tab, to open.
 */
export function useAutorouterReportItem(): CommandPaletteActionItem | null {
  const threadRef = useThreadOnScreen();
  if (threadRef === null) return null;
  return {
    kind: "action",
    value: "action:report-autorouter-bug",
    searchTerms: ["report", "autorouter", "autorouting", "routing", "bug", "trace", "pcb", "srj"],
    title: "Report autorouter bug",
    description: "Send a phase of this circuit's routing to the tscircuit autorouter team",
    icon: <RouteIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      useRightPanelStore.getState().open(threadRef, "circuit");
      useAutorouterReportRequest.setState({ requested: true });
    },
  };
}
