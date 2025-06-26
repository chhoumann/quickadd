import { Notice } from "obsidian";
import type { Command } from "./Command";
import { MacroCommand } from "./commands/MacroCommand";

/**
 * Centralised history stack for all QuickAdd commands.
 *
 * The class is intentionally lightweight and framework-agnostic – it has
 * no direct knowledge of where the commands come from. Engines simply call
 * `commandHistory.execute(cmd)` instead of performing side effects directly.
 */
export class CommandHistory {
  private history: Command[] = [];
  private currentIndex = -1;
  private readonly maxHistorySize: number;

  constructor(maxHistorySize = 50) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Execute a command and push it onto the history stack.
   * Commands that were undone and not yet redone are discarded
   * (classic linear history like most editors).
   */
  async execute(command: Command): Promise<void> {
    // Remove any commands after the current index – they are no longer reachable
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    await command.execute();

    this.history.push(command);
    this.currentIndex++;

    // Trim history to bounded size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
      this.currentIndex--;
    }
  }

  async undo(): Promise<void> {
    if (!this.canUndo()) return;

    const command = this.history[this.currentIndex];
    await command.undo();
    this.currentIndex--;
    new Notice(`Undone: ${command.getDescription()}`);
  }

  async redo(): Promise<void> {
    if (!this.canRedo()) return;

    this.currentIndex++;
    const command = this.history[this.currentIndex];
    await command.redo();
    new Notice(`Redone: ${command.getDescription()}`);
  }

  canUndo(): boolean {
    return this.currentIndex >= 0 && !!this.history[this.currentIndex]?.canUndo();
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  /**
   * Execute a callback that runs multiple `commandHistory.execute(...)` calls and
   * groups them into a single MacroCommand so they appear as a single entry in the history.
   */
  async executeBatch(description: string, fn: () => Promise<void>): Promise<void> {
    const startIndex = this.history.length;
    await fn();
    const newCommands = this.history.slice(startIndex);
    if (newCommands.length <= 1) {
      // Nothing or just one command – keep as-is.
      return;
    }

    // Remove newly added commands
    this.history = this.history.slice(0, startIndex);

    // Push composite
    const composite = new MacroCommand(newCommands, description);
    this.history.push(composite);
    this.currentIndex = this.history.length - 1;
  }
}

// Export a shared instance so all components operate on the same stack.
export const commandHistory = new CommandHistory();