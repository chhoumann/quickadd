import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
	buildPackageJson,
	listPackageIds,
	manifestPath,
	orphanOutputIds,
	outputIsStale,
	outputPath,
	readManifest,
	stalePackageIds,
	withLfLineEndings,
} from "../docs/packages/build.mjs";
import { buildPackage } from "../src/services/packageExportService";
import {
	applyPackageImport,
	parseQuickAddPackage,
} from "../src/services/packageImportService";
import { buildPackagePreview } from "../src/services/packagePreview";
import { CaptureChoice } from "../src/types/choices/CaptureChoice";
import type IChoice from "../src/types/choices/IChoice";
import type IMacroChoice from "../src/types/choices/IMacroChoice";
import { MacroChoice } from "../src/types/choices/MacroChoice";
import { MultiChoice } from "../src/types/choices/MultiChoice";
import { TemplateChoice } from "../src/types/choices/TemplateChoice";
import { CommandType } from "../src/types/macros/CommandType";
import type { QuickAddPackage } from "../src/types/packages/QuickAddPackage";
import { decodeFromBase64 } from "../src/utils/base64";
import { flattenChoices } from "../src/utils/choiceUtils";
import { macroCommandsValueOf } from "../src/utils/macroUtils";
import { detectUserScriptSecretOptions } from "../src/utils/userScriptSecretDetection";

/**
 * The example packages the docs ship (docs/packages/<id>/package.json ->
 * docs/public/packages/<id>.quickadd.json). These checks fail when a package
 * goes stale against its sources, against the plugin's package format, or
 * against the docs page that offers it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(repoRoot, "docs/src/content/docs");
const publicScriptsDir = path.join(repoRoot, "docs/public/scripts");
const pluginVersion = (
	JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8")) as {
		version: string;
	}
).version;
// A package may need import behaviour that is merged but not yet released.
// Releases are cut from Conventional Commits, so the next release is at most
// one minor above manifest.json; anything beyond that is a typo.
const nextMinorVersion = (() => {
	const [major, minor] = pluginVersion.split(".").map(Number);
	return `${major}.${minor + 1}.0`;
})();

const ids = listPackageIds();

/** Optional choice keys the constructors leave unset. */
const OPTIONAL_CHOICE_KEYS: Record<string, readonly string[]> = {
	"*": ["dateOrigin", "pickDayCommand", "onePageInput", "icon"],
	Template: ["existingNoteAction"],
	Capture: ["propertyCapture", "useSelectionAsCaptureValue"],
	Multi: ["placeholder"],
	Macro: [],
};

const COMMAND_KEYS: Partial<Record<CommandType, readonly string[]>> = {
	[CommandType.UserScript]: ["path", "settings"],
	[CommandType.Obsidian]: ["commandId"],
	[CommandType.Wait]: ["time"],
	[CommandType.NestedChoice]: ["choice"],
	[CommandType.Choice]: ["choiceId"],
	[CommandType.OpenFile]: ["filePath", "openInNewTab", "fileOpening"],
};

function defaultChoiceFor(choice: IChoice): Record<string, unknown> {
	switch (choice.type) {
		case "Template":
			return JSON.parse(JSON.stringify(new TemplateChoice(choice.name)));
		case "Capture":
			return JSON.parse(JSON.stringify(new CaptureChoice(choice.name)));
		case "Macro":
			return JSON.parse(JSON.stringify(new MacroChoice(choice.name)));
		case "Multi":
			return JSON.parse(JSON.stringify(new MultiChoice(choice.name)));
		default:
			throw new Error(`Unknown choice type ${String(choice.type)}`);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every key the plugin would store must be present, and nothing the plugin
 * would not store may be. Nested objects the constructor initialises (folder,
 * fileOpening, insertAfter, ...) are checked the same way, so a typo like
 * `templatePath` -> `template_path` or a renamed nested setting fails here
 * instead of silently importing as an ignored key.
 */
function expectShapeMatches(
	actual: Record<string, unknown>,
	defaults: Record<string, unknown>,
	optional: readonly string[],
	where: string,
): void {
	const actualKeys = Object.keys(actual);
	const defaultKeys = Object.keys(defaults);
	const missing = defaultKeys.filter((key) => !(key in actual));
	const unknown = actualKeys.filter(
		(key) => !(key in defaults) && !optional.includes(key),
	);
	expect(missing, `${where}: missing keys`).toEqual([]);
	expect(unknown, `${where}: unknown keys`).toEqual([]);

	for (const key of defaultKeys) {
		const defaultValue = defaults[key];
		const actualValue = actual[key];
		// Macro bodies and Multi children are validated separately below.
		if (key === "macro" || key === "choices" || key === "fileExistsBehavior") continue;
		if (isPlainObject(defaultValue)) {
			expect(isPlainObject(actualValue), `${where}.${key}: expected an object`).toBe(true);
			expectShapeMatches(
				actualValue as Record<string, unknown>,
				defaultValue,
				[],
				`${where}.${key}`,
			);
		}
	}
}

function expectMacroCommandsWellFormed(choice: IMacroChoice, where: string): void {
	const commands = macroCommandsValueOf(choice.macro) as Array<Record<string, unknown>>;
	expect(Array.isArray(commands), `${where}: macro.commands`).toBe(true);
	for (const command of commands) {
		const label = `${where} › ${String(command.name)}`;
		expect(typeof command.id, `${label}: id`).toBe("string");
		expect(typeof command.name, `${label}: name`).toBe("string");
		expect(Object.values(CommandType), `${label}: type`).toContain(command.type);
		const required = COMMAND_KEYS[command.type as CommandType] ?? [];
		for (const key of required) {
			expect(command, `${label}: ${key}`).toHaveProperty(key);
		}
	}
}

function fakeVault(initialFiles: Record<string, string> = {}) {
	const files = new Map(Object.entries(initialFiles));
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: vi.fn(async (filePath: string) => files.has(filePath)),
				read: vi.fn(async (filePath: string) => {
					const content = files.get(filePath);
					if (content === undefined) throw new Error(`Missing file: ${filePath}`);
					return content;
				}),
				write: vi.fn(async (filePath: string, content: string) => {
					files.set(filePath, content);
				}),
			},
			createFolder: vi.fn(async () => {}),
		},
	} as unknown as App;
	return { app, files };
}

function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function sortedById<T extends { choice: { id: string } }>(entries: T[]): T[] {
	return [...entries].sort((x, y) => x.choice.id.localeCompare(y.choice.id));
}

function sortedByPath<T extends { originalPath: string }>(entries: T[]): T[] {
	return [...entries].sort((x, y) => x.originalPath.localeCompare(y.originalPath));
}

function frontmatterOf(file: string): string {
	return withLfLineEndings(readFileSync(file, "utf8")).split("\n---\n", 2)[0] ?? "";
}

describe("example packages", () => {
	it("has at least one package", () => {
		expect(ids.length).toBeGreaterThan(0);
	});

	it("committed docs/public/packages/*.quickadd.json match their manifests (run `pnpm run packages:build`)", () => {
		expect(stalePackageIds()).toEqual([]);
		expect(orphanOutputIds(), "built packages whose manifest was removed").toEqual([]);
	});

	it("is not stale just because Git checked the output out with CRLF (autocrlf on Windows)", () => {
		const built = buildPackageJson(ids[0]);
		expect(built).not.toContain("\r");
		expect(outputIsStale(built.replace(/\n/g, "\r\n"), built)).toBe(false);
		// Real drift still counts: an extra blank line at the end, or no file.
		expect(outputIsStale(`${built}\n`, built)).toBe(true);
		expect(outputIsStale(null, built)).toBe(true);
	});

	it("every page's `package:` names a manifest, and every manifest is offered by exactly one page", () => {
		const pages = globSync("**/*.md", { cwd: docsRoot });
		const referenced = new Map<string, string[]>();
		for (const page of pages) {
			const match = /^package:\s*["']?([^"'\s]+)["']?\s*$/m.exec(
				frontmatterOf(path.join(docsRoot, page)),
			);
			if (!match) continue;
			referenced.set(match[1], [...(referenced.get(match[1]) ?? []), page]);
		}
		const dangling = [...referenced.keys()].filter((id) => !ids.includes(id));
		expect(dangling, "pages referencing a package that has no manifest").toEqual([]);
		const unreferenced = ids.filter((id) => !referenced.has(id));
		expect(unreferenced, "packages no page offers").toEqual([]);
		const shared = [...referenced].filter(([, pages]) => pages.length > 1);
		expect(shared, "a package offered by more than one page").toEqual([]);
	});

	describe.each(ids)("%s", (id) => {
		const manifest = readManifest(id);
		const output = readFileSync(outputPath(id), "utf8");
		const pkg: QuickAddPackage = parseQuickAddPackage(buildPackageJson(id));
		const choices = pkg.choices.map((entry) => entry.choice);
		const scriptsByPath = new Map(
			pkg.assets
				.filter((asset) => asset.kind === "user-script")
				.map((asset) => [asset.originalPath, decodeFromBase64(asset.content)]),
		);

		it("is a valid package that this plugin version can import", () => {
			expect(() => parseQuickAddPackage(output)).not.toThrow();
			expect(
				compareSemver(pkg.quickAddVersion, nextMinorVersion),
				`quickAddVersion ${pkg.quickAddVersion} is beyond the next release (${nextMinorVersion}); manifest.json is ${pluginVersion}`,
			).toBeLessThanOrEqual(0);
			expect(pkg.rootChoiceIds.length).toBeGreaterThan(0);
			for (const rootId of pkg.rootChoiceIds) {
				expect(choices.map((choice) => choice.id)).toContain(rootId);
			}
		});

		it("uses stable, namespaced ids so a re-import overwrites instead of duplicating", () => {
			for (const choice of flattenChoices(choices)) {
				expect(choice.id).toMatch(new RegExp(`^qa-pkg-${id}(-[a-z0-9-]+)?$`));
			}
		});

		it("stores every choice in the shape the plugin stores it", () => {
			for (const choice of flattenChoices(choices)) {
				const where = `${choice.type} "${choice.name}"`;
				expectShapeMatches(
					choice as unknown as Record<string, unknown>,
					defaultChoiceFor(choice),
					[...OPTIONAL_CHOICE_KEYS["*"], ...(OPTIONAL_CHOICE_KEYS[choice.type] ?? [])],
					where,
				);
				if (choice.type === "Macro") {
					expectMacroCommandsWellFormed(choice as IMacroChoice, where);
				}
			}
		});

		it("bundles every file it references and references every file it bundles", () => {
			const preview = buildPackagePreview([], pkg, new Set());
			expect(preview.missingReferences).toEqual([]);
			expect(preview.orphanAssets).toEqual([]);
			// The install card tells readers to open "View contents" on each script
			// before acknowledging; that step must match what the import flags.
			const scriptPaths = manifest.assets
				.map((asset) => asset.originalPath)
				.filter((assetPath) => /\.js$/i.test(assetPath));
			expect(preview.criticalScriptPaths).toEqual(expect.arrayContaining(scriptPaths));
			expect(preview.summary.scriptCount).toBe(scriptPaths.length);
		});

		it("bundles scripts from docs/public/scripts so the page's download link and the package stay one file", () => {
			for (const asset of manifest.assets) {
				if (!/\.js$/i.test(asset.originalPath)) continue;
				const source = path.resolve(path.dirname(manifestPath(id)), asset.source);
				expect(
					source.startsWith(publicScriptsDir + path.sep),
					`${asset.originalPath} is bundled from ${asset.source}`,
				).toBe(true);
			}
		});

		it("ships no secret values: secret settings are left for the reader to fill in", () => {
			const secretNamesByPath = new Map(
				[...scriptsByPath].map(([scriptPath, source]) => [
					scriptPath,
					detectUserScriptSecretOptions(source, scriptPath).names,
				]),
			);
			for (const choice of flattenChoices(choices)) {
				if (choice.type !== "Macro") continue;
				for (const command of macroCommandsValueOf((choice as IMacroChoice).macro) as Array<
					Record<string, unknown>
				>) {
					if (command.type !== CommandType.UserScript) continue;
					const settings = (command.settings ?? {}) as Record<string, unknown>;
					const secretNames = secretNamesByPath.get(String(command.path)) ?? new Set();
					for (const [name, value] of Object.entries(settings)) {
						expect(secretNames.has(name), `${choice.name}: secret "${name}" has a value`).toBe(false);
						expect(isPlainObject(value) && "secretRef" in value, `${choice.name}: ${name} carries a secret ref`).toBe(false);
					}
				}
			}
			expect(output).not.toContain("__quickaddSecret");
		});

		it("imports cleanly and re-exports to the same package", async () => {
			const { app, files } = fakeVault();
			const result = await applyPackageImport({
				app,
				existingChoices: [],
				pkg,
				choiceDecisions: pkg.choices.map((entry) => ({
					choiceId: entry.choice.id,
					mode: "import" as const,
				})),
				assetDecisions: pkg.assets.map((asset) => ({
					originalPath: asset.originalPath,
					destinationPath: asset.originalPath,
					mode: "write" as const,
				})),
			});

			expect(result.skippedChoiceIds).toEqual([]);
			expect(result.skippedAssets).toEqual([]);
			expect([...result.addedChoiceIds].sort()).toEqual(
				pkg.choices.map((entry) => entry.choice.id).sort(),
			);
			expect([...result.writtenAssets].sort()).toEqual(
				pkg.assets.map((asset) => asset.originalPath).sort(),
			);
			for (const asset of pkg.assets) {
				expect(files.get(asset.originalPath)).toBe(decodeFromBase64(asset.content));
			}

			// What the plugin's own exporter would produce from the imported vault
			// must be this package: same choices, same assets, same kinds.
			const exported = await buildPackage(app, {
				choices: result.updatedChoices,
				rootChoiceIds: pkg.rootChoiceIds,
				quickAddVersion: pkg.quickAddVersion,
				createdAt: pkg.createdAt,
			});
			expect(exported.missingChoiceIds).toEqual([]);
			expect(exported.missingAssets).toEqual([]);
			expect(exported.pkg.rootChoiceIds).toEqual(pkg.rootChoiceIds);
			expect(sortedById(exported.pkg.choices)).toEqual(sortedById(pkg.choices));
			expect(sortedByPath(exported.pkg.assets)).toEqual(sortedByPath(pkg.assets));
		});

		it("has an install guide the docs can render", () => {
			const install = manifest.install ?? {};
			for (const key of ["requires", "afterImport"] as const) {
				const value = install[key];
				if (value === undefined) continue;
				expect(Array.isArray(value), `install.${key}`).toBe(true);
				for (const line of value) {
					expect(typeof line).toBe("string");
					// PackageCard.astro's inline() only renders site-relative and
					// https links, and drops the target straight into href="…";
					// anything else (a bare domain, `//host`, a quote) would ship as
					// literal brackets or break the attribute.
					for (const [, target] of line.matchAll(/\]\(([^)]*)\)/g)) {
						expect(
							/^(\/(?!\/)|https:\/\/)[^\s"]+$/.test(target),
							`install.${key} link "${target}" must be site-relative or https://, without quotes`,
						).toBe(true);
					}
				}
			}
			const unknownKeys = Object.keys(install).filter(
				(key) => key !== "requires" && key !== "afterImport",
			);
			expect(unknownKeys, "unknown install keys").toEqual([]);
		});
	});
});
