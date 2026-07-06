import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
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

	it("shows destination + placement + link type when enabled with an embed-capable placement", () => {
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
			"Link display text",
		]);
	});

	it.each([
		"afterSelection",
		"endOfLine",
		"newLine",
	] as const)(
		"shows link type for the %s body placement",
		(placement) => {
			const appendLink: AppendLinkOptions = {
				enabled: true,
				placement,
				requireActiveFile: false,
				linkType: "embed",
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
		},
	);

	it("hides link type for the frontmatter placement", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "inFrontmatter",
			requireActiveFile: false,
			linkType: "link",
			frontmatterProperty: "related",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "captured" },
		});

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
		expect(settingNames(container)).not.toContain("Frontmatter property");
	});

	it("shows frontmatter property controls for current-note frontmatter placement", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "inFrontmatter",
			requireActiveFile: true,
			linkType: "link",
			frontmatterProperty: "related",
			frontmatterHandling: "alwaysAppend",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		expect(settingNames(container)).toEqual([
			"Link to created file",
			"Link destination",
			"Link placement",
			"Frontmatter property",
			"Property handling",
		]);
		expect(
			(
				container.querySelector(
					'input[aria-label="Frontmatter property"]',
				) as HTMLInputElement
			).value,
		).toBe("related");
		expect(
			Array.from(container.querySelectorAll("select")).at(-1)?.value,
		).toBe("alwaysAppend");
		expect(
			container
				.querySelector('input[aria-label="Frontmatter property"]')
				?.getAttribute("aria-invalid"),
		).toBe("false");
	});

	it("defaults frontmatter handling to create or convert", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "inFrontmatter",
			requireActiveFile: true,
			linkType: "link",
			frontmatterProperty: "related",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		const handlingSelect = Array.from(container.querySelectorAll("select")).at(
			-1,
		) as HTMLSelectElement;
		expect(handlingSelect.value).toBe("alwaysAppend");
		expect(
			Array.from(handlingSelect.options).map((option) => option.textContent),
		).toEqual(["Create or convert", "Create if missing", "Require list"]);
	});

	it("marks an empty frontmatter property as invalid", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "inFrontmatter",
			requireActiveFile: true,
			linkType: "link",
			frontmatterProperty: "   ",
			frontmatterHandling: "error",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		expect(
			container
				.querySelector('input[aria-label="Frontmatter property"]')
				?.getAttribute("aria-invalid"),
		).toBe("true");
	});

	it("preserves frontmatter settings when changing append-link mode", async () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "inFrontmatter",
			requireActiveFile: true,
			linkType: "link",
			frontmatterProperty: "related",
			frontmatterHandling: "createProperty",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "captured" },
		});

		const modeSelect = container.querySelector("select") as HTMLSelectElement;
		await fireEvent.change(modeSelect, { target: { value: "optional" } });

		expect(
			(
				container.querySelector(
					'input[aria-label="Frontmatter property"]',
				) as HTMLInputElement
			).value,
		).toBe("related");
		expect(
			Array.from(container.querySelectorAll("select")).at(-1)?.value,
		).toBe("createProperty");
	});

	it("preserves frontmatter settings when disabled and re-enabled", async () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "inFrontmatter",
			requireActiveFile: true,
			linkType: "link",
			frontmatterProperty: "related",
			frontmatterHandling: "alwaysAppend",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		const modeSelect = container.querySelector("select") as HTMLSelectElement;
		await fireEvent.change(modeSelect, { target: { value: "disabled" } });
		expect(settingNames(container)).toEqual(["Link to created file"]);

		await fireEvent.change(modeSelect, { target: { value: "required" } });

		expect(settingNames(container)).toEqual([
			"Link to created file",
			"Link destination",
			"Link placement",
			"Frontmatter property",
			"Property handling",
		]);
		expect(
			(
				container.querySelector(
					'input[aria-label="Frontmatter property"]',
				) as HTMLInputElement
			).value,
		).toBe("related");
		expect(
			Array.from(container.querySelectorAll("select")).at(-1)?.value,
		).toBe("alwaysAppend");
	});
});

describe("AppendLinkSetting display text", () => {
	function displayTextSelect(container: HTMLElement): HTMLSelectElement | null {
		return (
			Array.from(container.querySelectorAll("select")).find((select) =>
				Array.from(select.options).some(
					(option) => option.value === "selection",
				),
			) ?? null
		);
	}

	it("shows the display text row for both selection-anchored placements with a plain link", () => {
		for (const placement of ["replaceSelection", "afterSelection"] as const) {
			const appendLink: AppendLinkOptions = {
				enabled: true,
				placement,
				requireActiveFile: true,
				linkType: "link",
			};
			const { container } = render(AppendLinkSetting, {
				props: { appendLink, fileLabel: "created" },
			});
			expect(settingNames(container)).toContain("Link display text");
			expect(displayTextSelect(container)?.value).toBe("none");
		}
	});

	it("hides the display text row for embeds and cursor-anchored placements", () => {
		const cases: AppendLinkOptions[] = [
			{
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
				linkType: "embed",
			},
			{
				enabled: true,
				placement: "endOfLine",
				requireActiveFile: true,
				linkType: "link",
			},
			{
				enabled: true,
				placement: "newLine",
				requireActiveFile: true,
				linkType: "link",
			},
			{
				enabled: true,
				placement: "inFrontmatter",
				requireActiveFile: true,
				frontmatterProperty: "related",
			},
		];
		for (const appendLink of cases) {
			const { container } = render(AppendLinkSetting, {
				props: { appendLink, fileLabel: "created" },
			});
			expect(settingNames(container)).not.toContain("Link display text");
		}
	});

	it("hides the display text row for specified-note destinations", () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
			linkType: "link",
			destination: { type: "specifiedFile", path: "Index.md" },
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});
		expect(settingNames(container)).not.toContain("Link display text");
	});

	it("preserves the selection preference through unrelated dropdown changes", async () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
			linkType: "link",
			displayText: "selection",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		const modeSelect = container.querySelector("select") as HTMLSelectElement;
		await fireEvent.change(modeSelect, { target: { value: "optional" } });

		expect(displayTextSelect(container)?.value).toBe("selection");
	});

	it("resets the preference to default when the placement stops supporting it (lossy, matching link type)", async () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
			linkType: "link",
			displayText: "selection",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		const placementSelect = container.querySelectorAll(
			"select",
		)[2] as HTMLSelectElement;
		await fireEvent.change(placementSelect, { target: { value: "endOfLine" } });
		expect(settingNames(container)).not.toContain("Link display text");

		await fireEvent.change(placementSelect, {
			target: { value: "replaceSelection" },
		});
		expect(displayTextSelect(container)?.value).toBe("none");
	});

	it("stores the chosen display text on change", async () => {
		const appendLink: AppendLinkOptions = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
			linkType: "link",
		};
		const { container } = render(AppendLinkSetting, {
			props: { appendLink, fileLabel: "created" },
		});

		const select = displayTextSelect(container) as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: "selection" } });
		expect(displayTextSelect(container)?.value).toBe("selection");
	});
});
