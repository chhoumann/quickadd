// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { BuilderPage } from "./builderPage";

class Page extends BuilderPage<null> {
	constructor(app: App) {
		super(app, "Page", () => {});
	}
	protected render(): void {}
	protected result(): null {
		return null;
	}
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A settings tab with a button that opens a page, the button focused. */
function openFromButton() {
	const app = new App() as App & { setting: { openPage: () => void } };
	app.setting = { openPage: vi.fn() };
	const content = document.createElement("div");
	content.className = "vertical-tab-content-container";
	content.tabIndex = -1;
	const button = document.createElement("button");
	button.setAttribute("aria-label", "Configure");
	content.appendChild(button);
	document.body.appendChild(content);
	button.focus();
	const page = new Page(app);
	page.open();
	return { page, content, button };
}

describe("BuilderPage back focus", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("gives focus back to the control that opened the page", async () => {
		const { page, content, button } = openFromButton();

		page.hide();
		content.focus(); // what Obsidian focuses on back
		await nextTask();

		expect(document.activeElement).toBe(button);
	});

	it("drops that focus when the page opens again before it fires", async () => {
		const { page, content } = openFromButton();

		page.hide();
		content.focus();
		page.open();
		await nextTask();

		expect(document.activeElement).toBe(content);
	});
});
