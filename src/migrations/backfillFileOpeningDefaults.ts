import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { Migration } from "./Migrations";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import {
	coerceLegacyOpenFileInNewTab,
	createFileOpeningFromLegacy,
} from "./helpers/file-opening-legacy";
import { walkAllChoices } from "./helpers/choice-traversal";
import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../utils/fileOpeningDefaults";

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
			const legacyTab = coerceLegacyOpenFileInNewTab(legacyTabRaw);

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

		walkAllChoices(plugin, backfillFileOpening);

		log.logMessage(
			`File opening defaults backfill complete. Updated ${migratedCount} choice(s).`,
		);

		await plugin.saveSettings();
	},
};

export default backfillFileOpeningDefaults;
