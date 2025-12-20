import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import type ICaptureChoice from '../types/choices/ICaptureChoice';

vi.mock('../utilityObsidian', () => ({
  templaterParseTemplate: vi.fn().mockResolvedValue(null),
}));

vi.mock('../gui/InputPrompt', () => ({
  __esModule: true,
  default: class {
    factory() {
      return {
        Prompt: vi.fn().mockResolvedValue(''),
      } as any;
    }
  },
}));

vi.mock('../gui/InputSuggester/inputSuggester', () => ({
  __esModule: true,
  default: class {
    constructor() {}
  },
}));

vi.mock('../gui/GenericSuggester/genericSuggester', () => ({
  __esModule: true,
  default: {
    Suggest: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('../gui/VDateInputPrompt/VDateInputPrompt', () => ({
  __esModule: true,
  default: {
    Prompt: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('../gui/MathModal', () => ({
  __esModule: true,
  MathModal: {
    Prompt: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('../engine/SingleInlineScriptEngine', () => ({
  __esModule: true,
  SingleInlineScriptEngine: class {
    public params = { variables: {} as Record<string, unknown> };
    constructor() {}
    async runAndGetOutput() {
      return '';
    }
  },
}));

vi.mock('../engine/SingleMacroEngine', () => ({
  __esModule: true,
  SingleMacroEngine: class {
    constructor() {}
    async runAndGetOutput() {
      return '';
    }
  },
}));

vi.mock('../engine/SingleTemplateEngine', () => ({
  __esModule: true,
  SingleTemplateEngine: class {
    constructor() {}
    async run() {
      return '';
    }
    getAndClearTemplatePropertyVars() {
      return new Map();
    }
    setLinkToCurrentFileBehavior() {}
  },
}));

vi.mock('obsidian-dataview', () => ({
  __esModule: true,
  getAPI: vi.fn().mockReturnValue(null),
}));

vi.mock('../main', () => ({
  __esModule: true,
  default: class QuickAdd {
    static instance = {
      settings: { inputPrompt: 'single-line' },
      app: { workspace: { getActiveViewOfType: vi.fn().mockReturnValue(null) } },
    };
    settings = QuickAdd.instance.settings;
    app = QuickAdd.instance.app;
  },
}));

import { CaptureChoiceFormatter } from './captureChoiceFormatter';

const createChoice = (overrides: Partial<ICaptureChoice> = {}): ICaptureChoice => ({
  id: 'test',
  name: 'Test Choice',
  type: 'Capture',
  command: false,
  captureTo: '',
  captureToActiveFile: true,
  createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: '' },
  format: { enabled: false, format: '' },
  prepend: false,
  appendLink: false,
  task: false,
  insertAfter: { enabled: false, after: '', insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: '' },
  newLineCapture: { enabled: false, direction: 'below' },
  openFile: false,
  fileOpening: { location: 'tab', direction: 'vertical', mode: 'default', focus: true },
  ...overrides,
});

const createMockApp = (): App => ({
  workspace: {
    getActiveFile: vi.fn().mockReturnValue(null),
    getActiveViewOfType: vi.fn().mockReturnValue(null),
  },
  metadataCache: {
    getFileCache: vi.fn().mockReturnValue(null),
  },
  fileManager: {
    generateMarkdownLink: vi.fn().mockReturnValue(''),
    processFrontMatter: vi.fn(),
  },
  vault: {
    adapter: { exists: vi.fn() },
    cachedRead: vi.fn(),
  },
} as unknown as App);

const createTFile = (path: string): TFile => {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.(md|canvas)$/i, ''),
    extension: path.endsWith('.md') ? 'md' : 'canvas',
  } as unknown as TFile;
};

describe('CaptureChoiceFormatter frontmatter handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Provide navigator clipboard shim for formatter fallback paths
    (global as any).navigator = {
      clipboard: {
        readText: vi.fn().mockResolvedValue(''),
      },
    };
  });

  it('inserts capture content below frontmatter when metadata cache is empty', async () => {
    const app = createMockApp();
    const plugin = {
      settings: {
        enableTemplatePropertyTypes: false,
        globalVariables: {},
        showCaptureNotification: false,
        showInputCancellationNotification: true,
      },
    } as any;
    const formatter = new CaptureChoiceFormatter(app, plugin);

    const choice = createChoice();
    const file = createTFile('New Note.md');
    const templateContent = ['---', 'tags: ["a"]', '---', '# Template Body'].join('\n');

    const result = await formatter.formatContentWithFile('Captured line\n', choice, templateContent, file);

    expect(result).toBe(['---', 'tags: ["a"]', '---', 'Captured line', '# Template Body'].join('\n'));
  });
});

describe('CaptureChoiceFormatter insert after blank lines', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (global as any).navigator = {
      clipboard: {
        readText: vi.fn().mockResolvedValue(''),
      },
    };
  });

  const createFormatter = () => {
    const app = createMockApp();
    const plugin = {
      settings: {
        enableTemplatePropertyTypes: false,
        globalVariables: {},
        showCaptureNotification: false,
        showInputCancellationNotification: true,
      },
    } as any;
    const formatter = new CaptureChoiceFormatter(app, plugin);
    const file = createTFile('Test.md');

    return { formatter, file };
  };

  const createInsertAfterChoice = (after: string): ICaptureChoice =>
    createChoice({
      insertAfter: {
        enabled: true,
        after,
        insertAtEnd: false,
        considerSubsections: false,
        createIfNotFound: false,
        createIfNotFoundLocation: '',
      },
    });

  it('skips one blank line after the match', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H');
    const fileContent = ['# H', '', 'A'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['# H', '', 'X', 'A'].join('\n'));
  });

  it('skips multiple blank lines after the match', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H');
    const fileContent = ['# H', '', '', 'A'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['# H', '', '', 'X', 'A'].join('\n'));
  });

  it('treats whitespace-only lines as blank', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H');
    const fileContent = ['# H', '   \t', 'A'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['# H', '   \t', 'X', 'A'].join('\n'));
  });

  it('keeps behavior unchanged when no blank lines follow', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H');
    const fileContent = ['# H', 'A'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['# H', 'X', 'A'].join('\n'));
  });

  it('keeps behavior unchanged when match is at EOF', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H');
    const fileContent = '# H';

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe('# H\nX\n');
  });

  it('handles CRLF content when skipping blank lines', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H');
    const fileContent = '# H\r\n\r\nA';

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe('# H\r\n\r\nX\nA');
  });
});
