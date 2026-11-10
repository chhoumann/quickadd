import consolidateFileExistsBehavior from "./consolidateFileExistsBehavior";
import type { Migration } from "./Migrations";

const retireLeaveUnchangedKeepMode: Migration = {
	description:
		"Move Template choices off the leaveUnchanged keep mode to the mode with the same behavior",
	migrate: consolidateFileExistsBehavior.migrate,
};

export default retireLeaveUnchangedKeepMode;
