import { log } from "../logger/logManager";
import type { MigrationContext } from "../types/pluginContext";
import type { Migration, MigrationResult } from "./Migrations";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { fileOpeningFromLegacyFields } from "./helpers/file-opening-legacy";
import {
	settingsTreeHasUnreadableData,
	walkChoicesInSettings,
} from "../utils/choiceTraversal";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import type { FileOpeningSettings } from "../types/fileOpening";

const backfillFileOpeningDefaults: Migration = {
	description: "Backfill missing file opening defaults for older choices",
	migrate: async (plugin: MigrationContext): Promise<MigrationResult | void> => {
		log.logMessage("Starting file opening defaults backfill...");

		// Legacy fields are not read at runtime, so skipped subtrees must retry.
		// The migration runner saves once after the complete batch.
		const unreadable = settingsTreeHasUnreadableData(plugin.settings);

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
			const needsDefaults =
				!fileOpening ||
				fileOpening.location == null ||
				fileOpening.direction == null ||
				fileOpening.mode == null ||
				fileOpening.focus == null;

			if (!needsDefaults) return;

			const fromLegacy = fileOpening
				? null
				: fileOpeningFromLegacyFields(
						templateOrCaptureChoice as { openFileInNewTab?: unknown; openFileInMode?: unknown },
					);
			templateOrCaptureChoice.fileOpening = fromLegacy ?? normalizeFileOpening(fileOpening);
			migratedCount++;
		};

		walkChoicesInSettings(plugin.settings, backfillFileOpening);

		log.logMessage(
			`File opening defaults backfill complete. Updated ${migratedCount} choice(s).`,
		);

		if (unreadable) return { complete: false };
	},
};

export default backfillFileOpeningDefaults;
