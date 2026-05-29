import { readFileSync, writeFileSync } from "fs";

// Version is passed explicitly by @semantic-release/exec (`node version-bump.mjs <version>`).
// Falls back to the npm lifecycle env var for any manual `npm version` use.
const targetVersion = process.argv[2] ?? process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
