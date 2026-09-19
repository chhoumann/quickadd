import { expect, it } from "vitest";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("popout-suggestions");

it("renders and selects file suggestions in the prompt's popout window", async () => {
	const { obsidian, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, "Owner window target.md", "# Target");
	try {
		await obsidian.dev.evalJsonAsync(`(async () => {
			window.__qaOwnerLeaf = app.workspace.openPopoutLeaf();
			await window.__qaOwnerLeaf.setViewState({ type: "empty" });
			app.workspace.setActiveLeaf(window.__qaOwnerLeaf, { focus: true });
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson("activeDocument !== document"), POLL_OPTS).toBe(true);
		await obsidian.dev.evalJson(`(() => {
			window.__qaOwnerResult = "pending";
			void app.plugins.plugins.quickadd.api.inputPrompt("Owner window").then(
				value => window.__qaOwnerResult = value,
				() => window.__qaOwnerResult = "cancelled",
			);
			return true;
		})()`);
		await obsidian.dev.evalJson(`(() => {
			const doc = window.__qaOwnerLeaf.view.containerEl.ownerDocument;
			const input = doc.querySelector('.modal input');
			input.focus(); input.value = '[[Owner window target';
			input.setSelectionRange(input.value.length, input.value.length);
			input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson(`(() => {
			const doc = window.__qaOwnerLeaf.view.containerEl.ownerDocument;
			const popup = doc.querySelector('.suggestion-container');
			const label = popup?.querySelector('.suggestion-main-text');
			return !!popup && popup instanceof doc.defaultView.HTMLElement &&
				!!label && label instanceof doc.defaultView.HTMLElement && label.textContent.includes('Owner window target');
		})()`), POLL_OPTS).toBe(true);
		await obsidian.dev.evalJson(`(() => {
			const doc = window.__qaOwnerLeaf.view.containerEl.ownerDocument;
			doc.querySelector('.suggestion-container .suggestion-item').click();
			doc.querySelector('.modal button.mod-cta').click();
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson("window.__qaOwnerResult"), POLL_OPTS).toContain("Owner window target]]");
	} finally {
		await obsidian.dev.evalJson("window.__qaOwnerLeaf?.detach(); delete window.__qaOwnerLeaf; delete window.__qaOwnerResult; true");
	}
});
