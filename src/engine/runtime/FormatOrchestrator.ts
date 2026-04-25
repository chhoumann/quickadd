import type { App, TFile } from "obsidian";
import { getIntegrationRegistry } from "../../integrations/IntegrationRegistry";
import type { IntegrationRegistry } from "../../integrations/IntegrationRegistry";
import type { ChoiceExecutionContext } from "./context";
import { createDiagnostic } from "./diagnostic";

export interface CaptureRunPlan {
	choiceId?: string;
	targetPath: string;
	action: string;
	fileAlreadyExists: boolean;
	createWithTemplate: boolean;
	templaterPolicy:
		| "parse-capture"
		| "render-whole-file"
		| "wait-for-on-create"
		| "none";
}

export interface CaptureRunResult {
	choiceId?: string;
	filePath: string;
	action: string;
	wasNewFile: boolean;
}

export interface TemplaterOverwriteOptions {
	skipIfNoTags?: boolean;
	postWait?: boolean;
	diagnoseMissingCapability?: boolean;
}

export class FormatOrchestrator {
	constructor(
		private readonly app: App,
		private readonly context?: ChoiceExecutionContext,
	) {}

	private get integrations(): IntegrationRegistry {
		return this.context?.integrations ?? getIntegrationRegistry(this.app);
	}

	async parseTemplaterTemplate(
		content: string,
		file: TFile,
	): Promise<string> {
		const templater = this.integrations.templater;

		const shouldDiagnoseMissingCapability =
			file.extension === "md" && content.includes("<%");
		if (
			shouldDiagnoseMissingCapability &&
			!templater.hasCapability("parseTemplate")
		) {
			this.addMissingTemplaterCapabilityDiagnostic("parseTemplate", file);
		}

		return await templater.parseTemplate(content, file);
	}

	async overwriteTemplaterOnce(
		file: TFile,
		options: TemplaterOverwriteOptions = {},
	): Promise<void> {
		const templater = this.integrations.templater;
		const { diagnoseMissingCapability = true, ...templaterOptions } = options;

		if (
			file.extension === "md" &&
			diagnoseMissingCapability &&
			!templater.hasCapability("overwriteFileCommands")
		) {
			this.addMissingTemplaterCapabilityDiagnostic(
				"overwriteFileCommands",
				file,
			);
		}

		await templater.overwriteFileOnce(file, templaterOptions);
	}

	isTemplaterTriggerOnCreateEnabled(): boolean {
		return this.integrations.templater.isTriggerOnCreateEnabled();
	}

	async waitForTemplaterTriggerOnCreateToComplete(
		file: TFile,
	): Promise<void> {
		await this.integrations.templater.waitForTriggerOnCreateToComplete(file);
	}

	async jumpToNextTemplaterCursorIfPossible(file: TFile): Promise<void> {
		await this.integrations.templater.jumpToNextCursorIfPossible(file);
	}

	recordCapturePlan(plan: CaptureRunPlan): void {
		this.context?.addArtifact({
			id: this.context.createStepId("capture-plan"),
			kind: "custom",
			label: "Capture run plan",
			path: plan.targetPath,
			value: plan,
			createdAt: Date.now(),
		});
	}

	recordCaptureResult(result: CaptureRunResult): void {
		this.context?.addArtifact({
			id: this.context.createStepId("capture-result"),
			kind: "file",
			label: "Capture target",
			path: result.filePath,
			value: result,
			metadata: {
				action: result.action,
				wasNewFile: result.wasNewFile,
			},
			createdAt: Date.now(),
		});
	}

	private addMissingTemplaterCapabilityDiagnostic(
		capability: string,
		file: TFile,
	): void {
		this.context?.addDiagnostic(
			createDiagnostic({
				severity: "info",
				code: "templater-capability-missing",
				message: `Templater capability '${capability}' is unavailable for ${file.path}.`,
				source: "integration",
				integrationId: "templater-obsidian",
				details: {
					capability,
					filePath: file.path,
				},
			}),
		);
	}
}
