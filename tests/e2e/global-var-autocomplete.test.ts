import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { insertText, POLL_OPTS, pressKey } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("global-var-autocomplete");

const FORMAT_INPUTS = JSON.stringify('.captureChoiceBuilder .qa-field textarea');

async function visibleSuggestions(): Promise<string[]> {
	return getContext().obsidian.dev.evalJson<string[]>(`(() =>
		[...document.querySelectorAll(".suggestion-container .qa-format-suggestion-token")]
			.filter(el => el.getClientRects().length > 0)
			.map(el => el.textContent ?? "")
	)()`);
}

async function formatState() {
	return getContext().obsidian.dev.evalJson<{ value: string; caret: number }>(`(() => {
		const input = [...document.querySelectorAll(${FORMAT_INPUTS})]
			.filter(el => el.getClientRects().length > 0).at(-1);
		return { value: input.value, caret: input.selectionStart };
	})()`);
}

/** Types at the caret the way a keyboard does: one CDP insertText per key. */
async function type(text: string) {
	for (const char of text) {
		await insertText(getContext().obsidian, char);
	}
}

it("keeps offering defined global variables after the colon in a choice format field", async () => {
	const { obsidian, plugin } = getContext();
	const choice = new CaptureChoice("Global var autocomplete");
	// Builder autosave can outlive the harness's data restore, so never rely on
	// the name alone to find this run's choice.
	choice.name = `Global var autocomplete ${choice.id}`;
	choice.format = { enabled: true, format: "" };
	await plugin.data<{ choices: IChoice[]; globalVariables: Record<string, string> }>().patch((data) => {
		data.choices.push(choice);
		data.globalVariables = {
			Signature: "Logged by QuickAdd",
			MyProjects: "{{VALUE:Inbox,Work}}",
		};
	});
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
	try {
		const configure = JSON.stringify(`[aria-label="Configure ${choice.name}"]`);
		await expect.poll(() => obsidian.dev.evalJson(`(() => {
			const button = [...document.querySelectorAll(${configure})].find(b => b.getClientRects().length > 0);
			button?.click();
			return Boolean(button);
		})()`), POLL_OPTS).toBe(true);
		await expect.poll(() => obsidian.dev.evalJson(`(() => {
			const input = [...document.querySelectorAll(${FORMAT_INPUTS})]
				.filter(el => el.getClientRects().length > 0).at(-1);
			if (!input) return false;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
			return document.activeElement === input;
		})()`), POLL_OPTS).toBe(true);

		const all = ["{{GLOBAL_VAR:}}", "{{GLOBAL_VAR:Signature}}", "{{GLOBAL_VAR:MyProjects}}"];
		await type("{{GLOBAL_VAR");
		await expect.poll(visibleSuggestions, POLL_OPTS).toEqual(all);

		// The reported bug: the colon emptied the list and later letters never restored it.
		await type(":");
		await expect.poll(visibleSuggestions, POLL_OPTS).toEqual(all.slice(1));
		await type("s");
		await expect.poll(visibleSuggestions, POLL_OPTS).toEqual(["{{GLOBAL_VAR:Signature}}"]);
		await pressKey(obsidian, "Enter");
		await expect.poll(formatState, POLL_OPTS).toEqual({
			value: "{{GLOBAL_VAR:Signature}}",
			caret: "{{GLOBAL_VAR:Signature}}".length,
		});

		// Accept the empty {{GLOBAL_VAR:}} row, then name the variable between
		// the braces it already wrote: the completion must not double them.
		await type(" {{glob");
		await expect.poll(visibleSuggestions, POLL_OPTS).toEqual(all);
		await pressKey(obsidian, "Enter");
		await type("My");
		await expect.poll(visibleSuggestions, POLL_OPTS).toEqual(["{{GLOBAL_VAR:MyProjects}}"]);
		await pressKey(obsidian, "Enter");
		const expected = "{{GLOBAL_VAR:Signature}} {{GLOBAL_VAR:MyProjects}}";
		await expect.poll(formatState, POLL_OPTS).toEqual({ value: expected, caret: expected.length });

		// No defined variable matches: the list closes instead of offering noise.
		await type(" {{GLOBAL_VAR:Nope");
		await expect.poll(visibleSuggestions, POLL_OPTS).toEqual([]);
	} finally {
		await obsidian.dev.evalJson(`(() => {
			app.setting?.close?.();
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson(`(() =>
			[...document.querySelectorAll(".captureChoiceBuilder")]
				.filter(builder => builder.getClientRects().length > 0).length
		)()`), POLL_OPTS).toBe(0);
	}
});
