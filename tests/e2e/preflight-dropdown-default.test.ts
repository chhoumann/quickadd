import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	acquireVaultRunLock,
	captureFailureArtifacts,
	clearVaultRunLockMarker,
	createObsidianClient,
	createSandboxApi,
} from "obsidian-e2e";
import type {
	ObsidianClient,
	PluginHandle,
	SandboxApi,
	VaultRunLock,
} from "obsidian-e2e";

const VAULT = "dev";
const PLUGIN_ID = "quickadd";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const TEST_PREFIX = "__qa-test-588-";
const VALUE_KEY = "#BF616A,#8CC570,#42A5F5";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
};

type RunOutcome =
	| { ok: false; error: unknown }
	| { ok: true; result: { exitCode: number } };

type ModalSubmitResult = {
	selectValue: string;
	selectedText: string | null;
	optionValues: string[];
};

function captureChoice(id: string, captureTo: string) {
	return {
		id,
		name: id,
		type: "Capture",
		command: false,
		onePageInput: "always",
		captureTo,
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: true,
			createWithTemplate: false,
			template: "",
		},
		format: {
			enabled: true,
			format: `<mark style="background-color: {{VALUE:${VALUE_KEY}|dropdown|text:red,green,blue}}">selected</mark>`,
		},
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: {
			enabled: false,
			direction: "below",
		},
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "source",
			focus: false,
		},
	};
}

function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(choice) => !String(choice.id ?? "").startsWith(TEST_PREFIX),
	);
}

function submitOnePageModalCode() {
	return `
(() => {
	const modal = document.querySelector(".onePageInputModal");
	if (!modal) return null;

	const select = modal.querySelector("select");
	const buttons = Array.from(modal.querySelectorAll("button"));
	const submit = buttons.find(
		(button) => button.textContent?.trim() === "Submit",
	);
	if (!select || !submit) return null;

	const result = {
		selectValue: select.value,
		selectedText: select.selectedOptions?.[0]?.textContent ?? null,
		optionValues: Array.from(select.options).map((option) => option.value),
	};
	submit.click();
	return result;
})()
`;
}

async function submitOnePageModal(): Promise<ModalSubmitResult> {
	return await obsidian.waitFor(async () => {
		const result = await obsidian.dev.evalJson<ModalSubmitResult | null>(
			submitOnePageModalCode(),
		);
		return result?.selectValue ? result : false;
	}, WAIT_OPTS);
}

async function runTeardownStep(
	label: string,
	step: () => Promise<unknown> | unknown,
	errors: unknown[],
) {
	try {
		await step();
	} catch (error) {
		errors.push(error);
		console.warn(`preflight-dropdown teardown failed during ${label}`, error);
	}
}

beforeAll(async () => {
	obsidian = createObsidianClient({ vault: VAULT });
	await obsidian.verify();

	lock = await acquireVaultRunLock({
		vaultName: VAULT,
		vaultPath: await obsidian.vaultPath(),
	});
	await lock.publishMarker(obsidian);

	qa = obsidian.plugin(PLUGIN_ID);
	sandbox = await createSandboxApi({
		obsidian,
		sandboxRoot: "__obsidian_e2e__",
		testName: "preflight-dropdown-default",
	});
}, 30_000);

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

beforeEach((ctx) => {
	ctx.onTestFailed(async () => {
		await captureFailureArtifacts(
			{ id: ctx.task.id, name: ctx.task.name },
			obsidian,
			{ plugin: qa, captureOnFailure: true },
		);
	});
});

describe("issue 588: one-page mapped dropdown defaults", () => {
	beforeAll(async () => {
		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);
			data.choices.push(
				captureChoice(
					`${TEST_PREFIX}capture-dropdown-default`,
					sandbox.path("dropdown-output.md"),
				),
			);
		});

		await qa.reload({ waitUntilReady: true });
	}, 15_000);

	it("captures the first raw mapped dropdown option when submitted untouched", async () => {
		const runPromise: Promise<RunOutcome> = obsidian
			.exec("quickadd:run", {
				choice: `${TEST_PREFIX}capture-dropdown-default`,
				ui: "true",
			})
			.then(
				(result) => ({ ok: true, result }) as const,
				(error: unknown) => ({ ok: false, error }) as const,
			);

		const modal = await submitOnePageModal();
		expect(modal).toMatchObject({
			selectValue: "#BF616A",
			selectedText: "red",
			optionValues: VALUE_KEY.split(","),
		});

		const runResult = await runPromise;
		if (!runResult.ok) throw runResult.error;
		expect(runResult.result.exitCode).toBe(0);

		const content = await sandbox.waitForContent(
			"dropdown-output.md",
			(fileContent) => fileContent.includes("background-color: #BF616A"),
			WAIT_OPTS,
		);

		expect(content).toContain("background-color: #BF616A");
		expect(content).not.toContain("background-color: \">selected");
	});
});
