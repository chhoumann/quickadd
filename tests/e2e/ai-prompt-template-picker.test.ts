import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";
import { expectNoPrompt, POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("ai-prompt-template-picker");

it("labels the AI Assistant's prompt template picker", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<{ choices: unknown[]; disableOnlineFeatures: boolean }>().patch((data) => {
		data.disableOnlineFeatures = false;
		data.choices = [{
			id: "qa-e2e-ai-picker",
			name: "AI picker macro",
			type: "Macro",
			command: false,
			onePageInput: "never",
			macro: {
				id: "qa-e2e-ai-picker-macro",
				name: "AI picker macro",
				commands: [{
					id: "qa-e2e-ai-step",
					name: "AI Assistant",
					type: "AIAssistant",
					model: "gpt-6-sol",
					systemPrompt: "",
					outputVariableName: "output",
					promptTemplate: { enable: false, name: "" },
					modelParameters: {},
				}],
			},
		}];
	});
	await plugin.reload({ waitUntilReady: true });
	try {
		await obsidian.dev.evalJson(`(() => {
			window.__qaAiPicker = "pending";
			void app.plugins.plugins.quickadd.api.executeChoice("AI picker macro").then(
				() => { window.__qaAiPicker = "resolved"; },
				() => { window.__qaAiPicker = "rejected"; },
			);
			return true;
		})()`);
		await waitForElement(obsidian, ".prompt .prompt-input");
		expect(await obsidian.dev.evalJson<string>(
			`document.querySelector(".prompt .prompt-input").placeholder`,
		)).toBe("Select a prompt template");
		await pressKey(obsidian, "Escape");
		await expectNoPrompt(obsidian);
		await expect.poll(() => obsidian.dev.evalJson("window.__qaAiPicker"), POLL_OPTS).not.toBe("pending");
	} finally {
		if (await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".prompt"))')) {
			await pressKey(obsidian, "Escape");
		}
		await obsidian.dev.evalJson("delete window.__qaAiPicker; true");
	}
});
