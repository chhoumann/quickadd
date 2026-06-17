/**
 * Built-in `system` tools (#714): small, always-safe utilities. Read-only.
 */
import { getDate } from "../../../utilityObsidian";
import { applyGroupOptions, defineTool, type BuiltinGroupOptions, type ToolSetMap } from "./shared";

export function createSystemTools(options: BuiltinGroupOptions = {}): ToolSetMap {
	const tools: ToolSetMap = {
		get_date: defineTool({
			description:
				"Get the current date/time. Optionally pass a moment.js format and a day offset.",
			inputSchema: {
				type: "object",
				properties: {
					format: { type: "string", description: "moment.js format, e.g. YYYY-MM-DD" },
					offset: { type: "integer", description: "Day offset from today (e.g. 1 = tomorrow)." },
				},
			},
			readOnly: true,
			execute: async ({ format, offset }) => ({
				date: getDate({
					format: format != null ? String(format) : undefined,
					offset: offset != null ? Number(offset) : undefined,
				}),
			}),
		}),
	};

	return applyGroupOptions(tools, options);
}
