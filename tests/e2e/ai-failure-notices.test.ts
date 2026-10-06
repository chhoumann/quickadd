import { beforeEach, expect, it } from "vitest";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// An AI request that fails shows one notice, the assistant's "AI request
// failed.", and dismissing one of its prompts shows none.
const getContext = createQuickAddE2EHarness("ai-failure-notices");

// Nothing listens on port 9, so the request fails at once without a network.
const LOCAL_PROVIDER = {
	id: "qa-e2e-local",
	name: "QA local",
	endpoint: "http://127.0.0.1:9/v1",
	apiKey: "",
	models: [{ name: "qa-model", maxTokens: 8000 }],
	autoSyncModels: false,
	modelSource: "providerApi",
};

function aiMacro(name: string, promptTemplate: { enable: boolean; name: string }) {
	return {
		id: `qa-e2e-${name}`,
		name,
		type: "Macro",
		command: false,
		onePageInput: "never",
		macro: {
			id: `qa-e2e-${name}-macro`,
			name,
			commands: [{
				id: `qa-e2e-${name}-ai`,
				name: "AI Assistant",
				type: "AIAssistant",
				model: "qa-model",
				modelRef: { providerId: LOCAL_PROVIDER.id, name: "qa-model" },
				systemPrompt: "",
				outputVariableName: "output",
				promptTemplate,
				modelParameters: {},
			}],
		},
	};
}

async function setUp(choices: unknown[]) {
	const { plugin } = getContext();
	await plugin.data<{
		choices: unknown[];
		disableOnlineFeatures: boolean;
		showInputCancellationNotification: boolean;
		ai: { providers: unknown[]; showAssistant: boolean };
	}>().patch(withStoredChoices((data) => {
		data.disableOnlineFeatures = false;
		// Opting in shows "Macro execution aborted: Input cancelled by user".
		data.showInputCancellationNotification = false;
		data.ai.showAssistant = true;
		data.ai.providers = [...data.ai.providers.filter((p) => (p as { id?: string }).id !== LOCAL_PROVIDER.id), LOCAL_PROVIDER];
		data.choices = choices;
	}));
	await plugin.reload({ waitUntilReady: true });
}

/** Notices shown from now on, with the text they end up with. */
async function watchNotices() {
	await getContext().obsidian.dev.evalJson(`(() => {
		window.__qaNotices = [];
		window.__qaNoticeObserver?.disconnect();
		window.__qaNoticeObserver = new MutationObserver(records => {
			for (const record of records) for (const node of record.addedNodes) {
				if (node instanceof HTMLElement && node.matches(".notice")) window.__qaNotices.push(node);
			}
		});
		window.__qaNoticeObserver.observe(document.body, { childList: true, subtree: true });
		return true;
	})()`);
}

const shownNotices = () => getContext().obsidian.dev.evalJson<string[]>(
	"window.__qaNotices.filter(n => n.isConnected).map(n => n.textContent)",
);

function runChoice(name: string) {
	return getContext().obsidian.dev.evalJson(`(() => {
		window.__qaAiRun = "pending";
		void app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(name)}).then(
			() => { window.__qaAiRun = "resolved"; },
			() => { window.__qaAiRun = "rejected"; },
		);
		return true;
	})()`);
}

async function settled() {
	const { obsidian } = getContext();
	await expect.poll(() => obsidian.dev.evalJson("window.__qaAiRun"), POLL_OPTS).not.toBe("pending");
	// Give any later notice from an outer layer time to appear.
	await new Promise((resolve) => setTimeout(resolve, 500));
}

beforeEach(async () => {
	await watchNotices();
});

it("shows one notice when an AI step's request fails", async () => {
	const { obsidian, sandbox } = getContext();
	const template = await seedVaultFile(obsidian, sandbox, "qa-ai-prompt.md", "Say hi");
	await setUp([aiMacro("AI failing step", { enable: true, name: template })]);
	try {
		await runChoice("AI failing step");
		await settled();
		const notices = await shownNotices();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/^AI request failed\./);
	} finally {
		await obsidian.dev.evalJson("window.__qaNoticeObserver?.disconnect(); delete window.__qaAiRun; true");
	}
});

it("shows no failure notice when the prompt template picker is dismissed", async () => {
	const { obsidian } = getContext();
	await setUp([aiMacro("AI cancelled step", { enable: false, name: "" })]);
	try {
		await runChoice("AI cancelled step");
		await waitForElement(obsidian, ".prompt .prompt-input");
		await pressKey(obsidian, "Escape");
		await settled();
		expect(await shownNotices()).toEqual([]);
	} finally {
		if (await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".prompt"))')) {
			await pressKey(obsidian, "Escape");
		}
		await obsidian.dev.evalJson("window.__qaNoticeObserver?.disconnect(); delete window.__qaAiRun; true");
	}
});

it("still hands the error to a script that catches it, under one notice", async () => {
	const { obsidian, sandbox } = getContext();
	const script = await seedVaultFile(obsidian, sandbox, "qa-ai-catch.js", `module.exports = async ({ quickAddApi }) => {
		try {
			await quickAddApi.ai.prompt("Say hi", "qa-model");
			window.__qaAiCaught = "no error";
		} catch (error) {
			window.__qaAiCaught = error instanceof Error ? error.message : String(error);
		}
	};`);
	await setUp([{
		id: "qa-e2e-ai-catch",
		name: "AI catching script",
		type: "Macro",
		command: false,
		onePageInput: "never",
		macro: {
			id: "qa-e2e-ai-catch-macro",
			name: "AI catching script",
			commands: [{ id: "qa-e2e-ai-catch-step", name: "catch", type: "UserScript", path: script, settings: {} }],
		},
	}]);
	try {
		await runChoice("AI catching script");
		await settled();
		expect(await obsidian.dev.evalJson<string>("window.__qaAiCaught")).toMatch(/^Error while making request to QA local/);
		expect(await obsidian.dev.evalJson("window.__qaAiRun")).toBe("resolved");
		const notices = await shownNotices();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/^AI request failed\./);
	} finally {
		await obsidian.dev.evalJson("window.__qaNoticeObserver?.disconnect(); delete window.__qaAiRun; delete window.__qaAiCaught; true");
	}
});

function scriptMacro(name: string, path: string) {
	return {
		id: `qa-e2e-${name}`,
		name,
		type: "Macro",
		command: false,
		onePageInput: "never",
		macro: {
			id: `qa-e2e-${name}-macro`,
			name,
			commands: [{ id: `qa-e2e-${name}-step`, name: "script", type: "UserScript", path, settings: {} }],
		},
	};
}

it("shows one notice when an agent's request fails", async () => {
	const { obsidian, sandbox } = getContext();
	const script = await seedVaultFile(obsidian, sandbox, "qa-agent-fail.js", `module.exports = async ({ quickAddApi }) => {
		await quickAddApi.ai.agent({ model: "qa-model" }).generate({ prompt: "Say hi" });
	};`);
	await setUp([scriptMacro("agent-failing", script)]);
	try {
		await runChoice("agent-failing");
		await settled();
		expect(await obsidian.dev.evalJson("window.__qaAiRun")).toBe("rejected");
		const notices = await shownNotices();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/^AI request failed\.\s+Error while making request to QA local/);
	} finally {
		await obsidian.dev.evalJson("window.__qaNoticeObserver?.disconnect(); delete window.__qaAiRun; true");
	}
});

it("still hands an agent's error to a script that catches it, under one notice", async () => {
	const { obsidian, sandbox } = getContext();
	const script = await seedVaultFile(obsidian, sandbox, "qa-agent-catch.js", `module.exports = async ({ quickAddApi }) => {
		try {
			await quickAddApi.ai.agent({ model: "qa-model" }).generate({ prompt: "Say hi" });
			window.__qaAiCaught = "no error";
		} catch (error) {
			window.__qaAiCaught = error instanceof Error ? error.message : String(error);
		}
	};`);
	await setUp([scriptMacro("agent-catching", script)]);
	try {
		await runChoice("agent-catching");
		await settled();
		expect(await obsidian.dev.evalJson<string>("window.__qaAiCaught")).toMatch(/^Error while making request to QA local/);
		expect(await obsidian.dev.evalJson("window.__qaAiRun")).toBe("resolved");
		const notices = await shownNotices();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/^AI request failed\./);
	} finally {
		await obsidian.dev.evalJson("window.__qaNoticeObserver?.disconnect(); delete window.__qaAiRun; delete window.__qaAiCaught; true");
	}
});
