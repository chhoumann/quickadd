import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { Command } from "../Command";

/**
 * Command that appends text to an existing file.
 * Undo restores the original content.
 */
export class AppendToFileCommand implements Command {
  private originalContent: string | null = null;
  private file: TFile | null = null;

  constructor(
    private readonly app: App,
    private readonly filePath: string,
    private readonly textToAppend: string,
  ) {}

  async execute(): Promise<void> {
    const abstract = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!abstract || !(abstract instanceof TFile)) {
      throw new Error(`File not found: ${this.filePath}`);
    }
    this.file = abstract;

    this.originalContent = await this.app.vault.read(this.file);

    const newContent = `${this.originalContent}${this.textToAppend}`;
    await this.app.vault.modify(this.file, newContent);
  }

  async undo(): Promise<void> {
    if (!this.file || this.originalContent === null) return;
    await this.app.vault.modify(this.file, this.originalContent);
  }

  async redo(): Promise<void> {
    if (!this.file) return;
    const redoContent = `${await this.app.vault.read(this.file)}${this.textToAppend}`;
    await this.app.vault.modify(this.file, redoContent);
  }

  canUndo(): boolean {
    return this.originalContent !== null;
  }

  getDescription(): string {
    return `Append to file: ${this.filePath}`;
  }
}