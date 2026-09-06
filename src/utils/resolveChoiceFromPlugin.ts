import type QuickAdd from "src/main";
import type IChoice from "src/types/choices/IChoice";

export function resolveChoiceFromPlugin(plugin: Pick<QuickAdd, "getChoiceById">, id: string): IChoice | null {
	try {
		return plugin.getChoiceById(id);
	} catch {
		return null;
	}
}
