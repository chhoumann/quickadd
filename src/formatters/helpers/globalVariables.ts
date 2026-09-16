import { GLOBAL_VAR_REGEX } from "../../constants";

/** Globals may nest, but expansion stops after five passes, including cycles. */
export function expandGlobalVariables(
	input: string,
	variables: Readonly<Record<string, string>> | undefined,
): string {
	let output = input;
	const pattern = new RegExp(GLOBAL_VAR_REGEX.source, "gi");
	let passes = 0;
	while (pattern.test(output)) {
		if (++passes > 5) break;
		output = output.replace(pattern, (match, rawName) => {
			const name = String(rawName ?? "").trim();
			if (!name) return match;
			const snippet = variables?.[name];
			return typeof snippet === "string" ? snippet : "";
		});
	}
	return output;
}
