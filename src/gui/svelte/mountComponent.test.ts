import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { mountComponent } from "./mountComponent";
import ObsidianIcon from "../components/ObsidianIcon.svelte";
import MountThrows from "./mountThrows.fixture.svelte";
import MountThrowsDeep from "./mountThrowsDeep.fixture.svelte";
import ChoicesUnavailable from "../choiceList/ChoicesUnavailable.svelte";
import { log } from "../../logger/logManager";

describe("mountComponent", () => {
	it("mounts a component into the target and renders it", () => {
		const target = document.createElement("div");
		const handle = mountComponent(target, ObsidianIcon, { iconId: "trash", size: 16 });
		expect(target.querySelector(".quickadd-icon")).not.toBeNull();
		expect(handle.ok).toBe(true);
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

/**
 * The seam's real job (#1584): a component that throws during mount used to take
 * its whole host down with it - a Modal that never opened, or a settings tab that
 * abandoned every remaining group. These pin the "partial and visible, never total
 * and silent" contract.
 */
describe("mountComponent: a failed mount", () => {
	const logError = vi.spyOn(log, "logError").mockImplementation(() => {});

	afterEach(() => {
		logError.mockClear();
	});

	it("does not throw, so the host keeps building", () => {
		const target = document.createElement("div");
		expect(() =>
			mountComponent(target, MountThrows, { commands: null }),
		).not.toThrow();
	});

	it("reports the error once, naming what could not be displayed", () => {
		const target = document.createElement("div");
		mountComponent(target, MountThrows, { commands: null }, {
			what: "this macro's commands",
		});

		expect(logError).toHaveBeenCalledTimes(1);
		const reported = logError.mock.calls[0][0] as Error;
		// No "QuickAdd" prefix — GuiLogger adds one, and "QuickAdd: (ERROR) QuickAdd
		// couldn't ..." is what the Notice read before.
		expect(reported.message).toContain("Couldn't display this macro's commands");
		expect(reported.message).not.toContain("QuickAdd couldn't");
		// The underlying cause survives - it is what makes a bug report actionable.
		expect(reported.message).toContain("filter");
	});

	it("renders the fallback card in the component's place", () => {
		const target = document.createElement("div");
		mountComponent(target, MountThrows, { commands: null }, {
			what: "this macro's commands",
		});

		const card = target.querySelector(".qaMountFailed");
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain("QuickAdd couldn't display this macro's commands");
		expect(target.querySelector(".qaMountFailedDetail")?.textContent).toContain("filter");
	});

	it("uses the host's own fallback card when one is given", () => {
		const target = document.createElement("div");
		mountComponent(target, MountThrows, { commands: null }, {
			what: "your choices",
			fallbackComponent: ChoicesUnavailable,
		});

		expect(target.querySelector(".qaMountFailed")).toBeNull();
		const card = target.querySelector(".qaChoicesUnavailable");
		expect(card?.textContent).toContain("QuickAdd couldn't display your choices");
		// The settings card's whole reason to exist: the recovery instructions.
		expect(card?.textContent).toContain("data.json");
	});

	it("reports ok:false so hosts can tell a rendered view from a card", () => {
		const target = document.createElement("div");
		expect(mountComponent(target, MountThrows, { commands: null }).ok).toBe(false);
	});

	it("leaves the host's own content alone and clears the failed mount's debris", () => {
		const target = document.createElement("div");
		const hostOwned = document.createElement("p");
		hostOwned.textContent = "built by the host";
		target.appendChild(hostOwned);

		// Throws BELOW some markup, so mount() gets part-way in before it fails.
		mountComponent(target, MountThrowsDeep, { commands: null });

		// The host's node is untouched (target belongs to the host - a Setting's
		// controlEl, a Modal's contentEl - so emptying it would be destructive).
		expect(target.firstChild).toBe(hostOwned);
		// Nothing survives from the half-built tree, only the fallback host.
		expect(target.querySelector(".mount-throws-deep-fixture")).toBeNull();
		expect(target.childNodes.length).toBe(2);
		expect(target.lastElementChild?.className).toBe("qa-mount-failed-host");
	});

	it("destroy() removes the fallback, idempotently", () => {
		const target = document.createElement("div");
		const handle = mountComponent(target, MountThrows, { commands: null });
		expect(target.querySelector(".qaMountFailed")).not.toBeNull();

		handle.destroy();
		flushSync();
		expect(target.querySelector(".qa-mount-failed-host")).toBeNull();
		expect(target.childNodes.length).toBe(0);
		expect(() => handle.destroy()).not.toThrow();
	});
});
