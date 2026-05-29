import { describe, expect, it } from "vitest";
import { flushSync } from "svelte";
import { render } from "@testing-library/svelte";
import ObsidianIcon from "./ObsidianIcon.svelte";

const iconOf = (c: HTMLElement) =>
	c.querySelector(".quickadd-icon svg")?.getAttribute("data-icon");

describe("ObsidianIcon", () => {
	it("renders the icon and applies size on mount", () => {
		const { container } = render(ObsidianIcon, { props: { iconId: "trash", size: 20 } });
		const svg = container.querySelector(".quickadd-icon svg");
		expect(svg?.getAttribute("data-icon")).toBe("trash");
		expect(svg?.getAttribute("width")).toBe("20");
		expect(svg?.getAttribute("height")).toBe("20");
	});

	it("defaults size to 16", () => {
		const { container } = render(ObsidianIcon, { props: { iconId: "trash" } });
		expect(container.querySelector(".quickadd-icon svg")?.getAttribute("width")).toBe("16");
	});

	it("swaps the icon reactively when iconId changes (proves $effect, not a one-shot)", async () => {
		const { container, rerender } = render(ObsidianIcon, {
			props: { iconId: "trash", size: 16 },
		});
		expect(iconOf(container)).toBe("trash");
		await rerender({ iconId: "pencil", size: 16 });
		flushSync();
		expect(iconOf(container)).toBe("pencil");
	});

	it("unmounts cleanly (teardown does not throw)", () => {
		const { unmount } = render(ObsidianIcon, { props: { iconId: "trash", size: 16 } });
		expect(() => {
			unmount();
			flushSync();
		}).not.toThrow();
	});
});
