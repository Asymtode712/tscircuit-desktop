import type { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import type { ComposerThreadTarget } from "~/composerDraftStore";

vi.mock(import("./projectFsMap"), () => ({
  loadProjectFsMap: async () => ({
    fsMap: { "index.tsx": "export default () => null" },
    hashedFiles: null,
    truncated: false,
  }),
  pickEntryFile: () => "index.tsx",
  readBuiltCircuitJson: async () => null,
}));
vi.mock(import("./viewerFrame"), () => ({
  viewerFrame: () => ({ src: "about:blank", sandbox: "allow-scripts", targetOrigin: "*" }),
}));

// Keep the dialog boundary observable without opening external report destinations.
vi.mock(import("./AutorouterReportDialog"), () => ({
  AutorouterReportDialog: (props) => (
    <output data-testid="routing-report">{props.phases.map((phase) => phase.id).join(",")}</output>
  ),
}));

import CircuitPanel from "./CircuitPanel";

function send(frame: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data }));
}
function ready(frame: HTMLIFrameElement) {
  send(frame, {
    runframe_type: "runframe_ready_to_receive",
    runframe_capabilities: ["show_header", "active_tab", "render_events"],
  });
}
function rendered(frame: HTMLIFrameElement) {
  send(frame, {
    runframe_type: "runframe_event",
    runframe_event: {
      type: "render_finished",
      circuit_json_element_counts: { pcb_board: 1, schematic_component: 1 },
    },
  });
}

it("caps the split at two, isolates pane navigation/errors, and closes with focus retained", async () => {
  const props = {
    environmentId: "test" as EnvironmentId,
    cwd: "/test",
    relativePath: "index.tsx",
    visible: true,
    workspaceMutationId: null,
    composerDraftTarget: {} as ComposerThreadTarget,
  };
  // This isolated circuit panel has no route-dependent behavior.
  await using screen = await render(<CircuitPanel {...props} />, { router: false });
  await expect
    .element(screen.getByRole("button", { name: "Split view", exact: true }))
    .toBeVisible();
  await vi.waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(1));
  const leftFrame = document.querySelector("iframe")!;
  await act(() => ready(leftFrame));
  await act(() => rendered(leftFrame));
  await screen.getByRole("button", { name: "Split view", exact: true }).click();
  await vi.waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2));
  await expect
    .element(screen.getByRole("button", { name: "Split view", exact: true }))
    .toBeDisabled();
  const rightFrame = document.querySelectorAll("iframe")[1]!;
  await act(() => ready(rightFrame));
  await act(() => rendered(rightFrame));
  await act(() => {
    send(leftFrame, {
      runframe_type: "runframe_event",
      runframe_event: {
        type: "autorouter_phases",
        phases: [{ id: "primary-route", status: "complete" }],
      },
    });
    send(rightFrame, {
      runframe_type: "runframe_event",
      runframe_event: {
        type: "autorouter_phases",
        phases: [{ id: "comparison-route", status: "complete" }],
      },
    });
  });
  await vi.waitFor(() => {
    expect(document.querySelectorAll('[data-testid="routing-report"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="routing-report"]')?.textContent).toBe(
      "primary-route",
    );
  });
  await act(() =>
    send(rightFrame, {
      runframe_type: "runframe_event",
      runframe_event: { type: "active_tab_changed", tab: "cad" },
    }),
  );
  const left = document.querySelector('[aria-label="Primary circuit view"]')!;
  const right = document.querySelector('[aria-label="Secondary circuit view"]')!;
  await vi.waitFor(() => {
    expect(left.textContent).not.toContain("1 error");
    expect(right.querySelector('[data-state="on"], [aria-pressed="true"]')?.textContent).toContain(
      "3D",
    );
  });
  await act(() =>
    send(rightFrame, {
      runframe_type: "runframe_event",
      runframe_event: { type: "error", error_message: "Right failed" },
    }),
  );
  await vi.waitFor(() => {
    expect(right.textContent).toContain("1 error");
    expect(left.textContent).not.toContain("1 error");
  });
  await screen.rerender(<CircuitPanel {...props} cwd={undefined} />);
  await screen.getByRole("button", { name: "Close split view", exact: true }).click();
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  expect(document.querySelector("iframe")).toBe(leftFrame);
  expect(document.activeElement?.textContent).toBe("Split view");
});
