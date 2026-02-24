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

vi.mock('../utils/errorUtils', () => ({
  __esModule: true,
  reportError: vi.fn(),
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
import { reportError } from '../utils/errorUtils';

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
  insertAfter: { enabled: false, after: '', insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: '', inline: false, replaceExisting: false, blankLineAfterMatchMode: 'auto' },
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

  const createInsertAfterChoice = (
    after: string,
    blankLineAfterMatchMode?: 'auto' | 'skip' | 'none',
  ): ICaptureChoice =>
    createChoice({
      insertAfter: {
        enabled: true,
        after,
        insertAtEnd: false,
        considerSubsections: false,
        createIfNotFound: false,
        createIfNotFoundLocation: '',
        blankLineAfterMatchMode,
      },
    });

  it('auto mode skips one blank line after a heading match', async () => {
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

  it('auto mode skips multiple blank lines after a heading match', async () => {
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

  it('auto mode treats whitespace-only lines as blank', async () => {
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

  it('auto mode keeps behavior unchanged when no blank lines follow', async () => {
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

  it('auto mode keeps behavior unchanged when match is at EOF', async () => {
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

  it('auto mode handles CRLF content when skipping blank lines', async () => {
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

  it('auto mode does not skip blanks for non-heading matches', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('- Item 1');
    const fileContent = ['- Item 1', '', '- Item 2'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['- Item 1', 'X', '', '- Item 2'].join('\n'));
  });

  it('always skip mode skips blank lines after non-heading matches', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('- Item 1', 'skip');
    const fileContent = ['- Item 1', '', '- Item 2'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['- Item 1', '', 'X', '- Item 2'].join('\n'));
  });

  it('never skip mode inserts immediately after the match', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H', 'none');
    const fileContent = ['# H', '', 'A'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['# H', 'X', '', 'A'].join('\n'));
  });
});

describe('CaptureChoiceFormatter insert after end-of-section spacing', () => {
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
    const file = createTFile('EndOfSection.md');

    return { app, formatter, file };
  };

  const createInsertAfterChoice = (
    after: string,
    overrides: Partial<ICaptureChoice['insertAfter']> = {},
  ): ICaptureChoice =>
    createChoice({
      insertAfter: {
        enabled: true,
        after,
        insertAtEnd: true,
        considerSubsections: false,
        createIfNotFound: false,
        createIfNotFoundLocation: '',
        inline: false,
        replaceExisting: false,
        blankLineAfterMatchMode: 'auto',
        ...overrides,
      },
    });

  it('preserves trailing format spacing across repeated insert-at-end captures at EOF', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# Journal');
    const initial = ['# Journal', '', '10:00', 'Some data', ''].join('\n');

    const first = await formatter.formatContentWithFile(
      '18:11\nTest\n\n',
      choice,
      initial,
      file,
    );

    const second = await formatter.formatContentWithFile(
      '18:12\nTest2\n\n',
      choice,
      first,
      file,
    );

    expect(second).toBe(
      ['# Journal', '', '10:00', 'Some data', '18:11', 'Test', '', '18:12', 'Test2', '', ''].join('\n'),
    );
  });

  it('keeps expected spacing for leading-newline capture formats', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# Journal');
    const initial = ['# Journal', '', '10:00', 'Some data', ''].join('\n');

    const first = await formatter.formatContentWithFile(
      '\n18:11\nTest3',
      choice,
      initial,
      file,
    );

    const second = await formatter.formatContentWithFile(
      '\n18:12\nTest4',
      choice,
      first,
      file,
    );

    expect(second).toBe(
      ['# Journal', '', '10:00', 'Some data', '', '18:11', 'Test3', '', '18:12', 'Test4'].join('\n'),
    );
  });

  it('preserves spacing for non-heading insert-at-end targets at EOF', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('Target');
    const initial = ['Target', 'Existing', ''].join('\n');

    const first = await formatter.formatContentWithFile(
      'One\n\n',
      choice,
      initial,
      file,
    );

    const second = await formatter.formatContentWithFile(
      'Two\n\n',
      choice,
      first,
      file,
    );

    expect(second).toBe(['Target', 'Existing', 'One', '', 'Two', '', ''].join('\n'));
  });

  it('preserves insertion order when format has no trailing newline and EOF blanks exist', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# H');
    const initial = ['# H', 'A', '', ''].join('\n');

    const first = await formatter.formatContentWithFile(
      'X',
      choice,
      initial,
      file,
    );

    const second = await formatter.formatContentWithFile(
      'Y',
      choice,
      first,
      file,
    );

    expect(second).toBe(['# H', 'A', 'X', 'Y'].join('\n'));
  });

  it('does not change behavior when insert-at-end is disabled', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# Journal', { insertAtEnd: false });
    const initial = ['# Journal', '', '10:00', 'Some data', ''].join('\n');

    const result = await formatter.formatContentWithFile(
      '18:13\nTest5\n\n',
      choice,
      initial,
      file,
    );

    expect(result).toBe(
      ['# Journal', '', '18:13', 'Test5', '', '10:00', 'Some data', ''].join('\n'),
    );
  });

  it('uses EOF spacing logic when create-if-not-found inserts at cursor with insert-at-end', async () => {
    const { app, formatter, file } = createFormatter();
    const choice = createInsertAfterChoice('# Missing', {
      createIfNotFound: true,
      createIfNotFoundLocation: 'cursor',
    });
    (app.workspace.getActiveViewOfType as any).mockReturnValue({
      editor: {
        getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
        getSelection: vi.fn().mockReturnValue(''),
      },
    });
    const initial = ['# Journal', '', '10:00', 'Some data', '', ''].join('\n');

    const result = await formatter.formatContentWithFile(
      '18:14\nTest6\n\n',
      choice,
      initial,
      file,
    );

    expect(result).toBe(
      ['# Journal', '', '10:00', 'Some data', '', '# Missing', '18:14', 'Test6', '', ''].join('\n'),
    );
  });
});

describe('CaptureChoiceFormatter insert after inline', () => {
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
    const file = createTFile('Inline.md');

    return { formatter, file };
  };

  const createInlineChoice = (
    after: string,
    overrides: Partial<ICaptureChoice['insertAfter']> = {},
  ): ICaptureChoice =>
    createChoice({
      insertAfter: {
        enabled: true,
        after,
        insertAtEnd: false,
        considerSubsections: false,
        createIfNotFound: false,
        createIfNotFoundLocation: 'top',
        inline: true,
        replaceExisting: false,
        blankLineAfterMatchMode: 'auto',
        ...overrides,
      },
    });

  it('inserts inline at match end and preserves suffix', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('Status:', { replaceExisting: false });
    const fileContent = 'Status: pending';

    const result = await formatter.formatContentWithFile(
      ' done',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe('Status: done pending');
  });

  it('replaces to end-of-line when enabled, preserving newline', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('Status: ', { replaceExisting: true });
    const fileContent = ['Status: pending', 'Next'].join('\n');

    const result = await formatter.formatContentWithFile(
      'done',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['Status: done', 'Next'].join('\n'));
  });

  it('replace mode behaves like append when target is at end-of-line', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('pending', { replaceExisting: true });
    const fileContent = 'Status: pending';

    const result = await formatter.formatContentWithFile(
      '!',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe('Status: pending!');
  });

  it('creates a single inline line when target is not found', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('Status: ', {
      createIfNotFound: true,
      createIfNotFoundLocation: 'top',
    });
    const fileContent = '# Header';

    const result = await formatter.formatContentWithFile(
      'done',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['Status: done', '# Header'].join('\n'));
  });

  it('does not modify the file when target is missing and create-if-not-found is off', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('Missing: ', { createIfNotFound: false });
    const fileContent = 'Status: pending';

    const result = await formatter.formatContentWithFile(
      'done',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(fileContent);
    expect(reportError).toHaveBeenCalled();
  });

  it('updates only the first match', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('Tag: ', { replaceExisting: true });
    const fileContent = ['Tag: a', 'Tag: b'].join('\n');

    const result = await formatter.formatContentWithFile(
      'X',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(['Tag: X', 'Tag: b'].join('\n'));
  });

  it('works with capture to active file enabled', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('Status: ', { replaceExisting: true });
    choice.captureToActiveFile = true;
    const fileContent = 'Status: pending';

    const result = await formatter.formatContentWithFile(
      'done',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe('Status: done');
  });

  it('reports an error and leaves content unchanged when target contains a newline', async () => {
    const { formatter, file } = createFormatter();
    const choice = createInlineChoice('Status:\n', { replaceExisting: true });
    const fileContent = 'Status:\npending';

    const result = await formatter.formatContentWithFile(
      'done',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe(fileContent);
    expect(reportError).toHaveBeenCalled();
  });
});

describe('CaptureChoiceFormatter append task newline regression (issue #124)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (global as any).navigator = {
      clipboard: {
        readText: vi.fn().mockResolvedValue(''),
      },
    };
  });

  it('inserts a newline before an appended task when the file does not end with a newline', async () => {
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

    const choice = createChoice({ prepend: true, task: true });
    const file = createTFile('Test.md');
    const fileContent = '- [ ] Old task';

    const result = await formatter.formatContentWithFile(
      '- [ ] New task\n',
      choice,
      fileContent,
      file,
    );

    expect(result).toBe('- [ ] Old task\n- [ ] New task\n');
  });
});
