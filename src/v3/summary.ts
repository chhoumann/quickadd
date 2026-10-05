import type { Action, ActionNode, AddToNoteStep, CreateNoteStep, LinkStep, Step } from "./model";
import { getOperatorLabel } from "../utils/conditionalHelpers";
import { RUN_NOTE } from "./model";

/**
 * One line that says what an action does, generated from its steps:
 * "Adds a line under ## Log in today's daily note". `nameOf` resolves the
 * actions that Run action steps point at.
 */
export function summarize(action: Action, nameOf: (id: string) => string | undefined = () => undefined): string {
	const line = describeSteps(action.steps, nameOf);
	return line ? capitalize(line) : "No steps yet";
}

/** What one step does, as a line of its own: "Opens it". */
export function describeStepLine(step: Step, nameOf: (id: string) => string | undefined = () => undefined): string {
	return capitalize(describeStep(step, nameOf));
}

/** What a few steps do, as one line: "Adds a line at the bottom of Inbox, opens it". */
export function describeStepsLine(steps: Step[], nameOf: (id: string) => string | undefined = () => undefined): string {
	return capitalize(describeSteps(steps, nameOf));
}

function capitalize(line: string): string {
	return line.charAt(0).toUpperCase() + line.slice(1);
}

function describeSteps(steps: Step[], nameOf: (id: string) => string | undefined): string {
	return steps.map((step) => describeStep(step, nameOf)).join(", ");
}

function describeStep(step: Step, nameOf: (id: string) => string | undefined): string {
	switch (step.type) {
		case "createNote":
			return describeCreate(step);
		case "addToNote":
			return describeAdd(step);
		case "templater":
			return step.note === RUN_NOTE ? "runs Templater on it" : `runs Templater on ${render(step.note)}`;
		case "link":
			return describeLink(step);
		case "open":
			return step.note === RUN_NOTE ? "opens it" : `opens ${render(step.note)}`;
		case "runCommand":
			return step.command.kind === "obsidian"
				? `runs ${step.name ? `'${step.name}'` : step.command.commandId}`
				: `${step.command.editorCommandType.toLowerCase()} in the editor`;
		case "runScript":
			return step.path.trim() ? `runs ${basename(step.path)}` : "runs a script";
		case "ai":
			return `asks AI${step.outputVariableName ? ` for {${step.outputVariableName}}` : ""}`;
		case "if": {
			const condition = step.condition.mode === "variable"
				? `${step.condition.variableName || "(missing variable)"} ${getOperatorLabel(step.condition.operator)}${step.condition.expectedValue ? ` ${step.condition.expectedValue}` : ""}`
				: `${basename(step.condition.scriptPath)} says so`;
			const otherwise = step.elseSteps.length > 0 ? `, otherwise ${describeSteps(step.elseSteps, nameOf)}` : "";
			return `if ${condition} then ${describeSteps(step.thenSteps, nameOf) || "nothing"}${otherwise}`;
		}
		case "wait":
			return `waits ${step.time} ms`;
		case "runAction":
			return `runs '${nameOf(step.actionId) ?? step.actionId}'`;
		case "inlineAction":
			return describeInline(step.node, nameOf);
		case "unknown":
			return "skips a step this version cannot read";
	}
}

function describeInline(node: ActionNode, nameOf: (id: string) => string | undefined): string {
	if (node.kind === "folder") return `asks which of ${node.items.map((item) => `'${item.name}'`).join(", ")} to run`;
	const steps = describeSteps(node.steps, nameOf);
	// Old versions saved some nested choices without a name.
	return node.name ? `runs '${node.name}' (${steps})` : steps;
}

function describeCreate(step: CreateNoteStep): string {
	const name = step.fileNameFormat.enabled ? render(step.fileNameFormat.format) : "{title}";
	const { mode, folders, includeSubfolders } = step.location;
	const folder =
		mode === "default" ? "" :
		mode === "activeFolder" ? "{current folder}/" :
		mode === "folders" && folders.length === 1 && !includeSubfolders ? `${render(folders[0])}/` :
		"{folder}/";
	// Rendered first: a placeholder's argument can hold a slash.
	const template = step.templatePath ? ` from ${basename(render(step.templatePath))}` : "";
	return `creates ${folder}${name}${template}`;
}

function describeAdd(step: AddToNoteStep): string {
	const target = describeTarget(step);
	if (step.position === "property" && step.propertyCapture) {
		const property = step.propertyCapture.property;
		const name = property.kind === "named" ? render(property.format) : "a chosen property";
		const verb = step.propertyCapture.action === "set" ? "sets" : "adds to";
		return `${verb} ${name} in ${target}`;
	}
	const what = step.task ? "a task" : step.eachLine ? "each line" : step.useSelectionAsCaptureValue ? "the selection" : "a line";
	const where = {
		top: "at the top of",
		cursor: "at the cursor in",
		bottom: "at the bottom of",
		after: step.insertAfter.promptHeading ? "under a chosen heading in" : `under ${render(step.insertAfter.after)} in`,
		before: `before ${render(step.insertBefore?.before ?? "")} in`,
		property: "in",
		newLineAbove: "on a new line above the cursor in",
		newLineBelow: "on a new line below the cursor in",
	}[step.position];
	return `adds ${what} ${where} ${target}`;
}

function describeTarget(step: AddToNoteStep): string {
	if (step.captureToActiveFile) return "the current note";
	const to = step.captureTo.trim();
	if (to === "") return "a chosen note";
	if (/^{{\s*DAILY\s*}}$/i.test(to)) return "today's daily note";
	if (to.startsWith("#")) return `a note tagged ${to}`;
	if (to.endsWith("/")) return `a note in ${render(to)}`;
	if (/^property:/i.test(to)) return `a note with ${to.slice("property:".length).trim()}`;
	return render(to.replace(/\.md$/i, ""));
}

function describeLink(step: LinkStep): string {
	const parts: string[] = [];
	const insert = step.insert;
	if (insert) {
		const verb = insert.linkType === "embed" ? "embeds" : "links";
		const into = insert.destination?.type === "specifiedFile" ? render(insert.destination.path.replace(/\.md$/i, "")) : "here";
		parts.push(
			insert.placement === "inFrontmatter"
				? `${verb} it in the ${insert.frontmatterProperty ?? "chosen"} property ${into === "here" ? "here" : `of ${into}`}`
				: `${verb} it ${into === "here" ? "here" : `in ${into}`}`,
		);
	}
	if (step.copyToClipboard) parts.push("copies its link");
	return parts.join(" and ");
}

function basename(path: string): string {
	const file = path.split("/").pop() ?? path;
	return file.replace(/\.md$/i, "");
}

/**
 * Placeholders as short names in braces: {{DATE:YYYY}} -> {date},
 * {{VALUE:Name|optional}} -> {Name}, {{FILE:People|label:Person}} -> {Person}.
 */
export function render(text: string): string {
	return text.replace(/{{\s*([A-Za-z]+)\s*(?::([^}]*))?}}/g, (_match, token: string, argument?: string) => {
		const name = token.toUpperCase();
		// A FILE placeholder's argument is a folder; its label names the pick.
		const fileLabel = name === "FILE" ? /\|\s*label:([^|]+)/i.exec(argument ?? "")?.[1].trim() : undefined;
		const label = fileLabel ?? argument?.split("|")[0].trim();
		if (name === "DATE" || name === "TIME" || name === "TITLE") return `{${name.toLowerCase()}}`;
		if (name === "DAILY") return "today's daily note";
		if (label && ["VALUE", "VDATE", "FIELD", "FILE", "MACRO", "ACTION", "GLOBAL_VAR"].includes(name)) {
			return `{${name === "VDATE" ? label.split(",")[0].trim() : label}}`;
		}
		return `{${name.toLowerCase()}}`;
	});
}
