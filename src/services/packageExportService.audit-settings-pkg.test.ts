import { describe, expect, it, vi } from "vitest";
import { writePackageToVault } from "./packageExportService";
import { QUICKADD_PACKAGE_SCHEMA_VERSION } from "../types/packages/QuickAddPackage";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";

// Regression coverage for the settings-package-export overwrite footgun:
// writePackageToVault previously called adapter.write unconditionally, silently
// clobbering any existing file at the chosen (freely editable) path. It must now
// confirm before overwriting an existing file and abort if the user declines.

function makePackage(): QuickAddPackage {
	return {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "1.0.0",
		createdAt: "2026-01-01T00:00:00.000Z",
		rootChoiceIds: [],
		choices: [],
		assets: [],
	};
}

function makeFakeApp(existing: boolean) {
	const writes: Array<{ path: string; content: string }> = [];
	const adapter = {
		exists: vi.fn(async (_path: string) => existing),
		write: vi.fn(async (path: string, content: string) => {
			writes.push({ path, content });
		}),
	};
	const app = {
		vault: {
			adapter,
			createFolder: vi.fn(async () => {}),
		},
	};
	return { app, adapter, writes };
}

describe("writePackageToVault overwrite confirmation (audit)", () => {
	it("does NOT prompt and writes directly when the target does not exist", async () => {
		const { app, writes } = makeFakeApp(false);
		const confirmOverwrite = vi.fn(async () => true);

		const result = await writePackageToVault(
			app as never,
			makePackage(),
			"QuickAdd Packages/new.quickadd.json",
			{ confirmOverwrite },
		);

		expect(confirmOverwrite).not.toHaveBeenCalled();
		expect(writes).toHaveLength(1);
		expect(result.overwritten).toBe(false);
	});

	it("confirms before overwriting an existing file and writes when confirmed", async () => {
		const { app, writes } = makeFakeApp(true);
		const confirmOverwrite = vi.fn(async () => true);

		const result = await writePackageToVault(
			app as never,
			makePackage(),
			"Existing/note.md",
			{ confirmOverwrite },
		);

		expect(confirmOverwrite).toHaveBeenCalledWith("Existing/note.md");
		expect(writes).toHaveLength(1);
		expect(result.overwritten).toBe(true);
	});

	it("aborts the write (throws, no adapter.write) when the user declines the overwrite", async () => {
		const { app, adapter, writes } = makeFakeApp(true);
		const confirmOverwrite = vi.fn(async () => false);

		await expect(
			writePackageToVault(app as never, makePackage(), "Existing/note.md", {
				confirmOverwrite,
			}),
		).rejects.toThrow("already exists");

		expect(confirmOverwrite).toHaveBeenCalledOnce();
		expect(adapter.write).not.toHaveBeenCalled();
		expect(writes).toEqual([]);
	});
});
