/**
 * Slice 1 smoke gate for the Svelte 5 rewrite.
 *
 * Proves the new test pipeline works end-to-end BEFORE any component is rewritten:
 *  - @sveltejs/vite-plugin-svelte compiles a real .svelte component under vitest
 *  - @testing-library/svelte v5 mounts it (Svelte 5 mount()) in jsdom
 *  - the obsidian alias/stub supplies the standalone setIcon() the component imports
 *  - svelte-dnd-action's load-bearing exports still resolve under the new resolver
 *    conditions (svelteTesting adds the 'browser' condition; the lib also exposes a
 *    'svelte' source condition — confirm we don't pull a broken build)
 *
 * ObsidianIcon is still a legacy (Svelte 4 syntax) component here; that it renders
 * confirms legacy + runes components coexist in one compile, which the atomic rewrite
 * relies on while clusters are converted.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import { mount, unmount } from "svelte";
import { SHADOW_PLACEHOLDER_ITEM_ID, SOURCES, dndzone } from "svelte-dnd-action";
import ObsidianIcon from "./ObsidianIcon.svelte";

describe("svelte 5 test pipeline smoke gate", () => {
	it("resolves svelte-dnd-action's load-bearing exports", () => {
		expect(typeof SHADOW_PLACEHOLDER_ITEM_ID).toBe("string");
		expect(SOURCES.POINTER).toBeDefined();
		expect(typeof dndzone).toBe("function");
	});

	it("exposes the Svelte 5 imperative mount/unmount API", () => {
		expect(mount).toBeTypeOf("function");
		expect(unmount).toBeTypeOf("function");
	});

	it("compiles + renders a component via vite-plugin-svelte using the obsidian stub", () => {
		const { container } = render(ObsidianIcon, {
			props: { iconId: "trash", size: 16 },
		});
		const icon = container.querySelector(".quickadd-icon");
		expect(icon).not.toBeNull();
		// onMount -> updateIcon -> setIcon(el, "trash"); the stub appends <svg data-icon>.
		expect(icon?.querySelector("svg")?.getAttribute("data-icon")).toBe("trash");
	});
});
