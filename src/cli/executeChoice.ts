import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceEffect } from "../types/ChoiceOutcome";
import type IChoice from "../types/choices/IChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";

type ExecutionResult =
	| { ok: true; verified: boolean; effect: ChoiceEffect | "unknown"; file?: string }
	| { ok: false; error: string; aborted?: true };

/** CLI and interactive runs share outcome semantics; URI callbacks redact errors separately. */
export async function executeChoice(
	executor: IChoiceExecutor,
	choice: IChoice,
	verify: boolean,
): Promise<ExecutionResult> {
	if (
		verify &&
		(choice.type === "Template" || choice.type === "Capture") &&
		typeof executor.executeWithOutcome === "function"
	) {
		const outcome = await executor.executeWithOutcome(
			choice as ITemplateChoice | ICaptureChoice,
		);
		switch (outcome.status) {
			case "success":
				return { ok: true, verified: true, effect: outcome.effect, file: outcome.file?.path };
			case "cancelled":
				return {
					ok: false,
					aborted: true,
					error: outcome.reason || (outcome.cancelKind === "user"
						? "Execution cancelled by user" : "Execution aborted"),
				};
			case "error":
				return { ok: false, error: outcome.reason || "Choice execution failed; no file was created." };
		}
	}

	await executor.execute(choice);
	const aborted = executor.consumeAbortSignal?.();
	return aborted
		? { ok: false, aborted: true, error: aborted.message || "Choice execution aborted" }
		: { ok: true, verified: false, effect: "unknown" };
}
