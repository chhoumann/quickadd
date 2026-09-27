// @ts-check
/**
 * Builds the downloadable example packages from their source manifests.
 *
 *   docs/packages/<id>/package.json   ->   docs/public/packages/<id>.quickadd.json
 *
 * A manifest is a QuickAdd package whose assets point at files in the repo
 * (`source`) instead of carrying base64 `content`, plus an `install` block the
 * docs render as the "After importing" guide. This script inlines the sources
 * and writes the package the docs serve. Run it from the repo root:
 *
 *   pnpm run packages:build          # write every package
 *   pnpm run packages:build --check  # exit 1 when a committed package is stale
 *
 * `tests/examplePackages.test.ts` runs the same check in CI and additionally
 * validates each package against the plugin's real import code.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGES_DIR = here;
export const OUTPUT_DIR = path.resolve(here, "../public/packages");

/** Keys copied from a manifest into the package, in the plugin's export order. */
const PACKAGE_KEYS = /** @type {const} */ ([
	"schemaVersion",
	"quickAddVersion",
	"createdAt",
	"rootChoiceIds",
	"choices",
]);

/**
 * @typedef {object} ManifestAsset
 * @property {string} kind
 * @property {string} originalPath Vault path the file is written to on import.
 * @property {string} source Repo file to bundle, relative to the manifest.
 *
 * @typedef {object} ManifestInstall
 * @property {string[]} [requires] Things the reader needs before importing.
 * @property {string[]} [afterImport] Settings to fill in after importing.
 *
 * @typedef {object} Manifest
 * @property {number} schemaVersion
 * @property {string} quickAddVersion
 * @property {string} createdAt
 * @property {string[]} rootChoiceIds
 * @property {unknown[]} choices
 * @property {ManifestAsset[]} assets
 * @property {ManifestInstall} [install]
 */

/** Every package id, i.e. every `docs/packages/<id>/package.json`. */
export function listPackageIds() {
	return readdirSync(PACKAGES_DIR)
		.filter((name) => {
			const dir = path.join(PACKAGES_DIR, name);
			return (
				statSync(dir).isDirectory() &&
				safeExists(path.join(dir, "package.json"))
			);
		})
		.sort();
}

/** @param {string} id */
export function manifestPath(id) {
	return path.join(PACKAGES_DIR, id, "package.json");
}

/** @param {string} id */
export function outputPath(id) {
	return path.join(OUTPUT_DIR, `${id}.quickadd.json`);
}

/**
 * @param {string} id
 * @returns {Manifest}
 */
export function readManifest(id) {
	return JSON.parse(readFileSync(manifestPath(id), "utf8"));
}

/**
 * Resolve an asset's `source` against its manifest and read it with LF line
 * endings, so the package is identical on every platform.
 * @param {string} id
 * @param {ManifestAsset} asset
 */
export function readAssetSource(id, asset) {
	const file = path.resolve(path.dirname(manifestPath(id)), asset.source);
	if (!file.startsWith(path.resolve(PACKAGES_DIR, "..") + path.sep)) {
		throw new Error(`Package "${id}": asset source escapes docs/: ${asset.source}`);
	}
	return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

/**
 * The package for one manifest, as the JSON text that gets committed.
 * @param {string} id
 */
export function buildPackageJson(id) {
	const manifest = readManifest(id);
	/** @type {Record<string, unknown>} */
	const pkg = {};
	for (const key of PACKAGE_KEYS) {
		if (!(key in manifest)) {
			throw new Error(`Package "${id}": manifest is missing "${key}".`);
		}
		pkg[key] = manifest[key];
	}
	pkg.assets = manifest.assets.map((asset) => {
		const { source, ...rest } = asset;
		if (typeof source !== "string") {
			throw new Error(
				`Package "${id}": asset ${asset.originalPath} needs a "source" file.`,
			);
		}
		return {
			...rest,
			contentEncoding: "base64",
			content: Buffer.from(readAssetSource(id, asset), "utf8").toString("base64"),
		};
	});
	return JSON.stringify(pkg, null, "\t") + "\n";
}

/** @param {string} file */
function safeExists(file) {
	try {
		statSync(file);
		return true;
	} catch {
		return false;
	}
}

/** @param {string} file */
function readIfExists(file) {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return null;
	}
}

/** Ids whose committed output differs from what the manifest builds now. */
export function stalePackageIds() {
	return listPackageIds().filter(
		(id) => readIfExists(outputPath(id)) !== buildPackageJson(id),
	);
}

function main() {
	const check = process.argv.includes("--check");
	const ids = listPackageIds();
	if (check) {
		const stale = stalePackageIds();
		if (stale.length > 0) {
			console.error(
				`Stale example packages: ${stale.join(", ")}. Run "pnpm run packages:build".`,
			);
			process.exit(1);
		}
		console.log(`${ids.length} example packages are up to date.`);
		return;
	}
	for (const id of ids) {
		writeFileSync(outputPath(id), buildPackageJson(id));
		console.log(`wrote ${path.relative(process.cwd(), outputPath(id))}`);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
