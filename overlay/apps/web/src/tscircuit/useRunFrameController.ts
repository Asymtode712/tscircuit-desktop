import { type Dispatch, type RefObject, useEffect, useRef, useState } from "react";

import { isElectron } from "~/env";

import type { CircuitScreen, CircuitViewAction } from "./circuitViews";
import { type OrderRequest, type OrderResponsePayload, requestFromViewer } from "./orderRequest";
import { parseViewerMessage, viewerFileProps, viewerTabProps } from "./runframeMessages";
import { viewerFrame } from "./viewerFrame";

/**
 * The app's own copy of RunFrame, a bare viewer that takes files over
 * postMessage. `setup` bundles it from the tscircuit package (viewer.json).
 */
const VIEWER_FRAME = viewerFrame({
  desktop: isElectron,
  protocol: window.location.protocol,
  baseUrl: import.meta.env.BASE_URL,
});
const VIEWER_LOAD_TIMEOUT_MS = 30_000;

/** What the viewer reports, with the file it is about. */
export type RunFrameAction = CircuitViewAction & { readonly file: string };

export interface RunFrameController {
  /** Goes on the iframe the controller drives, with `frame`'s src and sandbox. */
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  /** Never the app's origin, in either sandbox: see viewerFrame. */
  readonly frame: { readonly src: string; readonly sandbox: string };
  /** The frame starts loading at once. Remount the component to retry a failed one. */
  readonly status: "loading" | "ready" | "failed";
  /**
   * Has the viewer make something for the Order tab, from a build's Circuit JSON or from the
   * circuit it last ran. A run's answer is refused if newer files went to the viewer meanwhile.
   */
  readonly request: (request: OrderRequest, timeoutMs: number) => Promise<OrderResponsePayload>;
}

/**
 * Drives a RunFrame iframe for the Order tab: sends it the files to run and
 * dispatches what it reports back. The files go when it and they are ready.
 * The Circuit tab drives its own frame, in CircuitPanel.tsx.
 */
export function useRunFrameController(input: {
  /** Null to run nothing, as when a build's Circuit JSON is used instead. */
  readonly fsMap: Record<string, string> | null;
  readonly mainComponentPath: string | null;
  readonly screen: CircuitScreen;
  readonly dispatch: Dispatch<RunFrameAction>;
}): RunFrameController {
  const { fsMap, mainComponentPath, screen, dispatch } = input;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<RunFrameController["status"]>("loading");
  // The files the viewer last received. Its events are about the file named here.
  const sentRef = useRef<{ fsMap: Record<string, string>; mainComponentPath: string } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the viewer frame's messages and gives up waiting for it after a timeout
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // In a browser the frame's origin is "null", so its window is what names it.
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = parseViewerMessage(event.data);
      if (message === null) return;
      if (message.kind === "ready") {
        setStatus("ready");
        return;
      }
      // The autorouter report is the Circuit tab's, and its messages are not about a view.
      if (message.kind === "autorouter_phases" || message.kind === "autorouter_phase_input") return;
      const file = sentRef.current?.mainComponentPath;
      if (file === undefined) return;
      const { kind, ...detail } = message;
      dispatch({ type: kind, file, ...detail } as RunFrameAction);
    };
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(
      () => setStatus((current) => (current === "loading" ? "failed" : current)),
      VIEWER_LOAD_TIMEOUT_MS,
    );
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [dispatch]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the files and the tab to show to the viewer frame, an external system
  useEffect(() => {
    if (status !== "ready" || fsMap === null || mainComponentPath === null) return;
    const sent = sentRef.current;
    const filesChanged = sent?.fsMap !== fsMap || sent.mainComponentPath !== mainComponentPath;
    frameRef.current?.contentWindow?.postMessage(
      {
        runframe_type: "runframe_props_changed",
        // The files go once: resending them would run the circuit again for a change of tab.
        runframe_props: filesChanged
          ? viewerFileProps({ fsMap, mainComponentPath, screen, rebuilds: 0 })
          : viewerTabProps(screen),
      },
      VIEWER_FRAME.targetOrigin,
    );
    if (!filesChanged) return;
    sentRef.current = { fsMap, mainComponentPath };
    dispatch({ type: "files_sent", file: mainComponentPath });
  }, [status, fsMap, mainComponentPath, screen, dispatch]);

  // Reads only refs, so one function serves every render and can be an effect dependency.
  const [request] = useState(
    (): RunFrameController["request"] => async (orderRequest, timeoutMs) => {
      const viewer = frameRef.current?.contentWindow;
      const rendered = sentRef.current;
      const fromRun = orderRequest.circuitJsonText === null;
      if (!viewer || (fromRun && rendered === null)) {
        throw new Error("The circuit viewer is not ready.");
      }
      const payload = await requestFromViewer({
        viewer,
        targetOrigin: VIEWER_FRAME.targetOrigin,
        request: orderRequest,
        timeoutMs,
      });
      // Newer files went to the viewer meanwhile, and this may be from a half-finished run of them.
      if (fromRun && sentRef.current !== rendered) {
        throw new Error("The design changed while this was being made. Try again.");
      }
      return payload;
    },
  );

  return { frameRef, frame: VIEWER_FRAME, status, request };
}
