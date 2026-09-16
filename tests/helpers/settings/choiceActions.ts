import { vi } from "vitest";
import type { ChoiceListActions } from "../../../src/gui/choiceList/choiceListActions";

export function actionsSpy(): ChoiceListActions {
	return {
		onDeleteChoice: vi.fn(),
		onConfigureChoice: vi.fn(),
		onToggleCommand: vi.fn(),
		onDuplicateChoice: vi.fn(),
		onRenameChoice: vi.fn(),
		onMoveChoice: vi.fn(),
		onReorderChoices: vi.fn(),
		onAddChoice: vi.fn(),
		onToggleCollapsed: vi.fn(),
		onCommitFolder: vi.fn(),
	};
}
