import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import FilePreviewRow from "./FilePreviewRow.svelte";
import type { PreviewFile } from "../../services/packagePreview";
import type {
	QuickAddPackage,
	QuickAddPackageAssetKind,
} from "../../types/packages/QuickAddPackage";
import { encodeToBase64 } from "../../utils/base64";

function makeFile(overrides: Partial<PreviewFile> = {}): PreviewFile {
	return {
		originalPath: "scripts/fetch.js",
		kind: "user-script",
		bundled: true,
		executable: true,
		exists: false,
		sizeBytes: 20,
		orphan: false,
		referencedBy: [],
		...overrides,
	};
}

function makePackage(
	path: string,
	content: string,
	kind: QuickAddPackageAssetKind = "user-script",
): QuickAddPackage {
	return {
		schemaVersion: 1,
		quickAddVersion: "1.18.0",
		createdAt: "2026-06-01T00:00:00.000Z",
		rootChoiceIds: [],
		choices: [],
		assets: [
			{
				kind,
				originalPath: path,
				contentEncoding: "base64",
				content: encodeToBase64(content),
			},
		],
	};
}

const noop = () => {};

describe("FilePreviewRow", () => {
	it("shows a NEW FILE status when the destination does not exist", () => {
		const { getByText } = render(FilePreviewRow, {
			props: {
				file: makeFile(),
				pkg: makePackage("scripts/fetch.js", "x"),
				mode: "write",
				destinationPath: "scripts/fetch.js",
				destinationExists: false,
				onPathInput: noop,
				onModeChange: noop,
				onReviewed: noop,
			},
		});
		expect(getByText("New file")).toBeTruthy();
	});

	it("shows a WILL OVERWRITE status when the destination exists", () => {
		const { getByText } = render(FilePreviewRow, {
			props: {
				file: makeFile({ exists: true }),
				pkg: makePackage("scripts/fetch.js", "x"),
				mode: "overwrite",
				destinationPath: "scripts/fetch.js",
				destinationExists: true,
				onPathInput: noop,
				onModeChange: noop,
				onReviewed: noop,
			},
		});
		expect(getByText("Will overwrite")).toBeTruthy();
	});

	it("labels executable scripts and reveals decoded contents on expand", async () => {
		const onReviewed = vi.fn();
		const source = "console.log('hello')";
		const { getByText, queryByText } = render(FilePreviewRow, {
			props: {
				file: makeFile(),
				pkg: makePackage("scripts/fetch.js", source),
				mode: "write",
				destinationPath: "scripts/fetch.js",
				destinationExists: false,
				onPathInput: noop,
				onModeChange: noop,
				onReviewed,
			},
		});

		// Contents hidden until expanded.
		expect(queryByText(source)).toBeNull();

		await fireEvent.click(getByText("View contents"));

		expect(getByText(source)).toBeTruthy();
		expect(getByText("Executable")).toBeTruthy();
		// Expanding a critical script reports it as reviewed for the gate.
		expect(onReviewed).toHaveBeenCalledWith("scripts/fetch.js");
	});

	it("does not report non-executable files as reviewed", async () => {
		const onReviewed = vi.fn();
		const { getByText } = render(FilePreviewRow, {
			props: {
				file: makeFile({
					originalPath: "templates/Note.md",
					kind: "template",
					executable: false,
				}),
				pkg: makePackage("templates/Note.md", "# Note", "template"),
				mode: "write",
				destinationPath: "templates/Note.md",
				destinationExists: false,
				onPathInput: noop,
				onModeChange: noop,
				onReviewed,
			},
		});

		await fireEvent.click(getByText("View contents"));
		expect(onReviewed).not.toHaveBeenCalled();
	});

	it("warns and drops the Reviewed badge when an executable script is skipped", () => {
		// Skip points the dependent choice at whatever file is already on disk,
		// so the reviewed bundled contents are NOT what runs: the badge must not
		// imply otherwise, and a warning must explain the substitution.
		const { getByText, queryByText } = render(FilePreviewRow, {
			props: {
				file: makeFile(),
				pkg: makePackage("scripts/fetch.js", "x"),
				mode: "skip",
				destinationPath: "scripts/fetch.js",
				destinationExists: true,
				reviewed: true,
				onPathInput: noop,
				onModeChange: noop,
				onReviewed: noop,
			},
		});

		expect(queryByText("Reviewed")).toBeNull();
		expect(getByText(/Won't be written/)).toBeTruthy();
	});

	it("keeps the Reviewed badge and no skip warning when the script will be written", () => {
		const { getByText, queryByText } = render(FilePreviewRow, {
			props: {
				file: makeFile(),
				pkg: makePackage("scripts/fetch.js", "x"),
				mode: "write",
				destinationPath: "scripts/fetch.js",
				destinationExists: false,
				reviewed: true,
				onPathInput: noop,
				onModeChange: noop,
				onReviewed: noop,
			},
		});

		expect(getByText("Reviewed")).toBeTruthy();
		expect(queryByText(/Won't be written/)).toBeNull();
	});

	it("drives the destination/action callbacks via labelled controls", async () => {
		const onPathInput = vi.fn();
		const onModeChange = vi.fn();
		const { getByLabelText } = render(FilePreviewRow, {
			props: {
				file: makeFile(),
				pkg: makePackage("scripts/fetch.js", "x"),
				mode: "write",
				destinationPath: "scripts/fetch.js",
				destinationExists: false,
				onPathInput,
				onModeChange,
				onReviewed: noop,
			},
		});

		// Controls are reachable by their field name (label association intact).
		const input = getByLabelText("Destination") as HTMLInputElement;
		await fireEvent.input(input, { target: { value: "vault/new.js" } });
		expect(onPathInput).toHaveBeenCalledWith("vault/new.js");

		const select = getByLabelText("Action") as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: "skip" } });
		expect(onModeChange).toHaveBeenCalledWith("skip");
	});
});
