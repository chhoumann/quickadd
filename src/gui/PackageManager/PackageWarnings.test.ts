import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import { packageAsset } from "../../../tests/helpers/packages/fixtures";
import PackageWarnings from "./PackageWarnings.svelte";
import { buildPackagePreview } from "../../services/packagePreview";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type { IUserScript } from "../../types/macros/IUserScript";
import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
import { CommandType } from "../../types/macros/CommandType";
import { encodeToBase64 } from "../../utils/base64";

function packageWith(
	choices: IChoice[],
	assets: QuickAddPackage["assets"] = [],
): QuickAddPackage {
	return {
		schemaVersion: 1,
		quickAddVersion: "2.28.0",
		createdAt: "2026-09-27T00:00:00.000Z",
		rootChoiceIds: choices.map((choice) => choice.id),
		choices: choices.map((choice) => ({
			choice,
			pathHint: [choice.name],
			parentChoiceId: null,
		})),
		assets,
	};
}

const templateWithMissingFile = {
	id: "t1",
	name: "Weekly review",
	type: "Template",
	command: false,
	templatePath: "Templates/Weekly review.md",
} as unknown as ITemplateChoice;

const formatHighlights: IUserScript = {
	id: "c1",
	name: "formatHighlights",
	type: CommandType.UserScript,
	path: "scripts/formatHighlights.js",
	settings: {},
};

const macroWithMissingScript: IMacroChoice = {
	id: "m1",
	name: "Readwise",
	type: "Macro",
	command: false,
	runOnStartup: false,
	macro: { id: "m1-body", name: "Readwise", commands: [formatHighlights] },
};

function renderWarnings(pkg: QuickAddPackage) {
	const preview = buildPackagePreview([], pkg, new Set());
	return render(PackageWarnings, { props: { preview } });
}

function calloutTitled(container: HTMLElement, title: string) {
	return [...container.querySelectorAll<HTMLElement>(".callout")].find(
		(callout) =>
			callout.querySelector(".callout-title-inner")?.textContent?.trim() ===
			title,
	);
}

describe("PackageWarnings", () => {
	it("shows a missing template as a warning", () => {
		const { container } = renderWarnings(packageWith([templateWithMissingFile]));

		expect(calloutTitled(container, "Missing files")?.dataset.callout).toBe(
			"warning",
		);
	});

	it("escalates to danger when a missing file would run as a script", () => {
		// The script runs from whatever file exists at that path after import,
		// so it outranks a missing template sharing the same callout.
		const { container } = renderWarnings(
			packageWith([templateWithMissingFile, macroWithMissingScript]),
		);

		expect(calloutTitled(container, "Missing files")?.dataset.callout).toBe(
			"danger",
		);
	});

	it("keeps unreferenced files informational and separate from missing ones", () => {
		const { container } = renderWarnings(
			packageWith(
				[],
				[packageAsset("template", "Templates/Old header.md", encodeToBase64("# Old"))],
			),
		);

		expect(calloutTitled(container, "Missing files")).toBeUndefined();
		expect(calloutTitled(container, "Unreferenced files")?.dataset.callout).toBe(
			"info",
		);
	});
});
