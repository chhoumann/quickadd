import type IChoice from "./IChoice";

export default interface IMultiChoice extends IChoice {
	/**
	 * Optional because `data.json` is untrusted and this field is often missing
	 * after a hand-edit, an imported package or a partial write, so an unguarded
	 * `folder.choices.map(...)` is a compile error. Read it through
	 * `childChoicesOf()` (src/utils/choiceUtils.ts), which also covers a non-array
	 * value such as `{}` that `?? []` and truthy guards wave through.
	 */
	choices?: IChoice[];
	collapsed: boolean;
	placeholder?: string;
}
