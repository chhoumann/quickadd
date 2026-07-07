/**
 * The AI Agent (#714) — the Obsidian-bound glue around the pure tool loop.
 *
 * Constructed by `quickAddApi.ai.agent(config)`. Holds model/system/tools/budget
 * config; `generate({ prompt })` runs the bounded multi-step tool loop and
 * `generate({ prompt, schema })` adds JSON-schema-constrained structured output.
 * Stateless across calls (reuse = reuse the config); a per-run guard prevents
 * overlapping calls from racing the shared variables map / cursor.
 */
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { settingsStore } from "../../settingsStore";
import { CompleteFormatter } from "../../formatters/completeFormatter";
import { makeNoticeHandler } from "../makeNoticeHandler";
import { MacroAbortError } from "../../errors/MacroAbortError";
import { resolveModelInputOrThrow } from "../aiHelpers";
import type { AIProvider, Model } from "../Provider";
import { resolveProviderApiKey } from "../providerSecrets";
import { classifyProviderError } from "../providerErrors";
import { preventCursorChange } from "../preventCursorChange";
import {
	chatRequest,
	type CommonResponse,
} from "../OpenAIRequest";
import type {
	JSONSchema,
	NormalizedChatRequest,
	NormalizedMessage,
	NormalizedToolChoice,
	NormalizedToolDefinition,
} from "./NormalizedTools";
import type { ParsedChatResult } from "./providerToolMapping";
import {
	runToolLoop,
	type LoopStep,
	type RunToolLoopResult,
	type ToolEntry,
} from "./runToolLoop";
import { assertRegisterableSchema, validateValue } from "./jsonSchemaValidator";
import { assertAssignableVariableName } from "./assignableVariable";
import AIToolConfirmModal from "../../gui/AIToolConfirmModal";
import type {
	AgentConfig,
	GenerateOptions,
	GenerateResult,
	GenerateStep,
	PublicToolCall,
	PublicToolResult,
} from "./aiToolTypes";

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const DEFAULT_MAX_STEPS = 20;
const MAX_STEPS_CEILING = 100;

// Cross-instance guard: only one assignToVariable run at a time per choiceExecutor
// (they would race the shared variables map). Read-only runs are unaffected.
const statefulRunsInFlight = new WeakSet<object>();

function isAbortError(e: unknown): boolean {
	return e instanceof MacroAbortError;
}

function toParsed(cr: CommonResponse): ParsedChatResult {
	return {
		content: cr.content,
		toolCalls: cr.toolCalls ?? [],
		normalizedStopReason: cr.normalizedStopReason ?? "stop",
		rawStopReason: cr.stopReason,
		usage: cr.usage,
		providerRaw: cr.providerRaw,
	};
}

function toPublicToolChoice(
	choice: AgentConfig["toolChoice"],
): NormalizedToolChoice | undefined {
	if (!choice) return undefined;
	if (typeof choice === "string") return choice;
	return { name: choice.toolName };
}

export class Agent {
	private running = false;

	constructor(
		private readonly app: App,
		private readonly plugin: QuickAdd,
		private readonly choiceExecutor: IChoiceExecutor,
		private readonly config: AgentConfig,
	) {
		// Validate the tool set once, at construction, so authoring errors fail fast.
		const seen = new Set<string>();
		for (const [name, tool] of Object.entries(config.tools ?? {})) {
			if (!TOOL_NAME_RE.test(name)) {
				throw new Error(
					`Invalid tool name "${name}". Tool names must match ${TOOL_NAME_RE}.`,
				);
			}
			if (seen.has(name)) throw new Error(`Duplicate tool name "${name}".`);
			seen.add(name);
			assertRegisterableSchema(tool.inputSchema, `tool "${name}".inputSchema`);
		}
	}

	async generate(options: GenerateOptions = {}): Promise<GenerateResult> {
		if (this.running) {
			throw new Error(
				"This agent is already running a generate() call. Await it, or create a separate agent for concurrent runs.",
			);
		}
		const usesVariables =
			typeof options.assignToVariable === "string" &&
			options.assignToVariable.length > 0;
		if (usesVariables) {
			this.assertAssignableName(options.assignToVariable as string);
			if (statefulRunsInFlight.has(this.choiceExecutor)) {
				throw new Error(
					"Another AI run with assignToVariable is already in flight in this context — they would race the shared variables. Run them sequentially.",
				);
			}
		}

		this.running = true;
		if (usesVariables) statefulRunsInFlight.add(this.choiceExecutor);
		const restoreCursor = preventCursorChange(this.app);
		try {
			return await this.run(options, restoreCursor);
		} finally {
			this.running = false;
			if (usesVariables) statefulRunsInFlight.delete(this.choiceExecutor);
			try {
				restoreCursor();
			} catch {
				/* editor may be gone; ignore */
			}
		}
	}

	private async run(
		options: GenerateOptions,
		restoreCursor: () => void,
	): Promise<GenerateResult> {
		// Per-run state — "approve all this run" must NOT leak into a later generate()
		// on a reused agent.
		this.approveAllThisRun = false;
		const pluginSettings = settingsStore.getState();
		if (pluginSettings.disableOnlineFeatures) {
			throw new Error(
				"Rejecting AI request: Online features are disabled in settings.",
			);
		}

		const { model, provider: modelProvider } = resolveModelInputOrThrow(
			this.config.model,
		);
		const apiKey = await resolveProviderApiKey(this.app, modelProvider);

		// Build the seed request: [system?, user(formatted prompt)].
		const messages = await this.buildSeedMessages(options);
		const tools = this.buildToolDefinitions();
		const registry = this.buildRegistry();
		const responseFormat = options.schema
			? { schema: options.schema, name: "response", strict: true }
			: undefined;

		// The seed request carries tools but NOT responseFormat — schema is attached
		// per-turn (only on turns that send no tools), so a combined tools+schema run
		// does not collapse (OpenAI suppresses tool calls when response_format is set).
		const request: NormalizedChatRequest = {
			messages,
			...(tools.length > 0 ? { tools } : {}),
			toolChoice:
				toPublicToolChoice(options.toolChoice ?? this.config.toolChoice) ?? "auto",
			maxOutputTokens: options.maxOutputTokens ?? this.config.maxOutputTokens,
			modelParams: this.config.modelOptions,
		};

		const maxSteps = Math.max(
			1,
			Math.min(this.config.maxSteps ?? DEFAULT_MAX_STEPS, MAX_STEPS_CEILING),
		);

		// Mirror the legacy ai.prompt status surface (makeNoticeHandler): a single
		// persistent Notice updated through the multi-step run, only when the
		// "Show assistant messages" setting is on. No-op handler otherwise.
		const notice = makeNoticeHandler(pluginSettings.ai.showAssistant);
		notice.setMessage("starting", "QuickAdd is running the AI agent.");

		try {
			const loop = await runToolLoop({
				request,
				maxSteps,
				dispatch: async (req, ctx) => {
					const turnReq = this.buildTurnRequest(req, ctx.isFinalStep, responseFormat);
					const cr = await chatRequest(
						this.app,
						apiKey,
						model,
						modelProvider,
						turnReq,
						restoreCursor,
					);
					return toParsed(cr);
				},
				getTool: (name) => registry.get(name),
				confirm: (call, tool) => this.confirm(call, tool),
				validateArgs: (tool, args) =>
					validateValue(args, tool.definition.parameters),
				isAbortError,
				isContextOverflow: (e) => classifyProviderError(e) === "input_context",
				isOnlineDisabled: () => settingsStore.getState().disableOnlineFeatures,
				shouldStop: this.buildShouldStop(),
				onStepFinish: (step) => this.reportStep(notice, step),
			});

			const result = this.toGenerateResult(loop);

			if (options.schema) {
				result.object = await this.resolveStructuredObject(
					loop,
					request,
					model,
					modelProvider,
					apiKey,
					options.schema,
					restoreCursor,
				);
			}

			if (
				typeof options.assignToVariable === "string" &&
				options.assignToVariable
			) {
				this.assignVariable(options.assignToVariable, result.text);
			}

			notice.setMessage(
				"finished",
				`Ran ${result.steps.length} step${result.steps.length === 1 ? "" : "s"}.`,
			);
			window.setTimeout(() => notice.hide(), 5000);

			return result;
		} catch (error) {
			notice.setMessage("dead", (error as { message?: string })?.message ?? "");
			window.setTimeout(() => notice.hide(), 5000);
			throw error;
		}
	}

	/** Emit a per-step progress Notice mirroring the legacy ai.prompt status surface. */
	private reportStep(
		notice: { setMessage: (status: string, msg: string) => void },
		step: LoopStep,
	): void {
		const toolNames = step.toolCalls.map((c) => c.name);
		const msg =
			toolNames.length > 0
				? `Step ${step.stepNumber + 1}: running ${toolNames.join(", ")}.`
				: `Step ${step.stepNumber + 1}: generating a response.`;
		notice.setMessage("thinking", msg);
	}

	// --- request assembly -------------------------------------------------

	private async buildSeedMessages(
		options: GenerateOptions,
	): Promise<NormalizedMessage[]> {
		const messages: NormalizedMessage[] = [];
		const system = options.system ?? this.config.system ?? settingsStore.getState().ai.defaultSystemPrompt;
		if (system && system.trim().length > 0) {
			messages.push({ role: "system", content: system });
		}
		const prompt = options.prompt ?? "";
		// The prompt is run through the QuickAdd formatter (like ai.prompt). Tool
		// args, by contrast, are NEVER formatted (that would re-inject {{...}}).
		const formatted = prompt
			? await new CompleteFormatter(
					this.app,
					this.plugin,
					this.choiceExecutor,
			  ).formatFileContent(prompt)
			: "";
		messages.push({ role: "user", content: formatted });
		return messages;
	}

	private buildToolDefinitions(): NormalizedToolDefinition[] {
		return Object.entries(this.config.tools ?? {}).map(([name, tool]) => ({
			name,
			description: tool.description,
			parameters: tool.inputSchema,
			...(tool.strict ? { strict: true } : {}),
		}));
	}

	private buildRegistry(): Map<string, ToolEntry> {
		const registry = new Map<string, ToolEntry>();
		for (const [name, tool] of Object.entries(this.config.tools ?? {})) {
			registry.set(name, {
				definition: {
					name,
					description: tool.description,
					parameters: tool.inputSchema,
					strict: tool.strict,
				},
				execute: (args, ctx) => tool.execute(args, ctx),
				readOnly: tool.readOnly,
			});
		}
		return registry;
	}

	private buildShouldStop():
		| ((info: { steps: LoopStep[] }) => boolean)
		| undefined {
		const conditions = this.config.stopWhen
			? Array.isArray(this.config.stopWhen)
				? this.config.stopWhen
				: [this.config.stopWhen]
			: [];
		if (conditions.length === 0) return undefined;
		return ({ steps }) => {
			const toolCallNames = steps.flatMap((s) =>
				s.toolCalls.map((c) => c.name),
			);
			return conditions.some((c) =>
				c({ stepNumber: steps.length, toolCallNames }),
			);
		};
	}

	/**
	 * Build the per-turn request. The invariant: a turn sends EITHER tools OR a
	 * responseFormat, never both — this avoids OpenAI suppressing tool calls when a
	 * schema is set, and sidesteps Gemini-1.5's tools+responseSchema 400. So:
	 *  - a tool-gathering turn (has tools, not final) → tools, no schema;
	 *  - a no-tools turn (final step, or a schema-only run) → no tools, schema attached.
	 */
	private buildTurnRequest(
		req: NormalizedChatRequest,
		isFinalStep: boolean,
		responseFormat: NormalizedChatRequest["responseFormat"],
	): NormalizedChatRequest {
		const sendTools = !!(req.tools && req.tools.length > 0) && !isFinalStep;
		if (sendTools) {
			return { ...req, responseFormat: undefined };
		}
		return {
			...req,
			tools: undefined,
			toolChoice: isFinalStep ? "none" : req.toolChoice,
			responseFormat,
		};
	}

	// --- confirmation -----------------------------------------------------

	private approveAllThisRun = false;

	private async confirm(
		call: { id: string; name: string; args: Record<string, unknown> | null },
		tool: ToolEntry,
	): Promise<boolean> {
		const args = call.args ?? {};
		// A tool's own needsApproval:true is the safety floor — it is "always ask"
		// regardless of the global setting AND regardless of "Approve all this run",
		// so we never let an allow-all click bypass it (a later destructive write tool
		// the author marked needsApproval:true must still be re-confirmed).
		const perToolFloor = await this.resolvePerToolApproval(tool, args);
		const needs = perToolFloor || this.needsGlobalConfirmation(tool);
		if (!needs) return true;
		if (this.approveAllThisRun && !perToolFloor) return true;

		const outcome = await AIToolConfirmModal.Prompt(
			this.app,
			call.name,
			call.args ?? {},
		);
		if (outcome === "abort") {
			throw new MacroAbortError("AI tool run aborted by user");
		}
		if (outcome === "allow-all") {
			this.approveAllThisRun = true;
			return true;
		}
		return outcome === "allow";
	}

	/**
	 * Resolve a tool's OWN needsApproval gate (the "always ask" floor). True here
	 * means the call must be confirmed even under "Approve all this run".
	 */
	private async resolvePerToolApproval(
		tool: ToolEntry,
		args: Record<string, unknown>,
	): Promise<boolean> {
		const declared = this.config.tools?.[tool.definition.name];
		const perTool = declared?.needsApproval;
		return typeof perTool === "function"
			? await perTool({ args })
			: perTool === true;
	}

	private needsGlobalConfirmation(tool: ToolEntry): boolean {
		// Default to "destructive" when the persisted value is missing: main.ts
		// shallow-merges loadedData, so an existing user's pre-`confirmToolCalls`
		// `ai` object replaces DEFAULT_SETTINGS.ai wholesale and leaves this
		// undefined. Without this floor a destructive author tool would auto-run.
		const global = settingsStore.getState().ai.confirmToolCalls ?? "destructive";
		if (global === "always") return true;
		if (global === "destructive") return tool.readOnly !== true;
		return false; // 'never'
	}

	// --- structured output ------------------------------------------------

	private async resolveStructuredObject(
		loop: RunToolLoopResult,
		request: NormalizedChatRequest,
		model: Model,
		modelProvider: AIProvider,
		apiKey: string,
		schema: JSONSchema,
		restoreCursor: () => void,
	): Promise<unknown> {
		const first = parseStructured(loop.finalTurn.content, schema);
		if (first.ok) return first.value;

		// The first parse above is free (no network). The repair re-ask below makes a
		// new outbound call, so DON'T do it when the loop ended in a terminal
		// non-success state (online disabled mid-run → "aborted", or "context-overflow")
		// or online features are now off — that would bypass the mid-run stop.
		if (
			loop.finishReason === "aborted" ||
			loop.finishReason === "context-overflow" ||
			settingsStore.getState().disableOnlineFeatures
		) {
			return undefined;
		}

		// One bounded repair re-ask: a fresh stricter request (never a format() pass).
		// No tools + responseFormat is the valid no-tools shape for every provider.
		// loop.messages omits the final assistant turn, so include the bad reply
		// explicitly — the "your previous reply" framing needs it in context.
		const repairMessages: NormalizedMessage[] = [
			...loop.messages,
			{ role: "assistant", content: loop.finalTurn.content },
			{
				role: "user",
				content: `Your previous reply was not valid JSON matching the required schema (${first.error}). Reply with ONLY a JSON object that matches the schema — no prose, no code fences.`,
			},
		];
		const repairReq: NormalizedChatRequest = {
			...request,
			messages: repairMessages,
			tools: undefined,
			toolChoice: "none",
			responseFormat: { schema, name: "response", strict: true },
		};
		try {
			const cr = await chatRequest(
				this.app,
				apiKey,
				model,
				modelProvider,
				repairReq,
				restoreCursor,
			);
			const second = parseStructured(cr.content, schema);
			return second.ok ? second.value : undefined;
		} catch {
			return undefined;
		}
	}

	// --- result mapping ---------------------------------------------------

	private toGenerateResult(loop: RunToolLoopResult): GenerateResult {
		const steps: GenerateStep[] = loop.steps.map((s) => ({
			stepNumber: s.stepNumber,
			text: s.text,
			toolCalls: s.toolCalls.map(toPublicCall),
			toolResults: s.toolResults.map(toPublicResult),
			finishReason: s.finishReason,
		}));
		const last = steps[steps.length - 1];
		return {
			text: loop.text,
			steps,
			toolCalls: last?.toolCalls ?? [],
			toolResults: last?.toolResults ?? [],
			usage: {
				inputTokens: loop.usage.promptTokens,
				outputTokens: loop.usage.completionTokens,
				totalTokens: loop.usage.totalTokens,
			},
			finishReason: loop.finishReason,
		};
	}

	// --- variable bridge --------------------------------------------------

	private assignVariable(name: string, text: string): void {
		// Write the trimmed key: assertAssignableName validates the trimmed form,
		// and the formatter trims `{{VALUE:...}}` token names — an untrimmed key
		// (" summary ") would never resolve.
		const key = name.trim();
		const quoted = ("> " + text).replace(/\n/g, "\n> ");
		this.choiceExecutor.variables.set(key, text);
		this.choiceExecutor.variables.set(`${key}-quoted`, quoted);
	}

	private assertAssignableName(name: string): void {
		assertAssignableVariableName(name);
	}
}

function toPublicCall(c: {
	id: string;
	name: string;
	args: Record<string, unknown> | null;
}): PublicToolCall {
	return { toolCallId: c.id, toolName: c.name, input: c.args };
}

function toPublicResult(r: {
	toolCallId: string;
	name: string;
	content: string;
	isError?: boolean;
}): PublicToolResult {
	return {
		toolCallId: r.toolCallId,
		toolName: r.name,
		output: r.content,
		isError: r.isError ?? false,
	};
}

function parseStructured(
	text: string,
	schema: JSONSchema,
): { ok: true; value: unknown } | { ok: false; error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripCodeFences(text));
	} catch (e) {
		return { ok: false, error: `not valid JSON (${e instanceof Error ? e.message : String(e)})` };
	}
	const err = validateValue(parsed, schema);
	if (err) return { ok: false, error: err };
	return { ok: true, value: parsed };
}

function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fence ? fence[1] : trimmed;
}
