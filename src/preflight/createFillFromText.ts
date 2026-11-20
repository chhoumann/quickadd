import { TFile, type App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type QuickAdd from "src/main";
import { Agent } from "src/ai/tools/Agent";
import { settingsStore } from "src/settingsStore";
import type IChoice from "src/types/choices/IChoice";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { buildFillSchema, fillableFields, type FillFromText } from "./fillFromText";

const MAX_CONTEXT_CHARS = 4000;

/**
 * Where the answers end up (the Capture format, or the Template's file name and
 * body), so the model sees `#{{VALUE:project}}` and answers with a tag-safe word.
 */
async function destinationContext(app: App, choice: IChoice): Promise<string> {
	if (choice.type === "Capture") {
		const capture = choice as ICaptureChoice;
		return capture.format?.enabled ? capture.format.format : "";
	}
	if (choice.type === "Template") {
		const template = choice as ITemplateChoice;
		const path = /\.\w+$/.test(template.templatePath) ? template.templatePath : `${template.templatePath}.md`;
		const file = app.vault.getAbstractFileByPath(path);
		const body = file instanceof TFile ? await app.vault.cachedRead(file) : "";
		const name = template.fileNameFormat?.enabled ? `File name: ${template.fileNameFormat.format}\n` : "";
		return `${name}${body}`;
	}
	return "";
}

/**
 * A form filler backed by the AI Assistant's default model, or undefined when AI
 * is off or no default model is set (the form then shows no fill action).
 */
export function createFillFromText(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: IChoice,
): FillFromText | undefined {
	const settings = settingsStore.getState();
	if (settings.disableOnlineFeatures) return undefined;
	const { defaultModel, defaultModelRef } = settings.ai;
	if (!defaultModel || defaultModel === "Ask me") return undefined;
	const model = defaultModelRef
		? { name: defaultModelRef.name, provider: defaultModelRef.providerId }
		: defaultModel;

	return async (text, fields) => {
		const targets = fillableFields(fields);
		if (targets.length === 0) return {};
		const context = (await destinationContext(app, choice)).slice(0, MAX_CONTEXT_CHARS);
		const agent = new Agent(app, plugin, choiceExecutor, { model });
		// Everything variable goes in the system message: Agent runs `prompt` through
		// QuickAdd's formatter, which would expand the destination's {{VALUE:...}}
		// placeholders (opening prompts) and any tokens in the clipboard text.
		const result = await agent.generate({
			system:
				"You fill in a form from the user's text. Each field is a {{VALUE:<field>}} " +
				"placeholder in the destination shown, so answer in the shape that spot needs " +
				"(a tag has no spaces, a list item is one line). Use only what the text says. " +
				"Use an empty string for a field the text does not cover. Do not invent values.\n\n" +
				`Form: ${choice.name}\nToday: ${window.moment().format("YYYY-MM-DD dddd")}\n\n` +
				(context ? `Destination:\n"""\n${context}\n"""\n\n` : "") +
				`Text:\n"""\n${text}\n"""`,
			prompt: "Fill in the form from the text.",
			schema: buildFillSchema(targets),
		});
		const values: Record<string, string> = {};
		const object = result.object as Record<string, unknown> | undefined;
		for (const field of targets) {
			const value = object?.[field.id];
			if (typeof value === "string" && value.trim()) values[field.id] = value.trim();
		}
		return values;
	};
}
