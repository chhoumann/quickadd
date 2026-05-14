import { describe, expect, it, vi } from "vitest";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type { FormatDisplayFormatterEvaluators } from "./formatterEvaluators";
import { VALUE_LABEL_KEY_DELIMITER } from "../utils/valueSyntax";

const app = {
	workspace: {
		getActiveFile: vi.fn(() => null),
	},
} as any;

const plugin = {
	settings: {
		globalVariables: {},
	},
} as any;

describe("FormatDisplayFormatter evaluator boundaries", () => {
	it("uses preview-safe template evaluator output without running runtime macros or inline scripts", async () => {
		const evaluators: FormatDisplayFormatterEvaluators = {
			template: {
				evaluateTemplate: vi.fn(async () =>
					"{{MACRO:Runtime}} ```js quickadd\nthrow new Error('side effect');\n```",
				),
			},
		};
		const formatter = new FormatDisplayFormatter(
			app,
			plugin,
			undefined,
			evaluators,
		);

		await expect(
			formatter.format("Preview {{TEMPLATE:Templates/Safe}}"),
		).resolves.toBe(
			"Preview {{TEMPLATE:Templates/Safe}}",
		);
		await expect(
			formatter.format("Preview {{TEMPLATE:Templates/Safe.md}}"),
		).resolves.toBe(
			"Preview {{MACRO:Runtime}} ```js quickadd\nthrow new Error('side effect');\n```",
		);
		expect(evaluators.template.evaluateTemplate).toHaveBeenLastCalledWith(
			"Templates/Safe.md",
			expect.objectContaining({ variables: expect.any(Map) }),
		);
	});

	it("returns safe template fallback when preview evaluation fails", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin, undefined, {
			template: {
				evaluateTemplate: async () => {
					throw new Error("read failed");
				},
			},
		});

		await expect(formatter.format("{{TEMPLATE:Missing.md}}")).resolves.toBe(
			"Template (not found): Missing.md",
		);
	});

	it("returns original input for unexpected preview failures", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin, undefined, {
			template: {
				evaluateTemplate: async () => "unused",
			},
		});

		await expect(formatter.format("{{DATE:")).resolves.toBe("{{DATE:");
	});

	it("treats existing non-undefined preview variables as resolved", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin);
		formatter.setPreviewVariables(
			new Map<string, unknown>([
				["empty", ""],
				["nil", null],
				["count", 7],
				["obj", { ok: true }],
				[`a,b${VALUE_LABEL_KEY_DELIMITER}mapped`, "selected-value"],
			]),
		);

		await expect(
			formatter.format(
				"{{VALUE:empty}}|{{VALUE:nil}}|{{VALUE:count}}|{{VALUE:obj}}|{{VALUE:a,b|label:mapped}}",
			),
		).resolves.toBe("||7|{\"ok\":true}|selected-value");
	});
});
