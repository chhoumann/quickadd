import { describe, expect, it, beforeEach } from "vitest";
import { renderDevelopmentInfo } from "./quickAddSettingsDevelopmentInfo";

function expectNoPayloadDom(el: HTMLElement): void {
	expect(el.querySelector("img, script, svg")).toBeNull();
	expect((globalThis as typeof globalThis & { __qaXss?: number }).__qaXss)
		.toBeUndefined();
}

describe("renderDevelopmentInfo", () => {
	beforeEach(() => {
		delete (globalThis as typeof globalThis & { __qaXss?: number }).__qaXss;
	});

	it("renders malicious git metadata as text while preserving labels", () => {
		const payload = "<img src=x onerror=globalThis.__qaXss=1>";
		const container = document.createElement("div");

		renderDevelopmentInfo(container, {
			branch: `feature/${payload}`,
			commit: `abc123${payload}`,
			dirty: true,
		});

		expect(container.textContent).toContain("Branch:");
		expect(container.textContent).toContain(`feature/${payload}`);
		expect(container.textContent).toContain("Commit:");
		expect(container.textContent).toContain(`abc123${payload}`);
		expect(container.textContent).toContain("Uncommitted changes:");
		expect(container.textContent).toContain("Yes (uncommitted changes)");
		expect(container.querySelector(".qa-dev-dirty-status")).not.toBeNull();
		expectNoPayloadDom(container);
	});

	it("uses clean status class for clean dev builds", () => {
		const container = document.createElement("div");

		renderDevelopmentInfo(container, {
			branch: null,
			commit: null,
			dirty: false,
		});

		expect(container.textContent).toContain("Uncommitted changes: No");
		expect(container.querySelector(".qa-dev-clean-status")).not.toBeNull();
	});
});
