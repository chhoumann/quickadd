import { it, expect } from "vitest";
import { runToolLoop, type ToolEntry } from "src/ai/tools/runToolLoop";
import { validateValue } from "src/ai/tools/jsonSchemaValidator";
import type { NormalizedChatRequest } from "src/ai/tools/NormalizedTools";
import type { ParsedChatResult } from "src/ai/tools/providerToolMapping";

export function liveWireCases(dispatch: (request: NormalizedChatRequest) => Promise<ParsedChatResult>, names: { toolLoop: string; structured: string }, timeout: number): void {
	it(names.toolLoop, async () => {
		const calls: Array<{ a: number; b: number }> = [];
		const add: ToolEntry = {
			definition: {
				name: "add",
				description: "Add two integers and return their sum.",
				parameters: {
					type: "object",
					properties: { a: { type: "integer" }, b: { type: "integer" } },
					required: ["a", "b"],
				},
			},
			readOnly: true,
			execute: (args) => {
				const a = Number(args.a);
				const b = Number(args.b);
				calls.push({ a, b });
				return { sum: a + b };
			},
		};

		const res = await runToolLoop({
			request: {
				messages: [
					{ role: "system", content: "You must use the add tool to compute sums. Do not compute them yourself." },
					{ role: "user", content: "Use the add tool to add 17 and 25, then state the result as a number." },
				],
				tools: [add.definition],
				toolChoice: "auto",
			},
			maxSteps: 4,
			dispatch: (req) => dispatch(req),
			getTool: (name) => (name === "add" ? add : undefined),
			confirm: async () => true,
			validateArgs: (tool, args) => validateValue(args, tool.definition.parameters),
			isAbortError: () => false,
		});

		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls[0]).toEqual({ a: 17, b: 25 });
		expect(res.text).toMatch(/42/);
		expect(res.finishReason).toBe("stop");
	}, timeout);

	it(names.structured, async () => {
		const schema = {
			type: "object" as const,
			properties: {
				title: { type: "string" as const },
				tags: { type: "array" as const, items: { type: "string" as const } },
			},
			required: ["title", "tags"],
		};
		const parsed = await dispatch({
			messages: [
				{ role: "user", content: "Extract the title and the tags (without '#') from this note: 'Hello World #alpha #beta'." },
			],
			responseFormat: { schema, name: "note_meta", strict: true },
		});
		const obj = JSON.parse(parsed.content) as { title: string; tags: string[] };
		expect(validateValue(obj, schema)).toBeNull();
		expect(typeof obj.title).toBe("string");
		expect(obj.tags).toEqual(expect.arrayContaining(["alpha", "beta"]));
	}, timeout);
}
