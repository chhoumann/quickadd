import { expect, it } from "vitest";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

const getContext = createQuickAddE2EHarness("suggestion-container-scope");

// Core's editor suggestions and QuickAdd's own list share `.suggestion-container`.
it("leaves core's link suggestions alone and keeps QuickAdd's list above its modal", async () => {
	const { obsidian, sandbox } = getContext();
	const path = await seedVaultFile(obsidian, sandbox, "Note.md", "x\n");

	const core = await obsidian.dev.evalJsonAsync<{ zIndex: string } | null>(`(async () => {
		const leaf = app.workspace.getLeaf(true);
		await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: "source" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		const cm = leaf.view.editor.cm;
		const end = cm.state.doc.length;
		cm.dispatch({ changes: { from: end, insert: "[[" }, selection: { anchor: end + 2 }, userEvent: "input.type" });
		let el = null;
		for (let i = 0; i < 50 && !el; i++) {
			await new Promise((r) => setTimeout(r, 100));
			el = document.querySelector(".suggestion-container:not(.qa-text-input-suggest)");
		}
		const result = el && { zIndex: getComputedStyle(el).zIndex };
		leaf.detach();
		return result;
	})()`);
	expect(core).not.toBeNull();
	expect(core?.zIndex).not.toBe("100000");

	const own = await obsidian.dev.evalJsonAsync<{ zIndex: string; onTop: boolean } | null>(`(async () => {
		const done = app.plugins.plugins.quickadd.api
			.requestInputs([{ id: "planet", label: "Planet", type: "suggester", options: ["Saturn", "Sun", "Mars"] }])
			.catch(() => null);
		let input = null;
		for (let i = 0; i < 50 && !input; i++) {
			await new Promise((r) => setTimeout(r, 100));
			input = document.querySelector(".onePageInputModal input");
		}
		input.focus();
		input.value = "s";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		let el = null;
		for (let i = 0; i < 50 && !el; i++) {
			await new Promise((r) => setTimeout(r, 100));
			el = document.querySelector(".suggestion-container.qa-text-input-suggest");
		}
		const rect = el?.getBoundingClientRect();
		const hit = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + 10);
		const result = el && { zIndex: getComputedStyle(el).zIndex, onTop: !!hit && el.contains(hit) };
		[...document.querySelectorAll(".onePageInputModal button")].find((b) => b.textContent.trim() === "Cancel")?.click();
		await done;
		return result;
	})()`);
	expect(own).toEqual({ zIndex: "100000", onTop: true });
});
