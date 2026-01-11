import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { Migration } from "./Migrations";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { MultiChoice } from "../types/choices/MultiChoice";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import { CommandType } from "../types/macros/CommandType";
import type { ICommand } from "../types/macros/ICommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../utils/fileOpeningDefaults";

function isMultiChoice(choice: IChoice): choice is MultiChoice {
	return choice.type === "Multi";
}

function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

function walkChoice(
	choice: IChoice,
	visitor: (c: IChoice) => void,
	visited: Set<IChoice>,
): void {
	if (!choice || typeof choice !== "object") return;
	if (visited.has(choice)) return;

	visited.add(choice);
	visitor(choice);

	if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			walkChoice(child, visitor, visited);
		}
	}

	if (isMacroChoice(choice)) {
		walkCommands(choice.macro?.commands, visitor, visited);
	}
}

function walkCommands(
	commands: ICommand[] | undefined,
	visitor: (c: IChoice) => void,
	visited: Set<IChoice>,
): void {
	if (!Array.isArray(commands)) return;

	for (const command of commands) {
		if (!command || typeof command !== "object") continue;

		const conditional = command as IConditionalCommand;
		const isConditional =
			command.type === CommandType.Conditional ||
			Array.isArray(conditional.thenCommands) ||
			Array.isArray(conditional.elseCommands);

		if (isConditional) {
			walkCommands(conditional.thenCommands, visitor, visited);
			walkCommands(conditional.elseCommands, visitor, visited);
		}

		const nested = command as INestedChoiceCommand;
		const nestedChoice =
			command.type === CommandType.NestedChoice
				? nested.choice
				: nested.choice && typeof nested.choice === "object"
					? nested.choice
					: undefined;

		if (nestedChoice) {
			walkChoice(nestedChoice, visitor, visited);
		}
	}
}

function createFileOpeningFromLegacy(
	legacyTab: { enabled?: boolean; direction?: string; focus?: boolean },
	legacyMode: unknown,
): FileOpeningSettings {
	const direction =
		legacyTab.direction === "horizontal" ? "horizontal" : "vertical";
	const mode =
		typeof legacyMode === "string" && legacyMode !== "default"
			? (legacyMode as FileOpeningSettings["mode"])
			: "default";

	return normalizeFileOpening({
		location: legacyTab.enabled ? "split" : "tab",
		direction,
		focus: legacyTab.focus ?? true,
		mode,
	});
}

function migrateAllChoices(plugin: QuickAdd, visitor: (c: IChoice) => void) {
	const visited = new Set<IChoice>();

	for (const choice of plugin.settings.choices) {
		walkChoice(choice, visitor, visited);
	}

	const legacyMacros = (plugin.settings as any).macros;
	if (Array.isArray(legacyMacros)) {
		for (const macro of legacyMacros) {
			walkCommands(macro?.commands, visitor, visited);
		}
	}
}

const backfillFileOpeningDefaults: Migration = {
	description: "Backfill missing file opening defaults for older choices",
	migrate: async (plugin: QuickAdd) => {
		log.logMessage("Starting file opening defaults backfill...");

		let migratedCount = 0;

		const backfillFileOpening = (choice: IChoice) => {
			if (choice.type !== "Template" && choice.type !== "Capture") return;

			const templateOrCaptureChoice = choice as
				| ITemplateChoice
				| ICaptureChoice;
			const fileOpening =
				typeof templateOrCaptureChoice.fileOpening === "object" &&
					templateOrCaptureChoice.fileOpening !== null
					? (templateOrCaptureChoice.fileOpening as Partial<FileOpeningSettings>)
					: undefined;
			const legacyTabRaw = (templateOrCaptureChoice as any).openFileInNewTab;
			const legacyMode = (templateOrCaptureChoice as any).openFileInMode;
			const legacyTab =
				legacyTabRaw && typeof legacyTabRaw === "object"
					? (legacyTabRaw as {
							enabled?: boolean;
							direction?: string;
							focus?: boolean;
						})
					: typeof legacyTabRaw === "boolean"
						? { enabled: legacyTabRaw }
						: undefined;

			const needsDefaults =
				!fileOpening ||
				fileOpening.location == null ||
				fileOpening.direction == null ||
				fileOpening.mode == null ||
				fileOpening.focus == null;

			if (!needsDefaults) return;

			if (!fileOpening && legacyTab) {
				templateOrCaptureChoice.fileOpening = createFileOpeningFromLegacy(
					legacyTab,
					legacyMode,
				);
			} else {
				templateOrCaptureChoice.fileOpening = normalizeFileOpening(fileOpening);
			}
			migratedCount++;
		};

		migrateAllChoices(plugin, backfillFileOpening);

		log.logMessage(
			`File opening defaults backfill complete. Updated ${migratedCount} choice(s).`,
		);

		await plugin.saveSettings();
	},
};

export default backfillFileOpeningDefaults;
