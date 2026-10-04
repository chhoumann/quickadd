import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	clearVaultRunLockMarker,
	createSandboxApi,
} from "obsidian-e2e";
import { registerFailureArtifacts } from "obsidian-e2e/vitest";
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
import { withStoredChoices } from "./storedChoices";

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "qa-pkg-capture-inbox-gps";
const CHOICE_NAME = "Capture to Inbox with GPS";
const PACKAGE_RELATIVE_PATH = "packages/capture-inbox-gps.quickadd.json";
const INBOX_RELATIVE_PATH = "gps-inbox.md";
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
let packagePath: string;

type QuickAddData = {
	choices: Array<{
		id?: string;
		macro?: {
			commands?: Array<{ settings?: Record<string, unknown> }>;
		};
	}>;
	migrations: Record<string, boolean>;
};

type PackageImportResponse = {
	ok: boolean;
	error?: string;
	added?: string[];
	writtenAssets?: string[];
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
		inboxPath = sandbox.path(INBOX_RELATIVE_PATH);

		packagePath = await seedVaultFile(obsidian, sandbox, PACKAGE_RELATIVE_PATH, packageJson);

		// Snapshot data.json before the import so restoreData() in afterAll rolls
		// the imported choice back out, and drop a stale copy from an aborted run
		// so the import below adds rather than overwrites.
		await qa.updateDataAndReload<QuickAddData>(withStoredChoices((data) => {
			data.choices = data.choices.filter((choice) => choice.id !== CHOICE_ID);
		}));

		// Install the package the way the docs tell readers to, through the
		// plugin's own import (the CLI shares applyPackageImport with the modal).
		// Without `acknowledge` the import must refuse a code-running package.
		const refused = await obsidian.execJson<PackageImportResponse>(
			"quickadd:package-import",
			{ path: packagePath },
		);
		expect(refused.ok).toBe(false);
		expect(refused.error).toMatch(/acknowledge/);

		const imported = await obsidian.execJson<PackageImportResponse>(
			"quickadd:package-import",
			{ path: packagePath, acknowledge: "true" },
		);
		expect(imported).toMatchObject({
			ok: true,
			added: [CHOICE_ID],
			writtenAssets: ["scripts/captureInboxGps.js"],
		});

		// The one thing the install guide leaves to the reader: point the script at
		// an inbox note. Done through data.json here in place of the script's cog.
		await qa.data<QuickAddData>().patch(withStoredChoices((data) => {
			const choice = data.choices.find((entry) => entry.id === CHOICE_ID);
			const command = choice?.macro?.commands?.[0];
			if (!command) throw new Error("imported GPS macro has no script command");
			command.settings = {
				"Inbox path": inboxPath,
				"Create Inbox if missing": true,
			};
		}));

		await qa.reload({ waitUntilReady: true });
	}, 30_000);

	beforeEach(async (ctx) => {
		await seedVaultFile(obsidian, sandbox, INBOX_RELATIVE_PATH, "");
		registerFailureArtifacts(ctx, obsidian, { captureOnFailure: true }, qa);
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
			{ path: packagePath, decode: "true" },
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
			INBOX_RELATIVE_PATH,
			(text) => text.includes("Trail marker") && text.includes("55.676098"),
			WAIT_OPTS,
		);
		expect(content).toMatch(
			/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} Trail marker \(55\.676098, 12\.568337\)\n$/,
		);
	});

	it("starts a new line when the inbox's last line has no line break (#1935)", async () => {
		await seedVaultFile(obsidian, sandbox, INBOX_RELATIVE_PATH, "- Earlier entry");
		await mockGeolocation("error");
		const outcome = await runCapture({ value: "Next entry" });
		expect(outcome.ok).toBe(true);

		const content = await sandbox.waitForContent(
			INBOX_RELATIVE_PATH,
			(text) => text.includes("Next entry"),
			WAIT_OPTS,
		);
		expect(content).toMatch(/^- Earlier entry\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} Next entry\n$/);
	});

	it("still captures when GPS is unavailable", async () => {
		await mockGeolocation("error");
		const outcome = await runCapture({ value: "No fix today" });
		expect(outcome.ok).toBe(true);

		const content = await sandbox.waitForContent(
			INBOX_RELATIVE_PATH,
			(text) => text.includes("No fix today"),
			WAIT_OPTS,
		);
		expect(content).toMatch(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} No fix today\n$/);
		expect(content).not.toContain("(");
	});
});
