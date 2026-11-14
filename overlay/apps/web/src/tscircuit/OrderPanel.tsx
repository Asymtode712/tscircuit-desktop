import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { Fragment, useEffect, useReducer, useState } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import { expectedBuild } from "./builtCircuit";
import { Cover, Notice, useBuiltCircuit } from "./CircuitPanel";
import { circuitTabFile } from "./circuitSurface";
import {
  circuitPanelReducer,
  countErrors,
  type ElementCounts,
  initialCircuitPanelState,
  viewStateForFile,
} from "./circuitViews";
import {
  describeEstimateOrder,
  formatEstimateTotal,
  formatUsd,
  type JlcpcbEstimate,
  readJlcpcbEstimate,
} from "./jlcpcbEstimate";
import {
  countBuildElements,
  ORDER_FILES,
  orderFileName,
  orderFileNeedsMet,
  orderProjectName,
  packOrderFiles,
  readOrderFiles,
  saveBlob,
} from "./orderFiles";
import { setOrderFile } from "./orderActions";
import { circuitFileCandidates, pickFileToOrder } from "./projectFsMap";
import { useProjectFiles } from "./useProjectFiles";
import { useRunFrameController } from "./useRunFrameController";

type OrderFile = (typeof ORDER_FILES)[number];

/** The viewer tab behind the page. It is never seen; this one also fetches the BOM converter. */
const RENDERED_TAB = "bom";

const FILES_TIMEOUT_MS = 120_000;
/** A quote looks each part up at JLCPCB, about a second a part. */
const QUOTE_TIMEOUT_MS = 300_000;

const WHY_UNAVAILABLE: Readonly<Record<OrderFile["needs"], string>> = {
  board: "Not available: this file has no <board>.",
  parts: "Not available: no parts are placed on the board.",
};

const MANUFACTURERS = [
  {
    name: "JLCPCB",
    priced: true,
    site: "jlcpcb.com",
    url: "https://cart.jlcpcb.com/quote",
    summary: "Makes bare boards, and assembles them with parts from its own library.",
    steps: [
      "Upload the Gerbers zip to get a price for the board.",
      "To have the parts soldered on, switch on PCB Assembly, then upload the bill of materials and the pick and place file where it asks for the BOM and the CPL.",
    ],
  },
  {
    name: "CircuitHub",
    priced: false,
    site: "circuithub.com",
    url: "https://circuithub.com/",
    summary: "Assembles boards from the design files. It does not take Gerbers.",
    steps: [
      "Unzip the KiCad project.",
      "Create a project on CircuitHub and upload the three KiCad files to get a price.",
    ],
  },
] as const;

export default function OrderPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  /** The thread whose panel this tab is in: its file choice is kept there, beside the Circuit tab's. */
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
  readonly workspaceMutationId: string | null;
}) {
  const { environmentId, cwd, visible, workspaceMutationId } = props;
  const { threadRef } = props;
  const chosenFile = useRightPanelStore(
    (state) =>
      selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces.find(
        (surface) => surface.kind === "order",
      )?.relativePath ?? null,
  );
  const openCircuitFile = useRightPanelStore((state) =>
    circuitTabFile(selectThreadRightPanelState(state.byThreadKey, threadRef)),
  );
  const [choosing, setChoosing] = useState(false);
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const projectState = useProjectFiles({ environmentId, cwd, visible, workspaceMutationId });
  const project = projectState.status === "ready" ? projectState.project : null;
  const candidates = project === null ? [] : circuitFileCandidates(project.fsMap);
  const entryFile =
    project === null
      ? null
      : pickFileToOrder({
          fsMap: project.fsMap,
          chosen: chosenFile,
          circuitTabFile: openCircuitFile,
        });

  // A build of the sources as they are now is ordered as it is, without running them again.
  const built = useBuiltCircuit({
    environmentId,
    cwd,
    visible,
    workspaceMutationId,
    build:
      entryFile === null || !project?.hashedFiles
        ? null
        : expectedBuild(entryFile, project.hashedFiles),
  });

  if (!cwd || project === null || candidates.length === 0) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col bg-background" data-order-panel>
        <Cover>
          {!cwd ? (
            <Notice title="No project folder" description="Open a project to order its board." />
          ) : projectState.status === "failed" ? (
            <Notice
              title="Couldn't read the project"
              description="The project's files could not be read from this environment."
            />
          ) : project === null ? (
            <Notice title="Reading project files" busy />
          ) : (
            <Notice
              title="No circuit yet"
              description="This project has no .tsx files. Ask the agent for a circuit, then order it here."
            />
          )}
        </Cover>
      </div>
    );
  }
  if (entryFile === null || choosing) {
    return (
      <OrderFileChooser
        candidates={candidates}
        current={entryFile}
        onPick={(relativePath) => {
          setOrderFile(threadRef, relativePath);
          setChoosing(false);
        }}
        onCancel={entryFile === null ? null : () => setChoosing(false)}
      />
    );
  }
  return (
    <OrderPage
      key={`${viewerAttempt}:${entryFile}`}
      fsMap={project.fsMap}
      entryFile={entryFile}
      lookingForBuild={built.status === "checking"}
      buildText={
        built.status === "current"
          ? (built.files.fsMap[built.files.mainComponentPath] ?? null)
          : null
      }
      projectName={orderProjectName(entryFile, cwd)}
      truncated={project.truncated}
      onChangeFile={candidates.length > 1 ? () => setChoosing(true) : null}
      onRetry={() => setViewerAttempt((attempt) => attempt + 1)}
    />
  );
}

const directoryOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const fileNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Asks which circuit to order, when the project has several and none is on screen to go by. */
function OrderFileChooser(props: {
  readonly candidates: ReadonlyArray<string>;
  /** The file being ordered now, when this is a change of mind. */
  readonly current: string | null;
  readonly onPick: (relativePath: string) => void;
  readonly onCancel: (() => void) | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-order-panel>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-6">
          <header className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h2 className="font-semibold text-lg">Which circuit do you want to order?</h2>
              <p className="text-muted-foreground text-sm">
                Pick the file with the board to have made.
              </p>
            </div>
            {props.onCancel === null ? null : (
              <Button size="sm" variant="outline" onClick={props.onCancel}>
                Cancel
              </Button>
            )}
          </header>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {props.candidates.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-baseline gap-2 px-3.5 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
                  onClick={() => props.onPick(path)}
                >
                  <span className="shrink-0 font-medium text-sm">{fileNameOf(path)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                    {directoryOf(path)}
                  </span>
                  {path === props.current ? (
                    <CheckIcon aria-label="Being ordered now" className="size-3.5 self-center" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** What stands between the design and its files, if anything. */
type Readiness =
  | { readonly status: "preparing"; readonly message: string }
  | { readonly status: "viewer_failed" }
  | { readonly status: "run_failed"; readonly message: string }
  | { readonly status: "ready"; readonly counts: ElementCounts };

type EstimateOutcome =
  | { readonly status: "ready"; readonly estimate: JlcpcbEstimate }
  | { readonly status: "failed"; readonly message: string };

function OrderPage(props: {
  readonly fsMap: Record<string, string>;
  readonly entryFile: string;
  /** True until it is known whether there is a build to order instead of running the file. */
  readonly lookingForBuild: boolean;
  /** The Circuit JSON of a build of the sources as they are now, when there is one. */
  readonly buildText: string | null;
  readonly projectName: string;
  readonly truncated: boolean;
  /** Null when the project has no other circuit to order. */
  readonly onChangeFile: (() => void) | null;
  readonly onRetry: () => void;
}) {
  const { fsMap, entryFile, projectName, buildText } = props;
  const buildCounts = buildText === null ? null : countBuildElements(buildText);
  // A build that cannot be read is not ordered: the sources are run, as with no build.
  const circuitJsonText = buildCounts === null ? null : buildText;
  const [panelState, dispatch] = useReducer(
    circuitPanelReducer,
    RENDERED_TAB,
    initialCircuitPanelState,
  );
  const view = viewStateForFile(panelState, entryFile);
  // The frame makes the files, out of sight behind the page, and runs the sources without a build.
  const { frameRef, frame, status, request } = useRunFrameController({
    fsMap: props.lookingForBuild || buildCounts !== null ? null : fsMap,
    mainComponentPath: entryFile,
    screen: RENDERED_TAB,
    dispatch,
  });
  const [making, setMaking] = useState<OrderFile["kind"] | null>(null);
  const [quoted, setQuoted] = useState<{
    readonly file: string;
    readonly run: number;
    readonly circuitJsonText: string | null;
    readonly outcome: EstimateOutcome;
  } | null>(null);

  const readiness: Readiness =
    status === "failed"
      ? { status: "viewer_failed" }
      : status === "loading"
        ? { status: "preparing", message: "Loading the circuit viewer" }
        : buildCounts !== null
          ? { status: "ready", counts: buildCounts }
          : props.lookingForBuild
            ? { status: "preparing", message: `Looking for a build of ${entryFile}` }
            : view.running
              ? { status: "preparing", message: `Rendering ${entryFile}` }
              : view.executionError !== null
                ? { status: "run_failed", message: view.executionError }
                : view.counts === null
                  ? { status: "preparing", message: `Rendering ${entryFile}` }
                  : { status: "ready", counts: view.counts };
  const needsMet = readiness.status === "ready" ? orderFileNeedsMet(readiness.counts) : null;
  const errorCount = readiness.status === "ready" ? countErrors(readiness.counts) : 0;

  const quotable = needsMet?.has("board") === true;
  const run = view.completedRuns;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the viewer frame, an external system, to price the circuit it has just rendered
  useEffect(() => {
    if (!quotable) return;
    let superseded = false;
    const settle = (outcome: EstimateOutcome) => {
      if (!superseded) setQuoted({ file: entryFile, run, circuitJsonText, outcome });
    };
    request({ kind: "jlcpcb_quote", projectName, circuitJsonText }, QUOTE_TIMEOUT_MS).then(
      (payload) => {
        const estimate = readJlcpcbEstimate(payload);
        settle(
          estimate === null
            ? {
                status: "failed",
                message: "The estimate came back in a form this app cannot read.",
              }
            : { status: "ready", estimate },
        );
      },
      (cause: unknown) =>
        settle({
          status: "failed",
          message: cause instanceof Error ? cause.message : "The estimate could not be made.",
        }),
    );
    return () => {
      superseded = true;
    };
  }, [quotable, entryFile, run, circuitJsonText, projectName, request]);
  const outcome =
    quoted?.file === entryFile && quoted.run === run && quoted.circuitJsonText === circuitJsonText
      ? quoted.outcome
      : null;

  const download = async (file: OrderFile) => {
    setMaking(file.kind);
    try {
      const contents = readOrderFiles(
        await request({ kind: file.kind, projectName, circuitJsonText }, FILES_TIMEOUT_MS),
      );
      if (contents === null) throw new Error("The viewer did not return files that can be saved.");
      saveBlob(await packOrderFiles(file, contents), orderFileName(file, projectName));
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: `Couldn't make the ${file.label} file`,
        description: cause instanceof Error ? cause.message : "Try again.",
      });
    } finally {
      setMaking(null);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background" data-order-panel>
      <iframe
        ref={frameRef}
        src={frame.src}
        sandbox={frame.sandbox}
        title="Circuit renderer"
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none invisible absolute inset-0 size-full border-0"
      />
      <div className="scrollbar-gutter-both relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-6">
          <header className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate font-semibold text-lg">Order {entryFile}</h2>
              {props.onChangeFile === null ? null : (
                <Button size="xs" variant="outline" onClick={props.onChangeFile}>
                  Change
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Download the files a manufacturer needs, then upload them where you order. They are
              made from the design as it is now.
            </p>
          </header>

          {readiness.status === "preparing" ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
              <Spinner className="size-3.5" />
              {readiness.message}
            </p>
          ) : readiness.status === "viewer_failed" ? (
            <Alert variant="error">
              <AlertTitle>The circuit viewer didn't start</AlertTitle>
              <AlertDescription>
                The files are made by the viewer, which is part of the app. This is a fault in the
                app and not in your project.
              </AlertDescription>
              <AlertAction>
                <Button size="sm" variant="outline" onClick={props.onRetry}>
                  Try again
                </Button>
              </AlertAction>
            </Alert>
          ) : readiness.status === "run_failed" ? (
            <Alert variant="error">
              <AlertTitle>This file didn't run, so there is nothing to order yet</AlertTitle>
              <AlertDescription>
                <span className="wrap-anywhere line-clamp-3 font-mono text-xs">
                  {readiness.message}
                </span>
              </AlertDescription>
            </Alert>
          ) : errorCount > 0 ? (
            <Alert variant="warning">
              <AlertTitle>
                {errorCount === 1
                  ? "This design has 1 error"
                  : `This design has ${errorCount} errors`}
              </AlertTitle>
              <AlertDescription>
                The files can still be made. Read the errors in the Circuit tab before you order.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="flex flex-col gap-2" aria-label="Files">
            <h3 className="font-medium text-sm">Files</h3>
            <ul className="divide-y rounded-xl border">
              {ORDER_FILES.map((file) => {
                const unavailable = needsMet !== null && !needsMet.has(file.needs);
                return (
                  <li key={file.kind} className="flex items-center gap-3 px-3.5 py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 font-medium text-sm">{file.label}</span>
                        <span className="truncate font-mono text-muted-foreground text-xs">
                          {orderFileName(file, projectName)}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {unavailable ? WHY_UNAVAILABLE[file.needs] : file.description}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={needsMet === null || unavailable || making !== null}
                      onClick={() => void download(file)}
                    >
                      {making === file.kind ? <Spinner /> : <DownloadIcon />}
                      Download
                    </Button>
                  </li>
                );
              })}
            </ul>
            {props.truncated ? (
              <p className="text-muted-foreground text-xs">
                This project is too large to read whole, so some files were left out. Check the
                design in the Circuit tab first.
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2" aria-label="Where to order">
            <h3 className="font-medium text-sm">Where to order</h3>
            {MANUFACTURERS.map((manufacturer) => (
              <article
                key={manufacturer.name}
                className="flex flex-col gap-2 rounded-xl border p-3.5"
              >
                <div className="flex items-center gap-2">
                  <h4 className="min-w-0 flex-1 font-medium text-sm">{manufacturer.name}</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<a href={manufacturer.url} target="_blank" rel="noopener noreferrer" />}
                  >
                    {manufacturer.site}
                    <ExternalLinkIcon aria-hidden />
                  </Button>
                  {manufacturer.priced && quotable ? <JlcpcbPrice outcome={outcome} /> : null}
                </div>
                <p className="text-muted-foreground text-sm">{manufacturer.summary}</p>
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                  {manufacturer.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

/** JLCPCB's price for its smallest order, beside the link. Hovering it shows what the price is made of. */
function JlcpcbPrice(props: { readonly outcome: EstimateOutcome | null }) {
  const { outcome } = props;
  if (outcome === null) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs" role="status">
        <Spinner className="size-3" />
        Estimating
      </span>
    );
  }
  if (outcome.status === "failed") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} className="cursor-help text-muted-foreground text-xs" />}
        >
          (no estimate)
        </TooltipTrigger>
        <TooltipPopup side="bottom" align="end">
          JLCPCB's price could not be estimated: {outcome.message}
        </TooltipPopup>
      </Tooltip>
    );
  }
  const { estimate } = outcome;
  const unpriced = estimate.unpricedDesignators;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="cursor-help text-sm tabular-nums underline decoration-dotted underline-offset-4"
          />
        }
      >
        ({formatEstimateTotal(estimate)}
        {unpriced.length > 0 ? "+" : ""})
      </TooltipTrigger>
      <TooltipPopup side="bottom" align="end" className="max-w-96">
        <div className="flex flex-col gap-2 py-1 text-left">
          <p className="font-medium">
            Estimate for JLCPCB's smallest order: {describeEstimateOrder(estimate)}
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {estimate.rows.map((row) => (
              <Fragment key={row.label}>
                <dt>
                  {row.label}
                  {row.note === null ? null : (
                    <span className="block text-muted-foreground">{row.note}</span>
                  )}
                </dt>
                <dd className="text-right tabular-nums">{formatUsd(row.total)}</dd>
              </Fragment>
            ))}
            <dt className="border-t pt-1 font-medium">Total</dt>
            <dd className="border-t pt-1 text-right font-medium tabular-nums">
              {formatUsd(estimate.total)}
            </dd>
          </dl>
          {estimate.lowTotal === estimate.highTotal ? null : (
            <p className="text-muted-foreground">
              Likely between {formatUsd(estimate.lowTotal)} and {formatUsd(estimate.highTotal)}.
            </p>
          )}
          {unpriced.length === 0 ? null : (
            <p>
              Not in the price, because no JLCPCB part was found for them: {unpriced.join(", ")}.
            </p>
          )}
          {estimate.destinationNote === null ? null : (
            <p className="text-muted-foreground">{estimate.destinationNote}</p>
          )}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
