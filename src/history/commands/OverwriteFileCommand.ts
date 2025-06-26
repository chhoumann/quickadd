import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { Command } from "../Command";

/**
 * Command that overwrites an existing file with new content and supports undo/redo
 * by preserving the original text.
 */
export class OverwriteFileCommand implements Command {
  private previousContent: string | null = null;
  private file: TFile | null = null;

  constructor(
    private readonly app: App,
    private readonly filePath: string,
    private readonly newContent: string,
  ) {}

  async execute(): Promise<void> {
    const abstract = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!abstract || !(abstract instanceof TFile)) {
      throw new Error(`File not found: ${this.filePath}`);
    }
    this.file = abstract;

    // Store current content for undo
    this.previousContent = await this.app.vault.read(this.file);

    await this.app.vault.modify(this.file, this.newContent);
  }

  async undo(): Promise<void> {
    if (!this.file || this.previousContent === null) return;
    await this.app.vault.modify(this.file, this.previousContent);
  }

  async redo(): Promise<void> {
    if (!this.file) return;
    await this.app.vault.modify(this.file, this.newContent);
  }

  canUndo(): boolean {
    return this.previousContent !== null;
  }

  getDescription(): string {
    return `Overwrite file: ${this.filePath}`;
  }
}