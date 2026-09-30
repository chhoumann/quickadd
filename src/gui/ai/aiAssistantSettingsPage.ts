import type {
	App,
	Setting,
	SettingDefinitionList,
	SettingDefinitionPage,
	SettingDefinitionGroup,
} from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { settingsStore } from "src/settingsStore";
import type { SettingsKey } from "../components/settingsDefinitions";
import { confirmAction } from "../confirmAction";
import { populateModelDropdown } from "../modelSelect";
import { ProviderPickerModal } from "../ProviderPickerModal";
import { AIProviderSettingPage } from "./AIProviderSettingPage";
import {
	providerEntryNames,
	removeProvider,
	storedProviders,
	updateAISettings,
} from "./aiSettingsState";
import { mountSystemPromptLiteralNote } from "./systemPromptLiteralNote";

/** The page's name: its entry label, title, and navigation path segment. */
export const AI_ASSISTANT_PAGE_NAME = "AI Assistant";

/** "No providers", "1 provider", "2 providers". */
function describeProviderCount(count: number): string {
	if (count === 0) return "No providers";
	return `${count} provider${count === 1 ? "" : "s"}`;
}

function retiredCount(providerId: string | undefined): number {
	const provider = storedProviders().find((p) => p.id === providerId);
	return provider?.models.filter((model) => model.deprecated).length ?? 0;
}

/**
 * The parts of the AI settings that the definitions are built from, as a
 * string that changes exactly when they need rebuilding: a provider added,
 * removed, renamed, or moved to another endpoint. Only the user does that.
 * Background syncs change models, which the entries read live when they
 * render, so a sync never rebuilds (and re-renders) the page under the user.
 */
export function aiPageSignature(providers: readonly AIProvider[]): string {
	return JSON.stringify(providers.map((p) => [p.id, p.name, p.endpoint]));
}

/**
 * Settings → QuickAdd → AI Assistant. Replaces the old modal stack (AI
 * Assistant settings → Edit providers → provider editor). Built from the
 * store's current state; the settings tab calls `update()` when
 * `aiPageSignature` changes, which rebuilds it.
 */
export function createAIAssistantPage(app: App): SettingDefinitionPage<SettingsKey> {
	return {
		type: "page",
		name: AI_ASSISTANT_PAGE_NAME,
		desc: "Providers, models, and defaults for AI commands.",
		displayValue: () => describeProviderCount(storedProviders().length),
		visible: () => !settingsStore.getState().disableOnlineFeatures,
		items: [createProvidersList(app), createDefaultsGroup()],
	};
}

function createProvidersList(app: App): SettingDefinitionList<SettingsKey> {
	const providers = storedProviders();
	const names = providerEntryNames(providers);

	return {
		type: "list",
		heading: "Providers",
		emptyState: "No providers yet. Add one to use AI commands.",
		addItem: { name: "Add provider", action: () => void addProvider(app) },
		onDelete: (index) => void confirmRemoveProvider(app, providers[index]),
		items: providers.map((provider, index) => ({
			type: "page",
			name: names[index],
			desc: provider.endpoint,
			// Evaluated on every render, so returning from the provider's page
			// shows what a cleanup or sync did there.
			displayValue: () => {
				const retired = retiredCount(provider.id);
				return retired ? `${retired} retired` : "";
			},
			status: () => (retiredCount(provider.id) ? "warning" : null),
			page: () => new AIProviderSettingPage(app, provider.id ?? ""),
		})),
	};
}

async function addProvider(app: App): Promise<void> {
	// The picker appends to the array it is given; hand it a copy and add
	// whatever it appended, so nothing else in the store is touched.
	const draft = [...storedProviders()];
	const before = draft.length;
	await new ProviderPickerModal(app, draft).waitForClose;
	const added = draft.slice(before);
	if (added.length === 0) return;
	settingsStore.setState((state) => ({
		ai: { ...state.ai, providers: [...storedProviders(state), ...added] },
	}));
}

async function confirmRemoveProvider(
	app: App,
	provider: AIProvider | undefined,
): Promise<void> {
	if (!provider?.id) return;
	const confirmed = await confirmAction(app, {
		title: `Delete ${provider.name.trim() || "this provider"}?`,
		message: "Commands that use its models will need another model.",
		action: "Delete",
	});
	if (confirmed) removeProvider(provider.id);
}

function createDefaultsGroup(): SettingDefinitionGroup<SettingsKey> {
	return {
		type: "group",
		heading: "Defaults",
		items: [
			{
				name: "Default model",
				desc: "The model new AI commands start with. “Ask me” prompts you to choose a model each run.",
				// Settings search matches names and aliases, not the Providers
				// heading; this lands searches for providers on this page.
				aliases: ["AI provider", "provider", "API key", "LLM"],
				render: (setting) => renderDefaultModel(setting),
			},
			{
				name: "Prompt template folder",
				desc: "The folder QuickAdd reads prompt templates from.",
				control: {
					type: "folder",
					key: "ai.promptTemplatesFolderPath",
					placeholder: "prompts/",
				},
			},
			{
				name: "Show assistant",
				desc: "Show progress notices while the AI Assistant works.",
				control: { type: "toggle", key: "ai.showAssistant" },
			},
			{
				name: "Confirm AI tool calls",
				desc: "When an AI agent runs script-defined or built-in tools, ask before executing. A tool that requires approval is always confirmed.",
				control: {
					type: "dropdown",
					key: "ai.confirmToolCalls",
					defaultValue: "destructive",
					options: {
						destructive: "Destructive tools only (recommended)",
						always: "Always confirm every tool",
						never: "Never (use each tool's own setting)",
					},
				},
			},
			{
				name: "Default system prompt",
				desc: "The system prompt new AI commands start with.",
				render: (setting) => renderDefaultSystemPrompt(setting),
			},
		],
	};
}

function renderDefaultModel(setting: Setting): () => void {
	let unsubscribe = (): void => {};
	setting.addDropdown((dropdown) => {
		const populate = (): void => {
			const ai = settingsStore.getState().ai;
			dropdown.selectEl.empty();
			populateModelDropdown(
				dropdown,
				{ model: ai.defaultModel, modelRef: ai.defaultModelRef },
				(selection) =>
					updateAISettings({
						defaultModel: selection.model,
						defaultModelRef: selection.modelRef,
					}),
			);
		};
		populate();
		// A provider page's auto-sync often lands after the user came back
		// here; list the models it found without rebuilding the page.
		let providers = storedProviders();
		unsubscribe = settingsStore.subscribe((state) => {
			const next = storedProviders(state);
			if (next === providers) return;
			providers = next;
			populate();
		});
	});
	return () => unsubscribe();
}

function renderDefaultSystemPrompt(setting: Setting): void {
	setting.settingEl.addClass("qa-ai-system-prompt-setting");
	const value = settingsStore.getState().ai.defaultSystemPrompt ?? "";
	setting.addTextArea((textArea) => {
		textArea.inputEl.addClass("qa-ai-system-prompt-input");
		textArea.inputEl.setAttribute("aria-label", "Default system prompt");
		// No format preview or `{{` autocomplete: the system prompt is sent
		// verbatim (see mountSystemPromptLiteralNote).
		const updateLiteralNote = mountSystemPromptLiteralNote(
			setting.controlEl,
			textArea.inputEl,
			value,
		);
		textArea.setValue(value).onChange((next) => {
			updateAISettings({ defaultSystemPrompt: next });
			updateLiteralNote(next);
		});
	});
}
