import type { ChoiceLookup } from "src/types/pluginContext";
import type IChoice from "src/types/choices/IChoice";

export function resolveChoiceFromPlugin(plugin: Pick<ChoiceLookup, "getChoiceById">, id: string): IChoice | null {
	try {
		return plugin.getChoiceById(id);
	} catch {
		return null;
	}
}
