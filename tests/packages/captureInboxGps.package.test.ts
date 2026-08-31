import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { decodeFromBase64 } from "../../src/utils/base64";
import { buildPackagePreview } from "../../src/services/packagePreview";
import {
	applyPackageImport,
	parseQuickAddPackage,
} from "../../src/services/packageImportService";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packagePath = path.join(
	root,
	"docs/public/packages/capture-inbox-gps.quickadd.json",
);
const scriptPath = path.join(root, "docs/public/scripts/captureInboxGps.js");

function createMockApp(initialFiles: Record<string, string> = {}): {
	app: App;
	files: Map<string, string>;
} {
	const files = new Map(Object.entries(initialFiles));
	const app = {
		vault: {
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
			configDir: ".obsidian",
			createFolder: vi.fn(async (folderPath: string) => {
				files.set(folderPath, "");
			}),
		},
	} as unknown as App;

	return { app, files };
}

describe("Capture to Inbox with GPS package", () => {
	const raw = readFileSync(packagePath, "utf8");
	const script = readFileSync(scriptPath, "utf8");
	const pkg = parseQuickAddPackage(raw);

	it("bundles the published script and a command-palette Macro", () => {
		expect(pkg.quickAddVersion).toBe("2.23.0");
		expect(pkg.rootChoiceIds).toEqual(["qa-pkg-capture-inbox-gps"]);
		expect(pkg.assets).toHaveLength(1);
		expect(pkg.assets[0]?.originalPath).toBe("scripts/captureInboxGps.js");
		expect(decodeFromBase64(pkg.assets[0]?.content ?? "")).toBe(script);

		const choice = pkg.choices[0]?.choice as {
			name: string;
			command: boolean;
			runOnStartup: boolean;
			macro: { commands: Array<{ type: string; path: string }> };
		};
		expect(choice.name).toBe("Capture to Inbox with GPS");
		expect(choice.command).toBe(true);
		expect(choice.runOnStartup).toBe(false);
		expect(choice.macro.commands[0]?.type).toBe("UserScript");
		expect(choice.macro.commands[0]?.path).toBe("scripts/captureInboxGps.js");
	});

	it("previews as an executable script that registers a command", () => {
		const preview = buildPackagePreview([], pkg, new Set());

		expect(preview.summary.scriptCount).toBe(1);
		expect(preview.summary.registersCommandCount).toBe(1);
		expect(preview.criticalScriptPaths).toEqual(["scripts/captureInboxGps.js"]);
		expect(preview.capabilityRows.some((row) => row.flag === "user-script")).toBe(
			true,
		);
		expect(
			preview.capabilityRows.some((row) => row.flag === "registers-command"),
		).toBe(true);
	});

	it("imports the script file and the Macro choice", async () => {
		const { app, files } = createMockApp();
		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: "qa-pkg-capture-inbox-gps", mode: "import" },
			],
			assetDecisions: [
				{
					originalPath: "scripts/captureInboxGps.js",
					destinationPath: "scripts/captureInboxGps.js",
					mode: "write",
				},
			],
		});

		expect(result.addedChoiceIds).toEqual(["qa-pkg-capture-inbox-gps"]);
		expect(result.writtenAssets).toEqual(["scripts/captureInboxGps.js"]);
		expect(files.get("scripts/captureInboxGps.js")).toBe(script);
		expect(result.updatedChoices[0]?.name).toBe("Capture to Inbox with GPS");
	});
});
