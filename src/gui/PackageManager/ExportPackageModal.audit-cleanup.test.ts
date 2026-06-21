import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { Notice } from "obsidian";
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import ExportPackageModal from "./ExportPackageModal.svelte";
import type * as PackageExportService from "../../services/packageExportService";
import { QUICKADD_PACKAGE_SCHEMA_VERSION } from "../../types/packages/QuickAddPackage";
import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";

// Audit cleanup for settings-package-export: the save handler must (a) reflect
// overwrite-vs-new in the success Notice using writePackageToVault's
// {overwritten} return value, and (b) surface a neutral "Save cancelled." no-op
// (not "Save failed: Save cancelled: …") when the user declines the overwrite
// confirmation.

const writePackageToVault = vi.hoisted(() => vi.fn());

function makePkg(): QuickAddPackage {
	return {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "1.0.0",
		createdAt: "2026-01-01T00:00:00.000Z",
		rootChoiceIds: ["root"],
		choices: [
			{
				choice: { id: "root", name: "Root", type: "Template" } as never,
				pathHint: ["Root"],
				parentChoiceId: null,
			},
		],
		assets: [],
	};
}

vi.mock("../../services/packageExportService", async (importOriginal) => {
	const actual = await importOriginal<typeof PackageExportService>();
	return {
		...actual,
		// Deterministic default path so the save input is pre-filled.
		generateDefaultPackagePath: () => "QuickAdd Packages/test.quickadd.json",
		buildPackage: vi.fn(async () => ({
			pkg: makePkg(),
			missingChoiceIds: [],
			missingAssets: [],
		})),
		writePackageToVault,
	};
});

const ROOT_CHOICE: IChoice = {
	id: "root",
	name: "Root",
	type: "Template",
} as unknown as IChoice;

function fakeApp(): App {
	return {
		vault: {
			adapter: {
				exists: vi.fn(async () => true),
				read: vi.fn(async () => ""),
				write: vi.fn(async () => {}),
			},
		},
	} as unknown as App;
}

function fakePlugin(): QuickAdd {
	return { manifest: { version: "1.0.0" } } as unknown as QuickAdd;
}

async function selectRootAndSave(): Promise<{ close: ReturnType<typeof vi.fn> }> {
	const close = vi.fn();
	const { container } = render(ExportPackageModal, {
		props: {
			app: fakeApp(),
			plugin: fakePlugin(),
			allChoices: [ROOT_CHOICE],
			close,
		},
	});

	// Select the single root choice so rootChoiceIds is non-empty.
	const checkbox = container.querySelector(
		'input[type="checkbox"]',
	) as HTMLInputElement;
	await fireEvent.change(checkbox, { target: { checked: true } });

	const saveButton = container.querySelector(
		".saveRow button",
	) as HTMLButtonElement;
	await fireEvent.click(saveButton);

	return { close };
}

// The obsidian test stub records every constructed Notice; the public type does
// not expose `instances`, so cast through the shape other audit tests use.
function noticeStore(): { instances: { message: string }[] } {
	return Notice as unknown as { instances: { message: string }[] };
}

function noticeMessages(): string[] {
	return noticeStore().instances.map((n) => n.message);
}

beforeEach(() => {
	noticeStore().instances.length = 0;
	writePackageToVault.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("ExportPackageModal save notices (audit)", () => {
	it("says 'Saved package … to' when the file is new (overwritten=false)", async () => {
		writePackageToVault.mockResolvedValue({ overwritten: false });

		await selectRootAndSave();

		await waitFor(() => {
			expect(
				noticeMessages().some((m) => m.startsWith("Saved package")),
			).toBe(true);
		});
		expect(
			noticeMessages().some((m) => m.startsWith("Overwrote package")),
		).toBe(false);
	});

	it("says 'Overwrote package … at' when overwritten=true", async () => {
		writePackageToVault.mockResolvedValue({ overwritten: true });

		await selectRootAndSave();

		await waitFor(() => {
			expect(
				noticeMessages().some((m) => m.startsWith("Overwrote package")),
			).toBe(true);
		});
		expect(
			noticeMessages().some((m) => m.startsWith("Saved package")),
		).toBe(false);
	});

	it("surfaces a neutral 'Save cancelled.' (not 'Save failed: …') when the overwrite is declined", async () => {
		writePackageToVault.mockRejectedValue(
			new Error(
				"Save cancelled: 'QuickAdd Packages/test.quickadd.json' already exists.",
			),
		);

		const { close } = await selectRootAndSave();

		await waitFor(() => {
			expect(noticeMessages()).toContain("Save cancelled.");
		});
		// No contradictory failure notice, and the modal stays open.
		expect(
			noticeMessages().some((m) => m.startsWith("Save failed")),
		).toBe(false);
		expect(close).not.toHaveBeenCalled();
	});

	it("still reports genuine write errors as 'Save failed: …'", async () => {
		writePackageToVault.mockRejectedValue(new Error("disk full"));

		await selectRootAndSave();

		await waitFor(() => {
			expect(noticeMessages()).toContain("Save failed: disk full");
		});
	});
});
