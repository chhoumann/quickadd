import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import SettingItem from "./SettingItem.svelte";

describe("SettingItem", () => {
	it("renders Obsidian setting markup with name + description", () => {
		const { container } = render(SettingItem, {
			props: { name: "Task", desc: "Formats the value as a task." },
		});
		expect(container.querySelector(".setting-item")).toBeTruthy();
		expect(container.querySelector(".setting-item-name")?.textContent).toBe(
			"Task",
		);
		expect(
			container.querySelector(".setting-item-description")?.textContent,
		).toBe("Formats the value as a task.");
		expect(container.querySelector(".setting-item-control")).toBeTruthy();
	});

	it("renders the heading variant", () => {
		const { container } = render(SettingItem, {
			props: { name: "Location", heading: true },
		});
		expect(container.querySelector(".setting-item-heading")).toBeTruthy();
	});
});
