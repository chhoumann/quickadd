import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	captureFailureArtifacts,
	clearVaultRunLockMarker,
	createSandboxApi,
} from "obsidian-e2e";
import type {
	ObsidianClient,
	PluginHandle,
	SandboxApi,
	VaultRunLock,
} from "obsidian-e2e";
import {
	acquireQuickAddVaultRunLock,
	createQuickAddObsidianClient,
	seedVaultFile,
} from "./e2eVault";

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "qa-pkg-capture-inbox-gps";
const CHOICE_NAME = "Capture to Inbox with GPS";
const PACKAGE_VAULT_PATH = "packages/capture-inbox-gps.quickadd.json";
const WAIT_OPTS = { timeoutMs: 15_000, intervalMs: 200 };
const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const packageJson = readFileSync(
	path.join(repoRoot, "docs/public/packages/capture-inbox-gps.quickadd.json"),
	"utf8",
);

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;
let inboxPath: string;

type QuickAddData = {
	choices: Array<{
		id?: string;
		macro?: {
			commands?: Array<{ settings?: Record<string, unknown> }>;
		};
	}>;
	migrations: Record<string, boolean>;
};

type PackagePreviewResponse = {
	ok: boolean;
	error?: string;
	preview?: {
		summary?: {
			scriptCount?: number;
			registersCommandCount?: number;
		};
		criticalScriptPaths?: string[];
	};
};

async function runTeardownStep(
	label: string,
	step: () => Promise<unknown> | unknown,
	errors: unknown[],
) {
	try {
		await step();
	} catch (error) {
		errors.push(error);
		console.warn(`capture-inbox-gps teardown failed during ${label}`, error);
	}
}

async function mockGeolocation(
	result: { latitude: number; longitude: number } | "error" | "missing",
) {
	await obsidian.dev.eval(`(() => {
		const result = ${JSON.stringify(result)};
		if (result === "missing") {
			Object.defineProperty(navigator, "geolocation", {
				configurable: true,
				value: undefined,
			});
			return true;
		}
		Object.defineProperty(navigator, "geolocation", {
			configurable: true,
			value: {
				getCurrentPosition(success, error) {
					if (result === "error") {
						error({ code: 2, message: "unavailable" });
						return;
					}
					success({
						coords: {
							latitude: result.latitude,
							longitude: result.longitude,
							accuracy: 8,
							altitude: null,
							altitudeAccuracy: null,
							heading: null,
							speed: null,
						},
						timestamp: Date.now(),
					});
				},
			},
		});
		return true;
	})()`);
}

async function runCapture(vars: Record<string, string>) {
	return obsidian.execJson<{ ok: boolean; error?: string }>("quickadd:run", {
		choice: CHOICE_NAME,
		...Object.fromEntries(
			Object.entries(vars).map(([key, value]) => [`value-${key}`, value]),
		),
	});
}

describe("Capture to Inbox with GPS package", () => {
	beforeAll(async () => {
		obsidian = createQuickAddObsidianClient();
		lock = await acquireQuickAddVaultRunLock(obsidian);
		await lock.publishMarker(obsidian);
		qa = obsidian.plugin(PLUGIN_ID);
		sandbox = await createSandboxApi({
			obsidian,
			sandboxRoot: "__obsidian_e2e__",
			testName: "capture-inbox-gps-package",
		});
		inboxPath = sandbox.path("gps-inbox.md");

		await seedVaultFile(obsidian, sandbox, PACKAGE_VAULT_PATH, packageJson);

		const imported = await obsidian.dev.evalJsonAsync<{
			ok: boolean;
			scriptPath?: string;
			error?: string;
		}>(`(async () => {
			try {
				const raw = await app.vault.adapter.read(${JSON.stringify(PACKAGE_VAULT_PATH)});
				const pkg = JSON.parse(raw);
				const decode = (b64) => new TextDecoder().decode(
					Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
				);
				for (const asset of pkg.assets) {
					const dest = asset.originalPath;
					const folder = dest.split("/").slice(0, -1).join("/");
					if (folder && !app.vault.getAbstractFileByPath(folder)) {
						await app.vault.createFolder(folder);
					}
					const existing = app.vault.getAbstractFileByPath(dest);
					const content = decode(asset.content);
					if (existing) await app.vault.modify(existing, content);
					else await app.vault.create(dest, content);
				}
				return { ok: true, scriptPath: pkg.assets[0].originalPath };
			} catch (error) {
				return { ok: false, error: String(error && error.message ? error.message : error) };
			}
		})()`);

		expect(imported).toMatchObject({
			ok: true,
			scriptPath: "scripts/captureInboxGps.js",
		});

		const parsed = JSON.parse(packageJson) as {
			choices: Array<{ choice: QuickAddData["choices"][number] }>;
		};

		await qa.data<QuickAddData>().patch((data) => {
			data.choices = data.choices.filter((choice) => choice.id !== CHOICE_ID);
			const choice = structuredClone(parsed.choices[0]?.choice);
			const command = choice?.macro?.commands?.[0];
			if (command) {
				command.settings = {
					"Inbox path": inboxPath,
					"Create Inbox if missing": true,
				};
			}
			if (choice) data.choices.push(choice);
		});

		await qa.reload({ waitUntilReady: true });
	}, 30_000);

	beforeEach((ctx) => {
		ctx.onTestFailed(async () => {
			await captureFailureArtifacts(
				{ id: ctx.task.id, name: ctx.task.name },
				obsidian,
				{ plugin: qa, captureOnFailure: true },
			);
		});
	});

	afterAll(async () => {
		const errors: unknown[] = [];
		await runTeardownStep("restoreData", () => qa?.restoreData?.(), errors);
		await runTeardownStep("reload", () => qa?.reload?.(), errors);
		await runTeardownStep("sandbox cleanup", () => sandbox?.cleanup?.(), errors);
		await runTeardownStep(
			"clear vault run lock marker",
			() => (obsidian ? clearVaultRunLockMarker(obsidian) : undefined),
			errors,
		);
		await runTeardownStep("release vault lock", () => lock?.release(), errors);
		if (errors.length > 0) {
			throw errors[0];
		}
	}, 15_000);

	it("previews the packaged script as executable", async () => {
		const preview = await obsidian.execJson<PackagePreviewResponse>(
			"quickadd:package-preview",
			{ path: PACKAGE_VAULT_PATH, decode: "true" },
		);

		expect(preview.ok).toBe(true);
		expect(preview.preview?.summary?.scriptCount).toBe(1);
		expect(preview.preview?.summary?.registersCommandCount).toBe(1);
		expect(preview.preview?.criticalScriptPaths).toEqual([
			"scripts/captureInboxGps.js",
		]);
	});

	it("appends a GPS-stamped line from the mocked device location", async () => {
		await mockGeolocation({ latitude: 55.676098, longitude: 12.568337 });
		const outcome = await runCapture({ value: "Trail marker" });
		expect(outcome.ok).toBe(true);

		const content = await sandbox.waitForContent(
			inboxPath,
			(text) => text.includes("Trail marker") && text.includes("55.676098"),
			WAIT_OPTS,
		);
		expect(content).toMatch(
			/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} Trail marker \(55\.676098, 12\.568337\)\n$/,
		);
	});

	it("still captures when GPS is unavailable", async () => {
		await mockGeolocation("error");
		const outcome = await runCapture({ value: "No fix today" });
		expect(outcome.ok).toBe(true);

		const content = await sandbox.waitForContent(
			inboxPath,
			(text) => text.includes("No fix today"),
			WAIT_OPTS,
		);
		expect(content).toMatch(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} No fix today\n$/);
		expect(content).not.toContain("(");
	});
});
