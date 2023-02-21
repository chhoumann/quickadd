import QuickAdd from "src/main";
import { QuickAddSettings } from "src/quickAddSettingsTab";

export type Migration = {
	description: string;
	migrate: (plugin: QuickAdd) => Promise<void>;
};

export type Migrations = {
	[key in keyof QuickAddSettings["migrations"]]: Migration;
};
