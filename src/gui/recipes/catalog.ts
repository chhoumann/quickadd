import { docsUrl } from "../../docs";
import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
import catalog from "./catalog.generated.json";

/** A docs example the plugin bundles, built by scripts/build-recipes.mjs. */
export interface Recipe {
	id: string;
	title: string;
	description: string;
	/** The example page's path on the docs site. */
	slug: string;
	/** What the recipe needs first, as fragments: "the Kanban community plugin". */
	requires: string[];
	/** What to do after adding it. */
	afterImport: string[];
	choices: { name: string; type: string }[];
	scripts: number;
	templates: number;
	package: QuickAddPackage;
}

export const RECIPES = catalog as unknown as Recipe[];

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function joinList(parts: string[]): string {
	return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "3 choices, 1 script, 2 templates", leaving out what it has none of. */
export function describeContents(recipe: Recipe): string {
	return [
		count(recipe.choices.length, "choice"),
		recipe.scripts > 0 ? count(recipe.scripts, "script") : "",
		recipe.templates > 0 ? count(recipe.templates, "template") : "",
	]
		.filter(Boolean)
		.join(", ");
}

/** "Needs the Kanban community plugin and a board with at least one lane". */
export function describeRequirements(recipe: Recipe): string {
	return recipe.requires.length > 0 ? `Needs ${joinList(recipe.requires)}` : "";
}

export function guideUrl(recipe: Recipe): string {
	return docsUrl(`${recipe.slug}/`);
}

/** The recipes whose title, description or choice names hold every word of `query`. */
export function filterRecipes(recipes: Recipe[], query: string): Recipe[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return recipes;
	return recipes.filter((recipe) => {
		const text = [recipe.title, recipe.description, ...recipe.choices.map((choice) => choice.name)]
			.join(" ")
			.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}
