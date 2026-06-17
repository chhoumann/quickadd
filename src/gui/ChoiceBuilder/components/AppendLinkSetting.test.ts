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
		expect(settingNames(container)).toEqual([
			"Link to created file",
			"Copy link to clipboard",
		]);
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
			"Copy link to clipboard",
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
			"Copy link to clipboard",
			"Link placement",
		]);
		expect(settingNames(container)).not.toContain("Link type");
	});

	it("renders copy-only configuration while insertion is disabled", () => {
		const appendLink: AppendLinkOptions = {
			enabled: false,
			copyToClipboard: true,
			placement: "replaceSelection",
			requireActiveFile: false,
			linkType: "link",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		expect(settingNames(container)).toEqual([
			"Link to created file",
			"Copy link to clipboard",
		]);
		expect(
			container
				.querySelector('[role="switch"][aria-label="Copy link to clipboard"]')
				?.getAttribute("aria-checked"),
		).toBe("true");
	});
});
