import type { App } from "obsidian";
import type QuickAdd from "src/main";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type IChoice from "src/types/choices/IChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import { RequirementCollector, type FieldRequirement } from "./RequirementCollector";
import { OnePageInputModal } from "./OnePageInputModal";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "src/constants";
import { TFile } from "obsidian";

async function readTemplate(app: App, path: string): Promise<string> {
  const addExt = (!MARKDOWN_FILE_EXTENSION_REGEX.test(path) && !path.endsWith(".canvas"));
  const normalized = addExt ? `${path}.md` : path;
  const f = app.vault.getAbstractFileByPath(normalized);
  if (f instanceof TFile) {
    return await app.vault.cachedRead(f);
  }
  return "";
}

async function collectForTemplateChoice(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor, choice: ITemplateChoice) {
  const collector = new RequirementCollector(app, plugin, choiceExecutor);

  // File name format
  if (choice.fileNameFormat?.enabled) {
    await collector.scanString(choice.fileNameFormat.format);
  }

  // Folder paths that may contain variables
  if (choice.folder?.enabled) {
    for (const folder of choice.folder.folders ?? []) {
      await collector.scanString(folder);
    }
  }

  // Template content + nested templates
  if (choice.templatePath) {
    const content = await readTemplate(app, choice.templatePath);
    await collector.scanString(content);
  }

  return collector;
}

async function collectForCaptureChoice(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor, choice: ICaptureChoice) {
  const collector = new RequirementCollector(app, plugin, choiceExecutor);

  // captureTo can contain variables / tags / folders
  await collector.scanString(choice.captureTo);

  // Content
  if (choice.format?.enabled) {
    await collector.scanString(choice.format.format);
  }

  return collector;
}

export async function runOnePagePreflight(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor, choice: IChoice): Promise<boolean> {
  try {
    let collector: RequirementCollector | null = null;

    if (choice.type === "Template") {
      collector = await collectForTemplateChoice(app, plugin, choiceExecutor, choice as ITemplateChoice);
    } else if (choice.type === "Capture") {
      collector = await collectForCaptureChoice(app, plugin, choiceExecutor, choice as ICaptureChoice);
    } else {
      return false; // Phase 1 handles Template & Capture only
    }

    const requirements: FieldRequirement[] = Array.from(collector.requirements.values());
    if (requirements.length === 0) return false; // Nothing to collect

    // Show modal
    const modal = new OnePageInputModal(app, requirements, choiceExecutor.variables);
    const values = await modal.waitForClose;

    // Store results into executor variables
    Object.entries(values).forEach(([k, v]) => choiceExecutor.variables.set(k, v));

    return true;
  } catch {
    return false;
  }
}
