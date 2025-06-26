import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import type { Command } from "../Command";

/**
 * Command that deletes a file and supports undo/redo by restoring the original
 * content. If the parent folders were newly created by execute(), this command
 * does not attempt to remove them on undo (to avoid accidental data loss).
 */
export class DeleteFileCommand implements Command {
  private fileContent: string | null = null;
  private fileDeleted = false;

  constructor(private readonly app: App, private readonly filePath: string) {}

  async execute(): Promise<void> {
    const abstract = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!abstract || !(abstract instanceof TFile)) {
      // If the file is already gone, treat as no-op
      return;
    }
    this.fileContent = await this.app.vault.read(abstract);
    await this.app.vault.delete(abstract);
    this.fileDeleted = true;
  }

  async undo(): Promise<void> {
    if (!this.fileDeleted || this.fileContent === null) return;

    // Ensure parent directory exists
    const dirMatch = this.filePath.match(/(.*)[/\\]/);
    const dirPath = dirMatch ? dirMatch[1] : "";
    if (dirPath) {
      const dirAbstract = this.app.vault.getAbstractFileByPath(dirPath);
      if (!dirAbstract) {
        await this.app.vault.createFolder(dirPath);
      } else if (!(dirAbstract instanceof TFolder)) {
        throw new Error(`Cannot recreate file; parent path ${dirPath} is not a folder`);
      }
    }

    await this.app.vault.create(this.filePath, this.fileContent);
    this.fileDeleted = false;
  }

  async redo(): Promise<void> {
    if (this.fileDeleted) return; // already deleted
    const abstract = this.app.vault.getAbstractFileByPath(this.filePath);
    if (abstract && abstract instanceof TFile) {
      await this.app.vault.delete(abstract);
    }
    this.fileDeleted = true;
  }

  canUndo(): boolean {
    return this.fileContent !== null && this.fileDeleted;
  }

  getDescription(): string {
    return `Delete file: ${this.filePath}`;
  }
}