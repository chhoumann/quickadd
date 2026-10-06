import type { App, WorkspaceLeaf } from "obsidian";
import type { ChoiceChain } from "../../engine/choiceChain";
import { copyChoiceFileLink, insertChoiceFileLink, appendLinkDestinationError } from "../../engine/choiceFileActions";
import { resolveStepNote, type StepNoteContext } from "../../engine/helpers/stepNote";
import type { MacroChoiceEngine } from "../../engine/MacroChoiceEngine";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type QuickAdd from "../../main";
import { isDiscoveryInputBoundary } from "../../preflight/macroFormRoster";
import { classifyStep } from "../../preflight/macroCommandRole";
import { withPreparedChoiceInputs } from "../../preflight/preparedChoiceInputs";
import { CommandType } from "../../types/macros/CommandType";
import type { ICommand } from "../../types/macros/ICommand";
import type { INestedChoiceCommand } from "../../types/macros/QuickCommands/INestedChoiceCommand";
import { normalizeAppendLinkOptions } from "../../types/linkPlacement";
import { openFile } from "../../utils/fileOpening";
import { handleMacroAbort } from "../../utils/macroAbortHandler";
import { resolveChoiceFromPlugin } from "../../utils/resolveChoiceFromPlugin";
import { getTemplaterPlugin, overwriteTemplaterOnce } from "../../utils/templaterIntegration";
import { templaterRerunAfter, warnDeprecatedOnce } from "../../utils/templaterRerunDeprecation";
import { lowerStep, lowerSteps, lowerWriteGroup, readWriteGroup } from "../lower";
import type { Action, LinkStep, OpenStep, Step, TemplaterStep } from "../model";

export interface StepRunContext {
	app: App;
	plugin: QuickAdd;
	executor: IChoiceExecutor;
	action: Action;
	chain: ChoiceChain;
	originLeaf: WorkspaceLeaf | null;
	/** Built once per run; it runs the steps that are commands and shares the run's variables. */
	macroEngine: MacroChoiceEngine;
}

/**
 * Runs `steps` in order. A write with its follow-ups runs as the Template or
 * Capture choice it lowers to, through the executor, so the run note follows
 * it. A link, Templater or open step runs here; every other step runs as its
 * command on the macro engine. An abort or a refusal stops the run, as it
 * stops a macro.
 */
export async function runSteps(steps: Step[], ctx: StepRunContext): Promise<void> {
	try {
		await runList(steps, ctx);
	} catch (error) {
		if (
			handleMacroAbort(error, {
				choiceName: ctx.action.name,
				logPrefix: "Macro execution aborted",
				noticePrefix: "Macro execution aborted",
				defaultReason: "Macro execution aborted",
			})
		) {
			ctx.executor.signalAbort?.(error);
			return;
		}
		throw error;
	}
}

async function runList(steps: Step[], ctx: StepRunContext): Promise<void> {
	const { action, executor, plugin } = ctx;
	const resolveChoice = (id: string) => resolveChoiceFromPlugin(plugin, id);
	let previous: ICommand | undefined;
	for (let index = 0; index < steps.length; ) {
		const step = steps[index];
		const group = readWriteGroup(steps, index);
		const next = group ? group.next : index + 1;
		const command = group ? lowerWriteGroup(group, action.id) : lowerStep(step, action.id);

		const rerunAfter = templaterRerunAfter(previous, command, resolveChoice);
		if (rerunAfter) {
			warnDeprecatedOnce(
				`templater-rerun:${action.id}:${command.id}`,
				`Macro '${action.name}' runs "Templater: Replace templates in the active file" after '${rerunAfter}'. QuickAdd already runs Templater in the notes it creates and captures, so this step is deprecated and can run template code twice. Remove it from the macro.`,
			);
		}
		if (step.type !== "wait" && step.type !== "if") previous = command;

		// A Template that asks which existing note to use only knows what the
		// steps after it need once it ran: the one-page form asks for those then.
		const role = command.type === CommandType.Choice || command.type === CommandType.NestedChoice
			? classifyStep(command, resolveChoice)
			: null;
		const resumeInputs = role?.collect.kind === "scanChoice" &&
			isDiscoveryInputBoundary(role.collect.choice, executor.variables.get("value"));

		if (group) await runWrite(command as INestedChoiceCommand, ctx);
		else await runStep(step, command, ctx);

		if (resumeInputs) await executor.prepareMacroInputs(ctx.macroEngine.choice, lowerSteps(steps.slice(next), action.id));
		index = next;
	}
}

async function runWrite(command: INestedChoiceCommand, ctx: StepRunContext): Promise<void> {
	const { executor } = ctx;
	await withPreparedChoiceInputs(executor, command.id, () => executor.execute(command.choice, ctx.chain));
	throwPendingAbort(executor);
}

async function runStep(step: Step, command: ICommand, ctx: StepRunContext): Promise<void> {
	switch (step.type) {
		case "link":
			return await runLink(step, ctx);
		case "templater":
			return await runTemplater(step, ctx);
		case "open":
			return await runOpen(step, ctx);
		case "if": {
			const holds = await ctx.macroEngine.conditionHolds(step.condition);
			return await runList(holds ? step.thenSteps : step.elseSteps, ctx);
		}
		default:
			await ctx.macroEngine.runSubset([command]);
			throwPendingAbort(ctx.executor);
	}
}

async function runLink(step: LinkStep, ctx: StepRunContext): Promise<void> {
	const file = await resolveStepNote(noteContext(ctx), step.link, {
		scope: `link:${step.id}`,
		label: "Link",
		consequence: "there is no {{NOTE}} to link",
	});
	if (!file) return;
	if (step.insert) {
		const options = normalizeAppendLinkOptions({ enabled: true, ...step.insert });
		const destinationError = appendLinkDestinationError(ctx.app, options);
		if (destinationError) throw new Error(destinationError);
		await insertChoiceFileLink(ctx.app, file, options, ctx.executor.focusedProperty);
	}
	if (step.copyToClipboard) await copyChoiceFileLink(file);
}

async function runTemplater(step: TemplaterStep, ctx: StepRunContext): Promise<void> {
	// Without Templater the step does nothing; its badge in the builder says so.
	if (!getTemplaterPlugin(ctx.app)) return;
	const file = await resolveStepNote(noteContext(ctx), step.note, {
		scope: `templater:${step.id}`,
		label: "Templater",
		consequence: "there is no {{NOTE}} to run Templater on",
	});
	if (file) await overwriteTemplaterOnce(ctx.app, file);
}

async function runOpen(step: OpenStep, ctx: StepRunContext): Promise<void> {
	const file = await resolveStepNote(noteContext(ctx), step.note, {
		scope: `openFile:${step.id}`,
		label: "OpenFile",
		consequence: "there is no {{NOTE}} to open",
	});
	if (!file) return;
	await openFile(ctx.app, file, {
		location: step.location,
		direction: step.direction,
		mode: step.mode,
		focus: step.focus,
		originLeaf: ctx.originLeaf,
	});
}

function noteContext({ app, executor, action, chain }: StepRunContext): StepNoteContext {
	return { app, executor, choice: action, chain };
}

/** A step that ran through the executor or the macro engine and aborted stops the run here. */
function throwPendingAbort(executor: IChoiceExecutor): void {
	const abort = executor.consumeAbortSignal?.();
	if (abort) throw abort;
}
