import {
	findYamlFrontMatterRange,
	getYamlContextForMatch,
} from "./yamlContext";

type CollectArgs = {
	input: string;
	matchStart: number;
	matchEnd: number;
	rawValue: unknown;
	fallbackKey: string;
	featureEnabled: boolean;
};

export class TemplatePropertyCollector {
	private map = new Map<string, unknown>();

	/**
	 * Collects a variable for YAML post-processing when it is a complete value for a YAML key
	 * and the raw value is a structured type (object/array/number/boolean/null).
	 */
	public maybeCollect(args: CollectArgs): void {
		const {
			input,
			matchStart,
			matchEnd,
			rawValue,
			fallbackKey,
			featureEnabled,
		} = args;
		if (!featureEnabled) return;

		const yamlRange = findYamlFrontMatterRange(input);
		const context = getYamlContextForMatch(
			input,
			matchStart,
			matchEnd,
			yamlRange
		);

		if (!context.isInYaml || !context.isKeyValuePosition) return;

		const isStructured =
			typeof rawValue !== "string" &&
			(Array.isArray(rawValue) ||
				(typeof rawValue === "object" && rawValue !== null) ||
				typeof rawValue === "number" ||
				typeof rawValue === "boolean" ||
				rawValue === null);
		if (!isStructured) return;

		const lineContent = input.slice(context.lineStart, context.lineEnd);
		const propertyKeyMatch = lineContent.match(/^\s*([^:]+):/);
		const propertyKey = propertyKeyMatch
			? propertyKeyMatch[1].trim()
			: fallbackKey;

		this.map.set(propertyKey, rawValue);
	}

	/** Returns a copy and clears the collector. */
	public drain(): Map<string, unknown> {
		const result = new Map(this.map);
		this.map.clear();
		return result;
	}
}
