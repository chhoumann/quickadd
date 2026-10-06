import type IChoice from "../../types/choices/IChoice";
import { flattenChoices } from "../../utils/choiceUtils";

/**
 * `base`, disambiguated from every name in the tree by appending " 2", " 3", ...
 * so a freshly added choice stays distinguishable in the list and drag pill
 * (#1318). The add flow never asks for a name first; the builder and rename
 * edit it afterwards.
 */
export function uniqueChoiceName(base: string, existing: IChoice[]): string {
	const names = new Set(flattenChoices(existing).map((c) => c.name));
	if (!names.has(base)) return base;
	let i = 2;
	while (names.has(`${base} ${i}`)) i++;
	return `${base} ${i}`;
}
