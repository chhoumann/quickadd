import type { CaptureChoice } from "src/types/choices/CaptureChoice";
import type IChoice from "src/types/choices/IChoice";
import { isChoiceLike } from "src/utils/choiceUtils";

export function isCaptureChoice(choice: IChoice): choice is CaptureChoice {
	// Null-tolerant: a choice list from data.json can contain a hole (`null`, a
	// stray primitive) from a bad hand-edit or a truncated write, and a migration
	// that throws on one reverts and re-fails on every launch forever (#1566).
	return isChoiceLike(choice) && choice.type === "Capture";
}
