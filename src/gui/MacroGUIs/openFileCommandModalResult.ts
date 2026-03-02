import type { DraftSession } from "../../state/createDraftSession";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";

export type OpenFileCommandModalAction = "save" | "cancel" | "dismiss";

export function resolveOpenFileCommandModalResult(
	action: OpenFileCommandModalAction,
	session: DraftSession<IOpenFileCommand>,
): IOpenFileCommand | null {
	if (action === "save") {
		return session.commit();
	}

	session.discard();
	return null;
}
