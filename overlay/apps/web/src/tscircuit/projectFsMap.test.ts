import { describe, expect, it } from "vite-plus/test";

import {
  circuitFileCandidates,
  isProjectSourceFile,
  pickEntryFile,
  pickFileToOrder,
  readProject,
  selectedCircuitFile,
  shouldWalkDirectory,
} from "./projectFsMap";

describe("readProject", () => {
  it("rejects a failed directory listing", async () => {
    await expect(
      readProject({
        list: async () => null,
        read: async () => null,
      }),
    ).rejects.toThrow("Could not list project files");
  });

  it("rejects a failed source file read", async () => {
    await expect(
      readProject({
        list: async () => ({
          entries: [{ path: "index.tsx", kind: "file" }],
          truncated: false,
        }),
        read: async () => null,
      }),
    ).rejects.toThrow("Could not read project file: index.tsx");
  });
});

describe("pickEntryFile", () => {
  it("prefers the entrypoint named in tscircuit.config.json", () => {
    const fsMap = {
      "index.tsx": "",
      "boards/main.tsx": "",
      "tscircuit.config.json": JSON.stringify({ mainEntrypoint: "./boards/main.tsx" }),
    };
    expect(pickEntryFile(fsMap)).toBe("boards/main.tsx");
  });

  it("falls back to index.tsx, then to the shallowest circuit file", () => {
    expect(pickEntryFile({ "lib/part.tsx": "", "index.tsx": "" })).toBe("index.tsx");
    expect(pickEntryFile({ "lib/deep/part.tsx": "", "boards/usb.circuit.tsx": "" })).toBe(
      "boards/usb.circuit.tsx",
    );
    expect(pickEntryFile({ "lib/deep/part.tsx": "", "board.tsx": "" })).toBe("board.tsx");
  });

  it("ignores a configured entrypoint that does not exist, and unreadable config", () => {
    const missing = JSON.stringify({ mainEntrypoint: "gone.tsx" });
    expect(pickEntryFile({ "index.tsx": "", "tscircuit.config.json": missing })).toBe("index.tsx");
    expect(pickEntryFile({ "index.tsx": "", "tscircuit.config.json": "{" })).toBe("index.tsx");
  });

  it("returns null when the project has no .tsx file", () => {
    expect(pickEntryFile({ "package.json": "{}", "lib/math.ts": "" })).toBeNull();
  });
});

describe("selectedCircuitFile", () => {
  const files = { "index.tsx": "", "boards/led.tsx": "" };

  it("uses the entry file only when none was requested", () => {
    expect(selectedCircuitFile(files, null)).toBe("index.tsx");
    expect(selectedCircuitFile(files, "boards/led.tsx")).toBe("boards/led.tsx");
  });

  it("does not substitute the entry file for an unavailable file", () => {
    expect(selectedCircuitFile(files, "boards/deleted.tsx")).toBeNull();
  });
});

describe("pickFileToOrder", () => {
  const fsMap = {
    "index.tsx": "",
    "boards/led.tsx": "",
    "boards/motor.tsx": "",
    "lib/math.ts": "",
  };

  it("lists the files that may hold a circuit, the entry file first", () => {
    expect(circuitFileCandidates(fsMap)).toEqual([
      "index.tsx",
      "boards/led.tsx",
      "boards/motor.tsx",
    ]);
    expect(circuitFileCandidates({ "lib/math.ts": "" })).toEqual([]);
  });

  it("orders the file chosen in the Order tab, over what the Circuit tab shows", () => {
    expect(
      pickFileToOrder({ fsMap, chosen: "boards/motor.tsx", circuitTabFile: "boards/led.tsx" }),
    ).toBe("boards/motor.tsx");
  });

  it("orders what the Circuit tab shows when nothing was chosen, or the choice is gone", () => {
    expect(pickFileToOrder({ fsMap, chosen: null, circuitTabFile: "boards/led.tsx" })).toBe(
      "boards/led.tsx",
    );
    expect(pickFileToOrder({ fsMap, chosen: "deleted.tsx", circuitTabFile: undefined })).toBe(
      "index.tsx",
    );
  });

  it("asks only when there is no Circuit tab and more than one circuit", () => {
    expect(pickFileToOrder({ fsMap, chosen: null, circuitTabFile: null })).toBeNull();
    expect(
      pickFileToOrder({ fsMap: { "board.tsx": "" }, chosen: null, circuitTabFile: null }),
    ).toBe("board.tsx");
  });
});

describe("which project files are sent to the viewer", () => {
  it("sends source files but not lock files or dotfiles", () => {
    expect(isProjectSourceFile("boards/led.tsx")).toBe(true);
    expect(isProjectSourceFile("package.json")).toBe(true);
    expect(isProjectSourceFile("bun.lock")).toBe(false);
    expect(isProjectSourceFile("package-lock.json")).toBe(false);
    expect(isProjectSourceFile(".eslintrc.json")).toBe(false);
    expect(isProjectSourceFile("docs/board.png")).toBe(false);
  });

  it("skips dependency, build and hidden folders", () => {
    expect(shouldWalkDirectory("lib")).toBe(true);
    expect(shouldWalkDirectory("node_modules")).toBe(false);
    expect(shouldWalkDirectory("packages/a/dist")).toBe(false);
    expect(shouldWalkDirectory(".git")).toBe(false);
  });
});
