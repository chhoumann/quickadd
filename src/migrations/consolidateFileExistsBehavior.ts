import type QuickAdd from "src/main";
import { deepClone } from "src/utils/deepClone";
import {
	isTemplateChoice,
	normalizeTemplateChoice,
} from "./helpers/normalizeTemplateFileExistsBehavior";
import { walkAllChoices } from "./helpers/choice-traversal";
import type { Migration } from "./Migrations";

const consolidateFileExistsBehavior: Migration = {
	description:
		"Re-run template file collision normalization for users with older migration state",

	migrate: async (plugin: QuickAdd): Promise<void> => {
		plugin.settings.choices = deepClone(plugin.settings.choices);
		(plugin.settings as any).macros = deepClone(
			(plugin.settings as any).macros || [],
		);

		walkAllChoices(plugin, (choice) => {
			if (isTemplateChoice(choice)) {
				normalizeTemplateChoice(choice);
			}
		});
	},
};

export default consolidateFileExistsBehavior;
