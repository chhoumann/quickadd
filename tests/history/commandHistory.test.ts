import { describe, it, expect } from "vitest";
import { CommandHistory } from "../../src/history/CommandHistory";
import type { Command } from "../../src/history/Command";

class DummyCommand implements Command {
  executed = false;
  undone = false;
  description: string;

  constructor(desc: string) {
    this.description = desc;
  }

  async execute() {
    this.executed = true;
    this.undone = false;
  }

  async undo() {
    this.undone = true;
    this.executed = false;
  }

  async redo() {
    await this.execute();
  }

  canUndo() {
    return this.executed;
  }

  getDescription() {
    return this.description;
  }
}

describe("CommandHistory", () => {
  it("executes and registers commands", async () => {
    const history = new CommandHistory(10);
    const cmd = new DummyCommand("test");

    await history.execute(cmd);
    expect(cmd.executed).toBe(true);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("undoes and redoes correctly", async () => {
    const history = new CommandHistory(10);
    const cmd = new DummyCommand("test undo");
    await history.execute(cmd);

    await history.undo();
    expect(cmd.undone).toBe(true);
    expect(history.canRedo()).toBe(true);

    await history.redo();
    expect(cmd.executed).toBe(true);
  });

  it("trims history when max size reached", async () => {
    const history = new CommandHistory(3);
    const commands: DummyCommand[] = [];
    for (let i = 0; i < 5; i++) {
      const c = new DummyCommand(`cmd${i}`);
      commands.push(c);
      await history.execute(c);
    }
    // history should keep only last 3 commands
    expect(history.canUndo()).toBe(true);
    await history.undo(); // undo cmd4
    await history.undo(); // undo cmd3
    await history.undo(); // undo cmd2
    // further undo should be impossible (cmd1 pruned)
    expect(history.canUndo()).toBe(false);
  });
});