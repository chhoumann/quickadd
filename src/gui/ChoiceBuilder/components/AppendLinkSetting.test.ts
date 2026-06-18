import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import AppendLinkSetting from "./AppendLinkSetting.svelte";
import type { AppendLinkOptions } from "../../../types/linkPlacement";

function settingNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll(".setting-item-name")).map(
		(el) => el.textContent ?? "",
	);
}

describe("AppendLinkSetting", () => {
	it("shows only the mode row when disabled", () => {
		const { container } = render(AppendLinkSetting, {
			props: { appendLink: false, fileLabel: "created" },
		});
		expect(settingNames(container)).toEqual(["Link to created file"]);
	});

	it("shows placement + link type when enabled with an embed-capable placement", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
			linkType: "link",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "captured" },
		});
		expect(settingNames(container)).toEqual([
			"Link to captured file",
			"Link destination",
			"Link placement",
			"Link type",
		]);
	});

	it("hides link type for placements that do not support embeds", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "endOfLine",
			requireActiveFile: false,
			linkType: "link",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "captured" },
		});
		expect(settingNames(container)).toEqual([
			"Link to captured file",
			"Link destination",
			"Link placement",
		]);
		expect(settingNames(container)).not.toContain("Link type");
	});

	it("shows a destination file input instead of placement controls for specified-note links", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: false,
			linkType: "embed",
			destination: { type: "specifiedFile", path: "Indexes/MOC.md" },
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});
		expect(settingNames(container)).toEqual([
			"Link to created file",
			"Link destination",
			"Destination file",
		]);
		expect(settingNames(container)).not.toContain("Link placement");
		expect(settingNames(container)).not.toContain("Link type");
	});
});
