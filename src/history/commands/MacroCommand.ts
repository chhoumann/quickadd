import type { Command } from "../Command";

/**
 * Composite command that bundles multiple commands into a single history entry.
 *
 * NOTE: Sub-commands passed to this class **must not** call `commandHistory.execute`
 * inside their own `execute()`; otherwise they will end up duplicated in the
 * history stack. The typical workflow is:
 *   const composite = new MacroCommand([new CreateFileCommand(...), new OverwriteFileCommand(...)])
 *   await commandHistory.execute(composite)
 */
export class MacroCommand implements Command {
  constructor(private readonly commands: Command[], private readonly description = "Macro") {}

  async execute(): Promise<void> {
    for (const cmd of this.commands) {
      await cmd.execute();
    }
  }

  async undo(): Promise<void> {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      await this.commands[i].undo();
    }
  }

  async redo(): Promise<void> {
    for (const cmd of this.commands) {
      await cmd.redo();
    }
  }

  canUndo(): boolean {
    return this.commands.every((c) => c.canUndo());
  }

  getDescription(): string {
    return this.description;
  }
}