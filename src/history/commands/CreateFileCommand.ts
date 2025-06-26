import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { Command } from "../Command";

/**
 * Command that creates a new file (with initial content) and can undo by
 * deleting it. If the file already exists, execute() will overwrite it, and
 * undo() will restore the previous content instead of deleting the file.
 */
export class CreateFileCommand implements Command {
  private fileCreated = false;
  private previousContent: string | null = null;
  private fileExistedBefore = false;

  constructor(
    private readonly app: App,
    private readonly path: string,
    private readonly content: string,
  ) {}

  async execute(): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(this.path);

    if (existing && existing instanceof TFile) {
      // File existed – treat as overwrite so we can restore it later.
      this.previousContent = await this.app.vault.read(existing);
      this.fileExistedBefore = true;
      await this.app.vault.modify(existing, this.content);
    } else {
      await this.app.vault.create(this.path, this.content);
      this.fileCreated = true;
    }
  }

  async undo(): Promise<void> {
    if (this.fileCreated) {
      const file = this.app.vault.getAbstractFileByPath(this.path);
      if (file && file instanceof TFile) {
        await this.app.vault.delete(file);
      }
      this.fileCreated = false;
      return;
    }

    if (this.fileExistedBefore && this.previousContent !== null) {
      const file = this.app.vault.getAbstractFileByPath(this.path);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, this.previousContent);
      }
    }
  }

  async redo(): Promise<void> {
    // Re-run execute. If the file was originally created, redo() recreates it.
    // If it was overwritten, we overwrite again with new content.
    await this.execute();
  }

  canUndo(): boolean {
    return this.fileCreated || this.fileExistedBefore;
  }

  getDescription(): string {
    return `Create file: ${this.path}`;
  }
}