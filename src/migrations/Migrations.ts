import QuickAdd from "src/main";
import { QuickAddSettings } from "src/quickAddSettingsTab";

export type Migration = {
	description: string;
	migrate: (plugin: QuickAdd) => Promise<boolean>;
};

export type Migrations = {
	[key in keyof QuickAddSettings["migrations"]]: Migration;
};
