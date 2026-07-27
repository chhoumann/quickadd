import type IChoice from "./IChoice";

export default interface IMultiChoice extends IChoice {
	/**
	 * Optional because `data.json` is untrusted input and this field is where it
	 * lies most often: a hand-edit, an imported package or a partial write can
	 * leave it missing entirely (#1566). `strictNullChecks` is on and CI runs
	 * `svelte-check`, so declaring the truth here turns every unguarded
	 * `folder.choices.map(...)` — in .ts AND .svelte — into a compile error, which
	 * is what stops the next reader from re-introducing the bug.
	 *
	 * Read it through `childChoicesOf()` (src/utils/choiceUtils.ts), which also
	 * covers the shape the type system can't express: a non-array value such as
	 * `{}`, which `?? []` and truthy guards both wave through.
	 */
	choices?: IChoice[];
	collapsed: boolean;
	placeholder?: string;
}
