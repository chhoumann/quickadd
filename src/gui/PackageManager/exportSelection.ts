import type IChoice from "../../types/choices/IChoice";
import type { FlatChoicePathEntry } from "../../utils/choiceUtils";
import { collectChoiceClosure, collectScriptDependencies, collectFileDependencies } from "../../utils/packageTraversal";

type FlatChoice = FlatChoicePathEntry;

interface Summary {
	rootCount: number;
	totalChoices: number;
	dependencyCount: number;
	missingChoiceIds: string[];
	userScripts: number;
	conditionalScripts: number;
	templateFiles: number;
	captureTemplates: number;
}

export function filterFlatChoices(list: FlatChoice[], query: string): FlatChoice[] {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return list;

	return list.filter((entry) => {
		const composite = `${entry.path.join(" ")} ${entry.choice.type}`.toLowerCase();
		return composite.includes(trimmed);
	});
}

export function computeRootSelections(
	flat: FlatChoice[],
	selected: Set<string>,
): string[] {
	const roots: string[] = [];
	for (const entry of flat) {
		if (!selected.has(entry.id)) continue;
		if (!entry.parentId || !selected.has(entry.parentId)) {
			roots.push(entry.id);
		}
	}
	return roots;
}

export function computeSummary(
	all: IChoice[],
	roots: readonly string[],
	excluded: ReadonlySet<string>,
): Summary {
	if (roots.length === 0) {
		return {
			rootCount: 0,
			totalChoices: 0,
			dependencyCount: 0,
			missingChoiceIds: [],
			userScripts: 0,
			conditionalScripts: 0,
			templateFiles: 0,
			captureTemplates: 0,
		};
	}

	const closure = collectChoiceClosure(all, roots, {
		excludedChoiceIds: excluded,
	});
	const scripts = collectScriptDependencies(closure.catalog, closure.choiceIds);
	const files = collectFileDependencies(closure.catalog, closure.choiceIds);

	return {
		rootCount: roots.length,
		totalChoices: closure.choiceIds.length,
		dependencyCount: Math.max(closure.choiceIds.length - roots.length, 0),
		missingChoiceIds: closure.missingChoiceIds,
		userScripts: scripts.userScriptPaths.size,
		conditionalScripts: scripts.conditionalScriptPaths.size,
		templateFiles: files.templatePaths.size,
		captureTemplates: files.captureTemplatePaths.size,
	};
}

