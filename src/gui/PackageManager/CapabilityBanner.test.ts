import { packageAsset } from "../../../tests/helpers/packages/fixtures";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import CapabilityBanner from "./CapabilityBanner.svelte";
import { buildPackagePreview } from "../../services/packagePreview";
import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type { IUserScript } from "../../types/macros/IUserScript";
import { CommandType } from "../../types/macros/CommandType";
import { encodeToBase64 } from "../../utils/base64";

function packageWith(
	macro: IMacroChoice,
	assets: QuickAddPackage["assets"] = [],
): QuickAddPackage {
	return {
		schemaVersion: 1,
		quickAddVersion: "1.18.0",
		createdAt: "2026-06-01T00:00:00.000Z",
		rootChoiceIds: [macro.id],
		choices: [{ choice: macro, pathHint: [macro.name], parentChoiceId: null }],
		assets,
	};
}

function criticalPackage(): QuickAddPackage {
	const script: IUserScript = {
		id: "cmd1",
		name: "fetch",
		type: CommandType.UserScript,
		path: "scripts/fetch.js",
		settings: {},
	};
	return packageWith(
		{
			id: "m1",
			name: "Daily Sync",
			type: "Macro",
			command: false,
			runOnStartup: true,
			macro: { id: "macro-m1", name: "Daily Sync", commands: [script] },
		},
		[packageAsset("user-script", "scripts/fetch.js", encodeToBase64("console.log(1)"))],
	);
}

/** Adds a palette command and nothing else: no startup run, no scripts. */
function commandOnlyPackage(): QuickAddPackage {
	return packageWith({
		id: "c1",
		name: "Journal entry",
		type: "Macro",
		command: true,
		runOnStartup: false,
		macro: { id: "macro-c1", name: "Journal entry", commands: [] },
	});
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

	it("does not ask for a reload when the package only adds commands", () => {
		// Imports register their commands immediately (syncImportedChoiceCommands),
		// so a reload note here would send readers after a step they don't need.
		const commandOnly = buildPackagePreview([], commandOnlyPackage(), new Set());
		expect(commandOnly.summary.registersCommandCount).toBe(1);
		expect(commandOnly.summary.runsOnStartup).toBe(false);

		const { container, getByText, queryByText } = render(CapabilityBanner, {
			props: { preview: commandOnly },
		});
		expect(getByText("Adds commands to the command palette")).toBeTruthy();
		expect(container.querySelector(".qa-import-banner-note")).toBeNull();
		expect(queryByText(/reload|restart/i)).toBeNull();
	});

	it("uses a danger callout only when the package can run code", () => {
		const critical = render(CapabilityBanner, { props: { preview } });
		expect(
			critical.container.querySelector<HTMLElement>(".callout")?.dataset.callout,
		).toBe("danger");

		const commandOnly = buildPackagePreview([], commandOnlyPackage(), new Set());
		const warning = render(CapabilityBanner, { props: { preview: commandOnly } });
		expect(
			warning.container.querySelector<HTMLElement>(".callout")?.dataset.callout,
		).toBe("warning");
	});

	it("says a startup macro does not run until the next plugin load", () => {
		const { container } = render(CapabilityBanner, { props: { preview } });
		const note = container.querySelector(".qa-import-banner-note");
		expect(note?.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Importing doesn't run startup macros. They first run the next time Obsidian starts or you reload QuickAdd.",
		);
	});
});
