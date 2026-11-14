import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { keepUnchangedFiles } from "./CircuitPanel";
import { type LoadedProject, loadProjectFsMap } from "./projectFsMap";

const REFRESH_INTERVAL_MS = 3_000;
/** Larger projects refresh on focus and after agent work, not on a timer. */
const MAX_FILES_TO_POLL = 40;

type ProjectFilesState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly project: LoadedProject;
      /** The workspace mutation this read was made for. */
      readonly revision: string | null;
    }
  | { readonly status: "failed" };

/**
 * The project's source files, kept current while the Order tab is visible. The
 * Circuit tab reads them the same way, in its own component.
 */
export function useProjectFiles(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly visible: boolean;
  readonly workspaceMutationId: string | null;
}): ProjectFilesState {
  const { environmentId, cwd, visible, workspaceMutationId } = input;
  const [state, setState] = useState<ProjectFilesState>({ status: "loading" });

  const pollForEdits =
    state.status !== "ready" || Object.keys(state.project.fsMap).length <= MAX_FILES_TO_POLL;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the project's files from the environment; refetches after agent work, on focus, and on a timer for small projects
  useEffect(() => {
    if (!cwd || !visible) return;
    const abort = new AbortController();
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      loadProjectFsMap(environmentId, cwd, abort.signal)
        .then((loaded) => {
          if (abort.signal.aborted) return;
          setState((current) => {
            const project =
              current.status === "ready" ? keepUnchangedFiles(current.project, loaded) : loaded;
            return current.status === "ready" &&
              current.project === project &&
              current.revision === workspaceMutationId
              ? current
              : { status: "ready", project, revision: workspaceMutationId };
          });
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          // A failed refresh keeps the last good read instead of blanking the board.
          setState((current) => (current.status === "ready" ? current : { status: "failed" }));
        })
        .finally(() => {
          loading = false;
        });
    };
    load();
    window.addEventListener("focus", load);
    const interval = pollForEdits ? window.setInterval(load, REFRESH_INTERVAL_MS) : null;
    return () => {
      abort.abort();
      window.removeEventListener("focus", load);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [environmentId, cwd, workspaceMutationId, visible, pollForEdits]);

  return state;
}
