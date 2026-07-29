import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { Migration, MigrationResult } from "./Migrations";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import {
	coerceLegacyOpenFileInNewTab,
	createFileOpeningFromLegacy,
} from "./helpers/file-opening-legacy";
import {
	settingsTreeHasUnreadableData,
	walkAllChoices,
} from "./helpers/choice-traversal";
import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../utils/fileOpeningDefaults";

const backfillFileOpeningDefaults: Migration = {
	description: "Backfill missing file opening defaults for older choices",
	migrate: async (plugin: QuickAdd): Promise<MigrationResult | void> => {
		log.logMessage("Starting file opening defaults backfill...");

		// Both halves of this migration MOVE data: they translate the legacy
		// `openFileInNewTab` / `openFileInMode` keys into `fileOpening`, and nothing
		// at runtime reads the legacy keys. A choice hidden behind a container this
		// walk could not read would therefore lose its "open in new tab" preference
		// permanently once the migration is flagged complete, even after the user
		// repairs data.json. Stay pending instead (#1610).
		//
		// A MISSING `fileOpening`, by contrast, needs no guard at all: the engines
		// call `normalizeFileOpening(this.choice.fileOpening)` on every run, so the
		// defaults half is fully compensated at runtime.
		//
		// This migration does NOT call saveSettings() itself: migrate.ts re-syncs the
		// store and saves once after the whole run. A per-migration write would be a
		// full data.json rewrite, and once this can stay PENDING that is one on every
		// launch, straight into Obsidian Sync's whole-file last-write-wins.
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
			const legacyChoice = templateOrCaptureChoice as
				| (ITemplateChoice | ICaptureChoice) & {
						openFileInNewTab?: unknown;
						openFileInMode?: unknown;
				  };
			const legacyTabRaw = legacyChoice.openFileInNewTab;
			const legacyMode = legacyChoice.openFileInMode;
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

		if (unreadable) return { complete: false };
	},
};

export default backfillFileOpeningDefaults;
