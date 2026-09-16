import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "svelte";
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
		requiresReview: true,
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

const noop = () => { };

function renderRow(props: Partial<ComponentProps<typeof FilePreviewRow>> = {}) {
	return render(FilePreviewRow, {
		props: {
			file: makeFile(),
			pkg: makePackage("scripts/fetch.js", "x"),
			mode: "write",
			destinationPath: "scripts/fetch.js",
			destinationExists: false,
			onPathInput: noop,
			onModeChange: noop,
			onReviewed: noop,
			...props,
		},
	});
}

describe("FilePreviewRow", () => {
	it("shows a NEW FILE status when the destination does not exist", () => {
		const { getByText } = renderRow({
		});
		expect(getByText("New file")).toBeTruthy();
	});

	it("shows a WILL OVERWRITE status when the destination exists", () => {
		const { getByText } = renderRow({
			file: makeFile({ exists: true }),
			mode: "overwrite",
			destinationExists: true,
		});
		expect(getByText("Will overwrite")).toBeTruthy();
	});

	it("labels executable scripts and reveals decoded contents on expand", async () => {
		const onReviewed = vi.fn();
		const source = "console.log('hello')";
		const { getByText, queryByText } = renderRow({
			pkg: makePackage("scripts/fetch.js", source),
			onReviewed,
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
		const { getByText } = renderRow({
			file: makeFile({
				originalPath: "templates/Note.md",
				kind: "template",
				executable: false,
				requiresReview: false,
			}),
			pkg: makePackage("templates/Note.md", "# Note", "template"),
			destinationPath: "templates/Note.md",
			onReviewed,
		});

		await fireEvent.click(getByText("View contents"));
		expect(onReviewed).not.toHaveBeenCalled();
	});

	it("reports gate-required bundled scripts as reviewed even when not command-graph executable", async () => {
		const onReviewed = vi.fn();
		const { getByText } = renderRow({
			file: makeFile({
				originalPath: "scripts/orphan.js",
				executable: false,
				requiresReview: true,
				orphan: true,
			}),
			pkg: makePackage("scripts/orphan.js", "console.log('orphan')"),
			destinationPath: "scripts/orphan.js",
			onReviewed,
		});

		await fireEvent.click(getByText("View contents"));
		expect(onReviewed).toHaveBeenCalledWith("scripts/orphan.js");
	});

	it("warns and drops the Reviewed badge when an executable script is skipped", () => {
		// Skip points the dependent choice at whatever file is already on disk,
		// so the reviewed bundled contents are NOT what runs: the badge must not
		// imply otherwise, and a warning must explain the substitution.
		const { getByText, queryByText } = renderRow({
			mode: "skip",
			destinationExists: true,
			reviewed: true,
		});

		expect(queryByText("Reviewed")).toBeNull();
		expect(getByText(/Won't be written/)).toBeTruthy();
	});

	it("keeps the Reviewed badge and no skip warning when the script will be written", () => {
		const { getByText, queryByText } = renderRow({
			reviewed: true,
		});

		expect(getByText("Reviewed")).toBeTruthy();
		expect(queryByText(/Won't be written/)).toBeNull();
	});

	it("drives the destination/action callbacks via labelled controls", async () => {
		const onPathInput = vi.fn();
		const onModeChange = vi.fn();
		const { getByLabelText } = renderRow({
			onPathInput,
			onModeChange,
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
