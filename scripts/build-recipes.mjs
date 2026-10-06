// @ts-check
/**
 * Builds the recipe catalogue the plugin bundles for its Recipes gallery from
 * the docs' example pages and their packages:
 *
 *   docs/src/content/docs/docs/Examples/*.md (with `package: <id>`)
 *   + docs/packages/<id>/package.json (the manifest's install block)
 *   + docs/public/packages/<id>.quickadd.json (the built package)
 *   ->  src/gui/recipes/catalog.generated.json
 *
 * Run it from the repo root with `pnpm run build:recipes`; `pnpm run
 * packages:build` runs it too. A unit test fails when
 * the committed catalogue is stale (tests/buildRecipes.test.ts).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = path.join(repoRoot, "docs/src/content/docs/docs/Examples");
const PACKAGES_DIR = path.join(repoRoot, "docs/packages");
const BUILT_DIR = path.join(repoRoot, "docs/public/packages");
export const CATALOG_PATH = path.join(repoRoot, "src/gui/recipes/catalog.generated.json");

/**
 * @typedef {object} Recipe
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} slug
 * @property {string[]} requires
 * @property {string[]} afterImport
 * @property {{ name: string, type: string }[]} choices
 * @property {number} scripts
 * @property {number} templates
 * @property {any} package
 */

/**
 * The flat `key: value` frontmatter the docs pages use; quoted values lose
 * their quotes.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseFrontmatter(text) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	/** @type {Record<string, string>} */
	const fields = {};
	if (!match) return fields;
	for (const line of match[1].split(/\r?\n/)) {
		const field = /^([A-Za-z]+):\s*(.*)$/.exec(line);
		if (!field) continue;
		const value = field[2].trim();
		fields[field[1]] = /^".*"$/.test(value) ? JSON.parse(value) : value;
	}
	return fields;
}

/**
 * A page title without the choice-type prefix the docs sort by.
 * @param {string} title
 */
export function cleanTitle(title) {
	return title.replace(/^(?:(?:Capture|Macro|Template):|Template -)\s*/, "");
}

/** Words a title keeps capitalized: names of products, plugins and things in Obsidian. */
const PROPER_NOUNS = new Set([
	"Obsidian", "QuickAdd", "Todoist", "Readwise", "Toggl", "GPS", "MOC", "Dataview", "Kanban", "Canvas", "Base",
]);

/**
 * A title in sentence case: its first word as written, the rest lowercase
 * unless they are proper nouns.
 * @param {string} title
 */
export function sentenceCase(title) {
	return title
		.split(" ")
		.map((word, index) => (index === 0 || PROPER_NOUNS.has(word) ? word : word.toLowerCase()))
		.join(" ");
}

/**
 * One catalogue entry from a page's frontmatter, its manifest, and its built package.
 * @param {string} id
 * @param {Record<string, string>} page
 * @param {any} manifest
 * @param {any} pkg
 * @returns {Recipe}
 */
export function recipeFrom(id, page, manifest, pkg) {
	/** @param {string[]} kinds */
	const count = (kinds) => pkg.assets.filter((/** @type {any} */ asset) => kinds.includes(asset.kind)).length;
	return {
		id,
		title: sentenceCase(cleanTitle(page.title)),
		description: page.description,
		slug: page.slug,
		requires: manifest.install?.requires ?? [],
		afterImport: manifest.install?.afterImport ?? [],
		choices: pkg.choices
			.map((/** @type {any} */ entry) => entry.choice)
			.filter((/** @type {any} */ choice) => choice.type !== "Multi")
			.map((/** @type {any} */ choice) => ({ name: choice.name, type: choice.type })),
		scripts: count(["user-script", "conditional-script"]),
		templates: count(["template", "capture-template"]),
		package: pkg,
	};
}

/** @param {string} file */
function readJson(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}

/** The catalogue as the JSON text that gets committed. */
export function buildCatalogJson() {
	const recipes = readdirSync(EXAMPLES_DIR)
		.filter((name) => name.endsWith(".md"))
		.map((name) => parseFrontmatter(readFileSync(path.join(EXAMPLES_DIR, name), "utf8")))
		.filter((page) => page.package)
		.map((page) => {
			const id = page.package;
			return recipeFrom(
				id,
				page,
				readJson(path.join(PACKAGES_DIR, id, "package.json")),
				readJson(path.join(BUILT_DIR, `${id}.quickadd.json`)),
			);
		})
		.sort((a, b) => a.title.localeCompare(b.title, "en"));
	return JSON.stringify(recipes, null, "\t") + "\n";
}

export function writeRecipeCatalog() {
	writeFileSync(CATALOG_PATH, buildCatalogJson());
	console.log(`wrote ${path.relative(process.cwd(), CATALOG_PATH)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	writeRecipeCatalog();
}
