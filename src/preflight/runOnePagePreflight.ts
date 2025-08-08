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
import { getMarkdownFilesInFolder, getMarkdownFilesWithTag, isFolder } from "src/utilityObsidian";
import { parseNaturalLanguageDate } from "src/utils/dateParser";

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
    const visited = new Set<string>();
    const walk = async (path: string) => {
      if (visited.has(path)) return;
      visited.add(path);
      const content = await readTemplate(app, path);
      await collector.scanString(content);
      for (const nested of collector.templatesToScan) {
        if (!visited.has(nested)) await walk(nested);
      }
      collector.templatesToScan.clear();
    };
    await walk(choice.templatePath);
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

  // If captureTo indicates a folder or tag, offer a file picker requirement
  const formattedTarget = choice.captureTo?.trim() ?? "";
  const isTagTarget = formattedTarget.startsWith("#");
  const isFolderTarget = !isTagTarget && (formattedTarget === "" || isFolder(app, formattedTarget.replace(/\/$|\.md$/g, "")));

  if (!choice.captureToActiveFile && (isTagTarget || isFolderTarget)) {
    let files: TFile[] = [];
    if (isTagTarget) {
      files = getMarkdownFilesWithTag(app, formattedTarget);
    } else {
      const folder = formattedTarget.replace(/^\/$|\/\.md$|^\.md$/, "");
      const base = folder === "" ? "" : (folder.endsWith("/") ? folder : `${folder}/`);
      files = getMarkdownFilesInFolder(app, base);
    }

    const options = files.map((f) => f.path);
    collector.requirements.set("captureTargetFilePath", {
      id: "captureTargetFilePath",
      label: "Select capture target file",
      type: "dropdown",
      options,
      placeholder: options.length ? undefined : "No files found in target scope",
    });
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

    // Normalize special types before storing
    for (const req of requirements) {
      const key = req.id;
      if (!(key in values)) continue;
      const raw = values[key];

      if (req.type === "date" && req.dateFormat) {
        const parsed = parseNaturalLanguageDate(raw, req.dateFormat);
        if (parsed.isValid && parsed.isoString) {
          values[key] = `@date:${parsed.isoString}`;
        }
      }
    }

    // Store results into executor variables
    Object.entries(values).forEach(([k, v]) => choiceExecutor.variables.set(k, v));

    return true;
  } catch {
    return false;
  }
}
