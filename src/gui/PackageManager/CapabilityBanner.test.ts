import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import CapabilityBanner from "./CapabilityBanner.svelte";
import { buildPackagePreview } from "../../services/packagePreview";
import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type { IUserScript } from "../../types/macros/IUserScript";
import { CommandType } from "../../types/macros/CommandType";
import { encodeToBase64 } from "../../utils/base64";

function criticalPackage(): QuickAddPackage {
	const script: IUserScript = {
		id: "cmd1",
		name: "fetch",
		type: CommandType.UserScript,
		path: "scripts/fetch.js",
		settings: {},
	};
	const macro: IMacroChoice = {
		id: "m1",
		name: "Daily Sync",
		type: "Macro",
		command: false,
		runOnStartup: true,
		macro: { id: "macro-m1", name: "Daily Sync", commands: [script] },
	};
	return {
		schemaVersion: 1,
		quickAddVersion: "1.18.0",
		createdAt: "2026-06-01T00:00:00.000Z",
		rootChoiceIds: ["m1"],
		choices: [{ choice: macro, pathHint: ["Daily Sync"], parentChoiceId: null }],
		assets: [
			{
				kind: "user-script",
				originalPath: "scripts/fetch.js",
				contentEncoding: "base64",
				content: encodeToBase64("console.log(1)"),
			},
		],
	};
}

const preview = buildPackagePreview([], criticalPackage(), new Set());

describe("CapabilityBanner", () => {
	it("renders capability rows describing the danger", () => {
		const { getByText } = render(CapabilityBanner, { props: { preview } });
		expect(getByText("What this package can do")).toBeTruthy();
		expect(
			getByText(/Runs automatically every time Obsidian starts/),
		).toBeTruthy();
	});

	it("is a pure summary: the acknowledgement checkbox lives elsewhere", () => {
		// The gate moved next to the Import button so its 'review each script
		// above' copy is spatially honest; the banner no longer owns a checkbox.
		const { queryByRole } = render(CapabilityBanner, { props: { preview } });
		expect(queryByRole("checkbox")).toBeNull();
	});
});
