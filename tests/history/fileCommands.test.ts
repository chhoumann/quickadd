import { describe, it, expect, beforeEach } from "vitest";
import { CommandHistory } from "../../src/history/CommandHistory";
import { CreateFileCommand } from "../../src/history/commands/CreateFileCommand";
import { OverwriteFileCommand } from "../../src/history/commands/OverwriteFileCommand";
import { AppendToFileCommand } from "../../src/history/commands/AppendToFileCommand";
import { DeleteFileCommand } from "../../src/history/commands/DeleteFileCommand";

// Simple in-memory vault stub.
function createStubApp(): any {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (path: string) => files.has(path),
  } as any;
  const vault = {
    adapter,
    create: async (path: string, content: string) => {
      files.set(path, content);
      return { path } as any;
    },
    read: async (file: any) => files.get(file.path) ?? "",
    modify: async (file: any, newContent: string) => {
      files.set(file.path, newContent);
    },
    delete: async (file: any) => {
      files.delete(file.path);
    },
    getAbstractFileByPath: (path: string) => {
      if (!files.has(path)) return null;
      return { path } as any;
    },
    createFolder: async () => {},
  } as any;
  return { vault } as any;
}

describe("File Commands", () => {
  let app: any;
  let history: CommandHistory;
  const filePath = "Test.md";

  beforeEach(() => {
    app = createStubApp();
    history = new CommandHistory(10);
  });

  it("CreateFileCommand creates and deletes", async () => {
    const createCmd = new CreateFileCommand(app, filePath, "hello");
    await history.execute(createCmd);
    expect((await (app.vault as any).read({ path: filePath })).trim()).toBe("hello");
    await history.undo();
    expect((app.vault as any).getAbstractFileByPath(filePath)).toBeNull();
  });

  it("OverwriteFileCommand swaps content", async () => {
    // prepare existing file
    await (app.vault as any).create(filePath, "old");
    const overwrite = new OverwriteFileCommand(app, filePath, "new");
    await history.execute(overwrite);
    expect((await (app.vault as any).read({ path: filePath }))).toBe("new");
    await history.undo();
    expect((await (app.vault as any).read({ path: filePath }))).toBe("old");
  });

  it("AppendToFileCommand appends", async () => {
    await (app.vault as any).create(filePath, "line");
    const append = new AppendToFileCommand(app, filePath, "\nmore");
    await history.execute(append);
    expect((await (app.vault as any).read({ path: filePath }))).toBe("line\nmore");
    await history.undo();
    expect((await (app.vault as any).read({ path: filePath }))).toBe("line");
  });

  it("DeleteFileCommand deletes and restores", async () => {
    await (app.vault as any).create(filePath, "content");
    const del = new DeleteFileCommand(app, filePath);
    await history.execute(del);
    expect((app.vault as any).getAbstractFileByPath(filePath)).toBeNull();
    await history.undo();
    expect((await (app.vault as any).read({ path: filePath }))).toBe("content");
  });
});