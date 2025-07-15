import type QuickAdd from "src/main";
import type { QuickAddSettings } from "src/quickAddSettingsTab";

export type Migration = {
	description: string;
	migrate: (plugin: QuickAdd) => Promise<void>;
};

export type Migrations = {
	[key in keyof Omit<QuickAddSettings["migrations"], "migrateToMacroIDFromEmbeddedMacro">]: Migration;
};
