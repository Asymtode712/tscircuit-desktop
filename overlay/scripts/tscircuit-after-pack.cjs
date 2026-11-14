const fs = require("node:fs");
const path = require("node:path");

const prepareServerCompileCache = require("./prepare-server-compile-cache.cjs");

// tscircuit desktop: electron-builder names the updater's download folder after
// the package, which is still T3 Code's ("t3code-updater"). With both apps
// installed they would clear each other's downloaded updates, so name our own.
const UPDATER_CACHE_DIR = "tscircuit-desktop-updater";
const CACHE_DIR_LINE = /^updaterCacheDirName: .*$/m;

/** Runs after electron-builder writes app-update.yml, before signing and packaging. */
module.exports = async (context) => {
  await prepareServerCompileCache(context);

  const feedPath = path.join(
    context.packager.getResourcesDir(context.appOutDir),
    "app-update.yml",
  );
  // A build without an update feed has no such file.
  if (!fs.existsSync(feedPath)) return;
  const feed = fs.readFileSync(feedPath, "utf8");
  if (!CACHE_DIR_LINE.test(feed)) {
    throw new Error(`No updaterCacheDirName to replace in ${feedPath}`);
  }
  fs.writeFileSync(feedPath, feed.replace(CACHE_DIR_LINE, `updaterCacheDirName: ${UPDATER_CACHE_DIR}`));
  console.log(`[tscircuit-after-pack] Updater cache folder: ${UPDATER_CACHE_DIR}`);
};
