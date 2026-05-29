import { describe, expect, it } from "vitest";
import { flushSync } from "svelte";
import { mountComponent } from "./mountComponent";
import ObsidianIcon from "../components/ObsidianIcon.svelte";

describe("mountComponent", () => {
	it("mounts a component into the target and renders it", () => {
		const target = document.createElement("div");
		const handle = mountComponent(target, ObsidianIcon, { iconId: "trash", size: 16 });
		expect(target.querySelector(".quickadd-icon")).not.toBeNull();
		handle.destroy();
	});

	it("destroy() unmounts the component from the DOM", () => {
		const target = document.createElement("div");
		const handle = mountComponent(target, ObsidianIcon, { iconId: "trash", size: 16 });
		expect(target.querySelector(".quickadd-icon")).not.toBeNull();
		handle.destroy();
		flushSync();
		expect(target.querySelector(".quickadd-icon")).toBeNull();
	});

	it("destroy() is idempotent (no throw on double teardown)", () => {
		const target = document.createElement("div");
		const handle = mountComponent(target, ObsidianIcon, { iconId: "trash", size: 16 });
		handle.destroy();
		flushSync();
		expect(() => handle.destroy()).not.toThrow();
	});
});
