import { packageAsset } from "../../../tests/helpers/packages/fixtures";
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
		applyPackageImport: vi.fn(async () => ({
			updatedChoices: [],
			addedChoiceIds: ["m1"],
			overwrittenChoiceIds: [],
			skippedChoiceIds: [],
			writtenAssets: ["scripts/fetch.js"],
			skippedAssets: [],
		})),
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
		packageAsset("user-script", "scripts/fetch.js", encodeToBase64("console.log('hi')")),
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

describe("ImportPackageModal inline code in a choice setting", () => {
	const format = "- ```js quickadd return app.vault.getName()``` {{VALUE}}";
	const INLINE_PACKAGE = JSON.stringify({
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-29T00:00:00.000Z",
		rootChoiceIds: ["c1"],
		choices: [
			{
				choice: {
					id: "c1",
					name: "Log vault name",
					type: "Capture",
					command: false,
					captureTo: "Inbox.md",
					format: { enabled: true, format },
				},
				pathHint: ["Log vault name"],
				parentChoiceId: null,
			},
		],
		assets: [],
	});

	it("shows the code and counts viewing it toward the review", async () => {
		const { container, getByText, getByRole, queryByText } = render(ImportPackageModal, {
			props: { app: fakeApp(), close: () => {} },
		});
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		await fireEvent.input(textarea, { target: { value: INLINE_PACKAGE } });
		await waitFor(() =>
			expect(getByText("What this package can do")).toBeTruthy(),
		);

		const checkbox = getByRole("checkbox") as HTMLInputElement;
		const importButton = getByText("Import package") as HTMLButtonElement;
		const reason = () => container.querySelector("#qa-import-reason")?.textContent?.trim();
		expect(getByText("I have reviewed each script above and trust the source.")).toBeTruthy();
		expect(checkbox.disabled).toBe(true);
		expect(reason()).toBe("View 1 script above to import.");
		expect(importButton.getAttribute("aria-describedby")).toBe("qa-import-reason");

		await fireEvent.click(getByText("View code"));
		const code = getByRole("region", { name: "Log vault name › capture format" });
		expect(code.textContent).toBe(format);
		expect(getByText("capture format")).toBeTruthy();
		await waitFor(() => expect(checkbox.disabled).toBe(false));
		expect(getByText("Reviewed")).toBeTruthy();

		// Closing it again keeps the review.
		await fireEvent.click(getByText("Hide code"));
		expect(queryByText(format)).toBeNull();
		expect(checkbox.disabled).toBe(false);

		await fireEvent.click(checkbox);
		await waitFor(() => expect(importButton.disabled).toBe(false));
		expect(reason()).toBeUndefined();
	});

	it("doesn't call inline code a bundled script next to a missing one", async () => {
		const pkg = JSON.parse(INLINE_PACKAGE);
		pkg.rootChoiceIds.push("m1");
		pkg.choices.push({
			choice: {
				id: "m1",
				name: "Fetch",
				type: "Macro",
				command: false,
				macro: { id: "mm", name: "Fetch", commands: [{ id: "c", name: "fetch", type: "UserScript", path: "scripts/missing.js", settings: {} }] },
			},
			pathHint: ["Fetch"],
			parentChoiceId: null,
		});
		const { container, getByText } = render(ImportPackageModal, {
			props: { app: fakeApp(), close: () => {} },
		});
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		await fireEvent.input(textarea, { target: { value: JSON.stringify(pkg) } });
		await waitFor(() => expect(getByText("Missing files")).toBeTruthy());

		expect(container.querySelector(".qa-import-ack-label")?.textContent?.trim()).toBe(
			"I have reviewed each script shown above and trust the source, including scripts that are not included and cannot be shown.",
		);
	});
});

describe("ImportPackageModal after import (#1880)", () => {
	it("says which script to open, then shows the result with a single Close", async () => {
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		const close = vi.fn();
		const { container, getByText, getByRole, queryByText } = render(ImportPackageModal, {
			props: { app: fakeApp(), close },
		});
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		await fireEvent.input(textarea, { target: { value: PACKAGE } });
		await waitFor(() =>
			expect(getByText("What this package can do")).toBeTruthy(),
		);

		// The reason sits beside the disabled button, not at the end of the review.
		const reason = () =>
			container.querySelector(".modal-button-container #qa-import-reason")?.textContent?.trim();
		expect(reason()).toBe("View 1 script above to import.");

		await fireEvent.click(getByText("View contents"));
		const checkbox = getByRole("checkbox") as HTMLInputElement;
		await waitFor(() => expect(checkbox.disabled).toBe(false));
		expect(reason()).toBe("Confirm the acknowledgement above to import.");
		await fireEvent.click(checkbox);
		await waitFor(() => expect(reason()).toBeUndefined());
		await fireEvent.click(getByText("Import package"));

		const summary = await waitFor(() => getByRole("status"));
		expect(summary.textContent).toContain("Imported: 1 choice added, 1 file written.");
		await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(summary));
		const footer = container.querySelector(".modal-button-container") as HTMLElement;
		expect(Array.from(footer.querySelectorAll("button"), (b) => b.textContent?.trim())).toEqual(["Close"]);
		expect(queryByText("Cancel")).toBeNull();

		await fireEvent.click(getByText("Close"));
		expect(close).toHaveBeenCalledTimes(1);
	});
});

describe("ImportPackageModal choice actions", () => {
	// Import only ever adds, so it is offered for new choices; Overwrite only
	// ever replaces, so it is offered for choices already in the vault.
	it("offers Import only for new choices and Overwrite only for existing ones", async () => {
		const choice = (id: string, name: string) => ({
			choice: { id, name, type: "Capture", command: false, captureTo: "Inbox.md" },
			pathHint: [name],
			parentChoiceId: null,
		});
		const pkg = JSON.stringify({
			schemaVersion: 1,
			quickAddVersion: "2.30.0",
			createdAt: "2026-09-30T00:00:00.000Z",
			rootChoiceIds: ["mine", "fresh"],
			choices: [choice("mine", "Already here"), choice("fresh", "Brand new")],
			assets: [],
		});
		settingsStore.setState((s) => ({
			...s,
			choices: [{ id: "mine", name: "Already here", type: "Capture", command: false } as never],
		}));

		const { container, getByLabelText } = render(ImportPackageModal, {
			props: { app: fakeApp(), close: () => {} },
		});
		await fireEvent.input(container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: pkg } });

		const options = (name: string) =>
			Array.from((getByLabelText(`Action for ${name}`) as HTMLSelectElement).options, (option) => option.value);
		await waitFor(() => expect(options("Already here")).toEqual(["overwrite", "duplicate", "skip"]));
		expect(options("Brand new")).toEqual(["import", "duplicate", "skip"]);
		expect((getByLabelText("Action for Already here") as HTMLSelectElement).value).toBe("overwrite");
	});
});
