const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

// Electron Builder calls this for the app, native binaries, installer and uninstaller.
exports.default = ({ path }) => {
  execFileSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", join(__dirname, "sign.ps1"), "-Path", path],
    { stdio: "inherit" },
  );
};
