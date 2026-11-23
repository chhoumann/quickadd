import type IChoice from "../types/choices/IChoice";
import { hasUnreadableChildren } from "./choiceUtils";

/**
 * What the user is told when "QuickAdd: Run" has nothing to run. Mirrors the
 * shape of the plugin's other "this surface has nothing to offer" notices
 * (runTemplateFromFolder's missing-template-folder notice), which name the exact
 * settings path rather than leaving the user to find it.
 */
export const NO_CHOICES_NOTICE =
	"QuickAdd: No choices yet. Create your first one in Settings → QuickAdd.";

/**
 * Shared wording for "you opened a folder that has nothing in it", so the
 * picker's drill-down and the command/URI execute path (choiceExecutor) say the
 * same thing.
 */
export function emptyFolderNoticeText(folder: IChoice): string {
	// A folder whose `choices` value could still be holding choices is not empty
	// but unreadable; saying "empty" would contradict the settings list.
	if (hasUnreadableChildren(folder)) {
		return `QuickAdd couldn't read the contents of "${folder.name}". They're still in data.json.`;
	}
	return `Folder "${folder.name}" is empty.`;
}
