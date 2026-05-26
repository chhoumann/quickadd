import consolidateFileExistsBehavior from "./consolidateFileExistsBehavior";
import type { Migration } from "./Migrations";

const repairTemplateFileExistsBehavior: Migration = {
	description:
		"Repair template file collision settings that may have been left in legacy format",
	migrate: consolidateFileExistsBehavior.migrate,
};

export default repairTemplateFileExistsBehavior;
