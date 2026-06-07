import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import type { App } from "obsidian";
import ImportPackageModal from "./ImportPackageModal.svelte";
import { settingsStore } from "../../settingsStore";
import { encodeToBase64 } from "../../utils/base64";
import type * as PackageImportService from "../../services/packageImportService";

// Lets a test hold `analysePackagePreview` mid-flight to observe the re-analysis
// window. Disabled by default so other tests keep the real (immediate) preview.
const previewGate = vi.hoisted(() => ({
	enabled: false,
	releases: [] as Array<() => void>,
}));

vi.mock("../../services/packageImportService", async (importOriginal) => {
	const actual = await importOriginal<typeof PackageImportService>();
	return {
		...actual,
		analysePackagePreview: vi.fn(
			async (
				...args: Parameters<typeof actual.analysePackagePreview>
			) => {
				if (previewGate.enabled) {
					await new Promise<void>((resolve) =>
						previewGate.releases.push(resolve),
					);
				}
				return actual.analysePackagePreview(...args);
			},
		),
	};
});

// A critical package: a run-on-startup macro that runs one bundled user script.
const PACKAGE = JSON.stringify({
	schemaVersion: 1,
	quickAddVersion: "1.18.0",
	createdAt: "2026-06-01T00:00:00.000Z",
	rootChoiceIds: ["m1"],
	choices: [
		{
			choice: {
				id: "m1",
				name: "Daily Sync",
				type: "Macro",
				command: false,
				runOnStartup: true,
				macro: {
					id: "macro-m1",
					name: "Daily Sync",
					commands: [
						{
							id: "c1",
							name: "fetch",
							type: "UserScript",
							path: "scripts/fetch.js",
							settings: {},
						},
					],
				},
			},
			pathHint: ["Daily Sync"],
			parentChoiceId: null,
		},
	],
	assets: [
		{
			kind: "user-script",
			originalPath: "scripts/fetch.js",
			contentEncoding: "base64",
			content: encodeToBase64("console.log('hi')"),
		},
	],
});

function fakeApp(): App {
	return {
		vault: {
			adapter: {
				exists: vi.fn(async () => false),
				read: vi.fn(async () => ""),
			},
			getAbstractFileByPath: vi.fn(() => null),
		},
	} as unknown as App;
}

afterEach(() => {
	settingsStore.setState((s) => ({ ...s, choices: [] }));
	previewGate.enabled = false;
	previewGate.releases = [];
});

describe("ImportPackageModal gate flow", () => {
	it("keeps Import locked until the script is reviewed and acknowledged", async () => {
		settingsStore.setState((s) => ({ ...s, choices: [] }));

		const { container, getByText, getByRole } = render(ImportPackageModal, {
			props: { app: fakeApp(), close: () => {} },
		});

		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		await fireEvent.input(textarea, { target: { value: PACKAGE } });

		// Banner appears once the (async) analysis resolves.
		await waitFor(() =>
			expect(getByText("What this package can do")).toBeTruthy(),
		);

		const importButton = getByText("Import package") as HTMLButtonElement;
		const checkbox = getByRole("checkbox") as HTMLInputElement;

		// Gate is locked: checkbox disabled (script unreviewed), Import disabled.
		expect(checkbox.disabled).toBe(true);
		expect(importButton.disabled).toBe(true);

		// Reviewing the one bundled critical script enables the checkbox.
		await fireEvent.click(getByText("View contents"));
		await waitFor(() => expect(checkbox.disabled).toBe(false));
		expect(importButton.disabled).toBe(true);

		// Acknowledging then enables Import.
		await fireEvent.click(checkbox);
		await waitFor(() => expect(importButton.disabled).toBe(false));
	});

	it("blocks Import while a re-paste is being analysed", async () => {
		settingsStore.setState((s) => ({ ...s, choices: [] }));
		previewGate.enabled = true;

		const { container, getByText, getByRole } = render(ImportPackageModal, {
			props: { app: fakeApp(), close: () => {} },
		});
		const textarea = container.querySelector(
			"textarea",
		) as HTMLTextAreaElement;

		// First paste: release its preview so the package fully loads, then
		// satisfy the gate so Import is enabled.
		await fireEvent.input(textarea, { target: { value: PACKAGE } });
		await waitFor(() => expect(previewGate.releases.length).toBe(1));
		previewGate.releases[0]();
		await waitFor(() =>
			expect(getByText("What this package can do")).toBeTruthy(),
		);

		const importButton = getByText("Import package") as HTMLButtonElement;
		const checkbox = getByRole("checkbox") as HTMLInputElement;
		await fireEvent.click(getByText("View contents"));
		await waitFor(() => expect(checkbox.disabled).toBe(false));
		await fireEvent.click(checkbox);
		await waitFor(() => expect(importButton.disabled).toBe(false));

		// Re-paste: the previous package stays acknowledged until the new
		// analysis resolves, but Import must lock during that window so the
		// stale package can't be written.
		await fireEvent.input(textarea, { target: { value: PACKAGE } });
		await waitFor(() => expect(previewGate.releases.length).toBe(2));
		expect(importButton.disabled).toBe(true);

		// Let the re-analysis settle (resets the gate, so it stays disabled).
		previewGate.releases[1]();
		await waitFor(() => expect(checkbox.disabled).toBe(true));
	});
});
