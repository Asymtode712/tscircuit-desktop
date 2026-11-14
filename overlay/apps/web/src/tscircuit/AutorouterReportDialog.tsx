import { useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { ensureLocalApi } from "~/localApi";

import {
  type AutorouterPhase,
  autorouterPhaseSummary,
  autorouterPhaseTitles,
  defaultAutorouterPhaseId,
  defaultAutorouterReportTitle,
  isSimpleRouteJson,
} from "./autorouterPhases";
import {
  createAutorouterBugReport,
  forgetSessionToken,
  readSessionToken,
  saveSessionToken,
  signInToTscircuit,
} from "./tscircuitRegistry";

/** Where the circuit's build stands. Its phases can only be reported once it has routed. */
type AutorouterBuild =
  | { readonly state: "building" }
  | { readonly state: "built" }
  /** There is nothing to build, or the build cannot run. */
  | { readonly state: "unavailable"; readonly reason: string };

interface ReportProps {
  readonly cwd: string | undefined;
  /** The file the Circuit tab built. */
  readonly file: string | null;
  readonly build: AutorouterBuild;
  /** The autorouting phases of that build so far. */
  readonly phases: ReadonlyArray<AutorouterPhase>;
  readonly onRebuild: () => void;
  /** The Simple Route JSON a phase started from, or null when the viewer no longer has it. */
  readonly loadPhaseInput: (phaseId: string) => Promise<unknown>;
  readonly onClose: () => void;
}

/** Opened from the command palette, over the Circuit tab whose build it reports. */
export function AutorouterReportDialog(props: ReportProps & { readonly open: boolean }) {
  const { open, ...report } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      {open ? (
        <DialogPopup className="sm:max-w-xl">
          <AutorouterReport {...report} />
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}

type Step =
  | { readonly kind: "form"; readonly error: string | null }
  | { readonly kind: "working"; readonly label: string }
  | { readonly kind: "done"; readonly url: string };

function AutorouterReport(props: ReportProps) {
  const { phases, build, file } = props;
  const id = useId();
  const [pickedPhaseId, setPickedPhaseId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: "form", error: null });
  const [signedIn, setSignedIn] = useState(() => readSessionToken() !== null);
  const requestRef = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closing the dialog abandons the sign-in or upload it was waiting on, which are requests to tscircuit's API
  useEffect(() => () => requestRef.current?.abort(), []);

  const titles = autorouterPhaseTitles(phases);
  // A rebuild replaces the phases, and with them the one that was picked.
  const pickedIndex = phases.findIndex((entry) => entry.id === pickedPhaseId);
  const defaultPhaseId = defaultAutorouterPhaseId(phases);
  const index =
    pickedIndex === -1 ? phases.findIndex((entry) => entry.id === defaultPhaseId) : pickedIndex;
  const phase = phases[index];
  const title =
    editedTitle ??
    (file === null || phase === undefined
      ? ""
      : defaultAutorouterReportTitle({ cwd: props.cwd, file, phaseTitle: titles[index] ?? "" }));

  const submit = async () => {
    if (phase === undefined || title.trim() === "") return;
    const request = new AbortController();
    requestRef.current = request;
    const { signal } = request;
    const fail = (error: string) => setStep({ kind: "form", error });
    try {
      setStep({ kind: "working", label: "Getting the routing problem from the viewer" });
      const simpleRouteJson = await props.loadPhaseInput(phase.id);
      if (signal.aborted) return;
      if (!isSimpleRouteJson(simpleRouteJson)) {
        fail("The viewer no longer has what this phase was given. Build again, then report it.");
        return;
      }
      let token = readSessionToken();
      // A saved session can have run out, so a refused one is replaced once.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (token === null) {
          setStep({ kind: "working", label: "Waiting for you to sign in in your browser" });
          const signIn = await signInToTscircuit({
            signal,
            openUrl: (url) => ensureLocalApi().shell.openExternal(url),
          });
          if (signIn.kind !== "signed_in") {
            fail(
              signIn.kind === "expired"
                ? "The sign-in page expired before you finished. Try again."
                : `Couldn't sign in to tscircuit. ${signIn.message}`,
            );
            return;
          }
          token = signIn.token;
          saveSessionToken(token);
          setSignedIn(true);
        }
        setStep({ kind: "working", label: "Sending the report" });
        const result = await createAutorouterBugReport({
          title: title.trim(),
          simpleRouteJson,
          token,
          signal,
        });
        if (result.kind === "created") {
          setStep({ kind: "done", url: result.url });
          return;
        }
        if (result.kind === "sign_in_required") {
          forgetSessionToken();
          setSignedIn(false);
          token = null;
          continue;
        }
        fail(
          result.kind === "too_large"
            ? "This routing problem is too large to report from here. Dump it with `tsci build --autorouter-dump-srj` and attach the file to a GitHub issue."
            : `Couldn't send the report. ${result.message}`,
        );
        return;
      }
      fail("tscircuit did not accept the sign-in. Try again.");
    } catch (error) {
      if (signal.aborted) return;
      fail(error instanceof Error ? error.message : "Couldn't send the report.");
    }
  };
  const cancel = () => {
    requestRef.current?.abort();
    setStep({ kind: "form", error: null });
  };

  if (step.kind === "done") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Report filed</DialogTitle>
          <DialogDescription>
            The autorouter team can replay this routing problem from the report.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <p className="wrap-anywhere rounded-lg border bg-muted/40 p-3 font-mono text-xs">
            {step.url}
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void writeTextToClipboard(step.url).then(
                () => toastManager.add({ type: "success", title: "Link copied" }),
                () => toastManager.add({ type: "error", title: "Couldn't copy the link" }),
              );
            }}
          >
            Copy link
          </Button>
          <Button
            type="button"
            onClick={() => {
              void ensureLocalApi()
                .shell.openExternal(step.url)
                .catch(() => toastManager.add({ type: "error", title: "Couldn't open the link" }));
            }}
          >
            Open report
          </Button>
        </DialogFooter>
      </>
    );
  }

  const working = step.kind === "working";
  const building = build.state === "building";
  return (
    <>
      <DialogHeader>
        <DialogTitle>Report an autorouter bug</DialogTitle>
        <DialogDescription>
          Sends what the autorouter was given for one routing phase
          {file === null ? "" : ` of ${file}`}, so the tscircuit team can reproduce what it did.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {working ? (
          <Busy>{step.label}</Busy>
        ) : build.state === "unavailable" ? (
          <p className="text-muted-foreground text-sm">{build.reason}</p>
        ) : phase === undefined ? (
          building ? (
            <Busy>Building {file ?? "the circuit"} to capture what the autorouter is given</Busy>
          ) : (
            <p className="text-muted-foreground text-sm">
              This build did not run the autorouter, so there is nothing to report. A circuit is
              routed when it has traces to route and runs without errors.
            </p>
          )
        ) : (
          <>
            {phases.length > 1 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 font-medium text-sm">Which phase went wrong?</legend>
                <RadioGroup value={phase.id} onValueChange={(value) => setPickedPhaseId(value)}>
                  {phases.map((entry, entryIndex) => (
                    <label key={entry.id} className="flex items-start gap-2">
                      <Radio value={entry.id} />
                      <PhaseLine phase={entry} title={titles[entryIndex] ?? ""} />
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
            ) : (
              <PhaseLine phase={phase} title={titles[index] ?? ""} />
            )}
            {building ? (
              <p className="flex items-center gap-2 text-muted-foreground text-xs">
                <Spinner className="size-3" />
                Still routing. Later phases show up here as they start.
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-title`}>Title</Label>
              <Input
                id={`${id}-title`}
                value={title}
                onChange={(event) => setEditedTitle(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground text-sm">
              Autorouter bug reports are public: anyone can download the routing data you send.
              {signedIn ? "" : " Reports are filed from a tscircuit account, so you sign in first."}
            </p>
          </>
        )}
        {step.kind === "form" && step.error !== null ? (
          <Alert variant="error">
            <AlertDescription>{step.error}</AlertDescription>
          </Alert>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={working ? cancel : props.onClose}>
          Cancel
        </Button>
        {working || build.state !== "built" ? null : (
          <Button type="button" variant="outline" onClick={props.onRebuild}>
            Build again
          </Button>
        )}
        <Button
          type="button"
          disabled={working || phase === undefined || title.trim() === ""}
          onClick={() => void submit()}
        >
          {signedIn ? "Send report" : "Sign in and send"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Busy(props: { readonly children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm" role="status">
      <Spinner className="size-4" />
      {props.children}
    </p>
  );
}

function PhaseLine(props: { readonly phase: AutorouterPhase; readonly title: string }) {
  const { phase } = props;
  const summary = autorouterPhaseSummary(phase);
  return (
    <span className="flex min-w-0 flex-col gap-0.5 text-sm">
      <span className="flex items-center gap-2">
        {props.title}
        {phase.status === "running" ? <Spinner className="size-3" /> : null}
        {phase.status === "error" ? <span className="text-destructive text-xs">Failed</span> : null}
      </span>
      {summary === "" ? null : <span className="text-muted-foreground text-xs">{summary}</span>}
      {phase.errorMessage === undefined ? null : (
        <span className="wrap-anywhere line-clamp-2 text-muted-foreground text-xs">
          {phase.errorMessage}
        </span>
      )}
    </span>
  );
}
