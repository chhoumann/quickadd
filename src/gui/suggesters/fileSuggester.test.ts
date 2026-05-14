import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { App, TFile, Vault, MetadataCache, Workspace, Plugin } from 'obsidian';
import { TFile as RuntimeTFile } from 'obsidian';
import { FileIndex } from './FileIndex';
import { FileSuggester } from './fileSuggester';
import { renderExactHighlight } from './utils';

vi.mock('./suggest', () => {
    function getOwnerDocument(node: Node): Document {
        if (node.nodeType === Node.DOCUMENT_NODE) {
            return node as Document;
        }
        return node.ownerDocument ?? document;
    }

    class TestScope {
        private callbacks = new Map<string, (event: any) => unknown>();

        register(_hotkeys: any[], key: string, callback: (event: any) => unknown) {
            this.callbacks.set(key, callback);
        }

        trigger(key: string, event: any = { isComposing: false }): unknown {
            return this.callbacks.get(key)?.(event);
        }
    }

    class TestSuggest<T> {
        private values: T[] = [];
        private suggestions: HTMLDivElement[] = [];
        private selectedItem = 0;
        private isOpen = false;

        constructor(
            private owner: {
                renderSuggestion(item: T, el: HTMLElement): void;
                selectSuggestion(item: T, event: MouseEvent | KeyboardEvent): unknown;
            },
            private containerEl: HTMLElement,
            private scope: TestScope,
        ) {
            scope.register([], 'ArrowUp', (event: KeyboardEvent) => {
                if (!event.isComposing && this.isOpen) {
                    this.setSelectedItem(this.selectedItem - 1, true);
                    return false;
                }
            });
            scope.register([], 'ArrowDown', (event: KeyboardEvent) => {
                if (!event.isComposing && this.isOpen) {
                    this.setSelectedItem(this.selectedItem + 1, true);
                    return false;
                }
            });
            scope.register([], 'Enter', (event: KeyboardEvent) => {
                if (!event.isComposing && this.isOpen) {
                    return this.useSelectedItem(event);
                }
            });
            scope.register([], 'PageUp', (event: KeyboardEvent) => {
                if (!event.isComposing && this.isOpen) {
                    this.setSelectedItem(Math.max(0, this.selectedItem - 5), true);
                    return false;
                }
            });
            scope.register([], 'PageDown', (event: KeyboardEvent) => {
                if (!event.isComposing && this.isOpen) {
                    this.setSelectedItem(
                        Math.min(this.suggestions.length - 1, this.selectedItem + 5),
                        true,
                    );
                    return false;
                }
            });
        }

        setSuggestions(values: T[]) {
            this.containerEl.replaceChildren();
            this.values = values;
            this.suggestions = values.map((value, index) => {
                const suggestionEl = this.containerEl.ownerDocument.createElement('div');
                suggestionEl.className = 'suggestion-item';
                suggestionEl.setAttribute('role', 'option');
                suggestionEl.setAttribute('aria-selected', 'false');
                suggestionEl.setAttribute('id', `suggestion-${index}`);
                this.owner.renderSuggestion(value, suggestionEl);
                this.containerEl.appendChild(suggestionEl);
                return suggestionEl;
            });
            this.setSelectedItem(0, false);
            this.isOpen = values.length > 0;
        }

        private useSelectedItem(event: KeyboardEvent): unknown {
            const currentValue = this.values[this.selectedItem];
            if (!currentValue) return undefined;
            return this.owner.selectSuggestion(currentValue, event);
        }

        private setSelectedItem(selectedIndex: number, scrollIntoView: boolean) {
            if (!this.suggestions.length) return;

            const normalizedIndex = ((selectedIndex % this.suggestions.length)
                + this.suggestions.length) % this.suggestions.length;
            const prevSelectedSuggestion = this.suggestions[this.selectedItem];
            const selectedSuggestion = this.suggestions[normalizedIndex];

            prevSelectedSuggestion?.classList.remove('is-selected');
            selectedSuggestion?.classList.add('is-selected');
            prevSelectedSuggestion?.setAttribute('aria-selected', 'false');
            selectedSuggestion?.setAttribute('aria-selected', 'true');
            this.selectedItem = normalizedIndex;

            if (scrollIntoView) {
                selectedSuggestion.scrollIntoView?.(false);
            }
        }
    }

    class TextInputSuggest<T> {
        protected renderMatch = (el: HTMLElement, text: string, query: string) => {
            if (!query) {
                el.textContent = text;
                return;
            }

            const index = text.toLowerCase().indexOf(query.toLowerCase());
            if (index === -1) {
                el.textContent = text;
                return;
            }

            const ownerDocument = el.ownerDocument;
            el.append(
                ownerDocument.createTextNode(text.slice(0, index)),
                Object.assign(ownerDocument.createElement('mark'), {
                    className: 'qa-highlight',
                    textContent: text.slice(index, index + query.length),
                }),
                ownerDocument.createTextNode(text.slice(index + query.length)),
            );
        };
        private scope: TestScope;
        private suggest: TestSuggest<T>;
        private suggestEl: HTMLElement;

        constructor(
            protected app: unknown,
            protected inputEl: HTMLInputElement | HTMLTextAreaElement,
        ) {
            this.scope = new TestScope();
            const ownerDocument = this.inputEl.ownerDocument;
            this.suggestEl = ownerDocument.createElement('div');
            this.suggestEl.className = 'suggestion-container';
            const suggestion = ownerDocument.createElement('div');
            suggestion.className = 'suggestion';
            suggestion.setAttribute('role', 'listbox');
            suggestion.setAttribute('aria-label', 'Suggestions');
            this.suggestEl.appendChild(suggestion);
            this.suggest = new TestSuggest<T>(
                this as unknown as {
                    renderSuggestion(item: T, el: HTMLElement): void;
                    selectSuggestion(item: T, event: MouseEvent | KeyboardEvent): unknown;
                },
                suggestion,
                this.scope,
            );
        }

        open(container: HTMLElement, inputEl: HTMLElement = this.inputEl): void {
            const inputDocument = getOwnerDocument(inputEl);
            const containerDocument = getOwnerDocument(container);
            const ownerCompatibleContainer =
                containerDocument === inputDocument ? container : inputDocument.body;
            ownerCompatibleContainer.appendChild(this.suggestEl);
            this.inputEl.setAttribute('aria-expanded', 'true');
        }

        close(): void {
            this.suggest.setSuggestions([]);
            this.suggestEl.remove();
            this.inputEl.setAttribute('aria-expanded', 'false');
        }

        destroy(): void {
            this.close();
        }
    }

    return { TextInputSuggest };
});

vi.mock("../../main", () => ({
    default: {
        instance: {
            registerEvent: vi.fn(),
        },
    },
}));

// Mock Plugin
const mockPlugin = {
    registerEvent: vi.fn(),
} as unknown as Plugin;

// Mock Obsidian types
const mockApp = {
    vault: {
        getFiles: vi.fn(),
        getMarkdownFiles: vi.fn(),
        getAbstractFileByPath: vi.fn(),
        on: vi.fn(),
    } as unknown as Vault,
    metadataCache: {
        getFileCache: vi.fn(),
        resolvedLinks: {},
        unresolvedLinks: {},
        on: vi.fn(),
    } as unknown as MetadataCache,
    workspace: {
        on: vi.fn(),
    } as unknown as Workspace,
};

function createMockFile(path: string, basename: string): TFile {
    return {
        path,
        basename,
        name: basename,
        extension: path.split('.').pop() || 'md',
        parent: null,
        vault: mockApp.vault,
        stat: {
            mtime: Date.now(),
            ctime: Date.now(),
            size: 100,
        },
    } as TFile;
}

function createIndexedFile(path: string, basename: string) {
    return {
        path,
        pathNormalized: path.toLowerCase(),
        basename,
        basenameNormalized: basename.toLowerCase(),
        aliases: [],
        aliasesNormalized: [],
        headings: [],
        blockIds: [],
        tags: [],
        modified: Date.now(),
        folder: path.includes('/') ? path.split('/').slice(0, -1).join('/') : '',
    };
}

function createRuntimeFile(path: string, basename: string): TFile {
    const file = new RuntimeTFile();
    file.path = path;
    file.basename = basename;
    file.name = path.split('/').pop() ?? basename;
    file.extension = path.split('.').pop() ?? 'md';
    file.parent = null;
    (file as TFile).stat = {
        ctime: 0,
        mtime: new Date('2024-01-01T00:00:00Z').getTime(),
        size: 1,
    };
    return file as TFile;
}

function expectNoPayloadDom(el: HTMLElement): void {
    expect(el.querySelector('img, script, svg')).toBeNull();
    expect((globalThis as typeof globalThis & { __qaXss?: number }).__qaXss)
        .toBeUndefined();
}

describe('FileSuggester - Issue #838 and #839', () => {
    let fileIndex: FileIndex;
    let files: TFile[];

    beforeEach(async () => {
        // Reset the singleton instance
        (FileIndex as any).instance = null;
        // Setup test files that reproduce the issues
        files = [
            // Issue #838 - exact short identifier should appear first
            createMockFile('Notes/gbtJAG5KAO1NU4KdDKzMe.md', 'gbtJAG5KAO1NU4KdDKzMe'),
            createMockFile('Archive/General Business Terms.md', 'General Business Terms'),
            createMockFile('Projects/GBT Analysis.md', 'GBT Analysis'),
            
            // Issue #839 - exact title match should be first
            createMockFile('Daily/2024-01-15.md', '2024-01-15'),
            createMockFile('Templates/Daily Note Template.md', 'Daily Note Template'),
            createMockFile('Archive/2024-01-15-meeting.md', '2024-01-15-meeting'),
            
            // Additional test cases
            createMockFile('Notes/Planning.md', 'Planning'),
            createMockFile('Notes/Plan.md', 'Plan'),
            createMockFile('Projects/Project Planning Guide.md', 'Project Planning Guide'),
        ];

        vi.mocked(mockApp.vault.getFiles).mockReturnValue(files);
        vi.mocked(mockApp.vault.getMarkdownFiles).mockReturnValue(files);
        vi.mocked(mockApp.metadataCache.getFileCache).mockReturnValue(null);

        fileIndex = FileIndex.getInstance(mockApp as App, mockPlugin);
        await fileIndex.ensureIndexed();
    });

    describe('Issue #838 - Short exact identifiers appear first', () => {
        it('should rank exact basename match first even with short cryptic names', () => {
            const query = 'gbtJAG5KAO1NU4KdDKzMe';
            const results = fileIndex.search(query);
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].file.path).toBe('Notes/gbtJAG5KAO1NU4KdDKzMe.md');
            expect(results[0].file.basename).toBe('gbtJAG5KAO1NU4KdDKzMe');
        });

        it('should rank exact match first even when other files have similar prefixes', () => {
            const query = 'gbt';
            const results = fileIndex.search(query);
            
            // Files starting with 'gbt' should be prioritized
            const topResults = results.slice(0, 2);
            const gbtFiles = topResults.filter(f => f.file.basename.toLowerCase().startsWith('gbt'));
            expect(gbtFiles.length).toBeGreaterThan(0);
        });
    });

    describe('Issue #839 - Exact title matches always rank first', () => {
        it('should rank exact basename match as #1 result', () => {
            const query = '2024-01-15';
            const results = fileIndex.search(query);
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].file.path).toBe('Daily/2024-01-15.md');
            expect(results[0].file.basename).toBe('2024-01-15');
        });

        it('should rank exact match first even with longer similar files', () => {
            const query = 'Plan';
            const results = fileIndex.search(query);
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].file.path).toBe('Notes/Plan.md');
            expect(results[0].file.basename).toBe('Plan');
            
            // Planning.md should come after Plan.md
            const planningIndex = results.findIndex(f => f.file.basename === 'Planning');
            expect(planningIndex).toBeGreaterThan(0);
        });
    });

    describe('Tier-based ranking', () => {
        it('should separate exact matches from fuzzy matches', () => {
            const query = 'Daily Note Template';
            const results = fileIndex.search(query);
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].file.path).toBe('Templates/Daily Note Template.md');
            expect(results[0].file.basename).toBe('Daily Note Template');
        });

        it('should prioritize prefix matches over fuzzy matches', () => {
            const query = 'Plan';
            const results = fileIndex.search(query);
            
            // Expect: 1. Plan.md (exact), 2. Planning.md (prefix), 3. Project Planning Guide.md (contains)
            expect(results[0].file.basename).toBe('Plan');
            expect(results[1].file.basename).toBe('Planning');
            
            const projectPlanningIndex = results.findIndex(f => f.file.basename === 'Project Planning Guide');
            expect(projectPlanningIndex).toBeGreaterThan(1);
        });
    });

    describe('Case insensitive matching', () => {
        it('should find exact matches regardless of case', () => {
            const query = 'PLAN';
            const results = fileIndex.search(query);
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].file.basename).toBe('Plan');
        });

        it('should handle mixed case queries', () => {
            const query = 'gBtJaG5kao1nu4kddkzme';
            const results = fileIndex.search(query);
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].file.basename).toBe('gbtJAG5KAO1NU4KdDKzMe');
        });
    });
    
    describe('Basename-exact vs Alias-exact ranking', () => {
        it('should rank basename-exact match before alias-exact match', async () => {
            // Reset the singleton instance
            (FileIndex as any).instance = null;
            
            // Create files where one has the query as basename, another as alias
            const testFiles = [
                createMockFile('Notes/MyFile.md', 'MyFile'),
                createMockFile('Notes/Test.md', 'Test'), // Will have 'MyFile' as alias
            ];
            
            // Mock metadata to add alias
            vi.mocked(mockApp.metadataCache.getFileCache).mockImplementation((file: TFile) => {
                if (file.basename === 'Test') {
                    return {
                        frontmatter: {
                            aliases: ['MyFile'] // Exact match for query
                        }
                    };
                }
                return null;
            });
            
            vi.mocked(mockApp.vault.getFiles).mockReturnValue(testFiles);
            vi.mocked(mockApp.vault.getMarkdownFiles).mockReturnValue(testFiles);
            
            const testIndex = FileIndex.getInstance(mockApp as App, mockPlugin);
            await testIndex.ensureIndexed();
            
            const query = 'MyFile';
            const results = testIndex.search(query);
            
            // Should find both files
            expect(results.length).toBeGreaterThanOrEqual(2);
            
            // Basename-exact should be first
            expect(results[0].file.basename).toBe('MyFile');
            expect(results[0].matchType).toBe('exact');
            
            // Alias-exact should be second
            const aliasMatch = results.find(r => r.file.basename === 'Test');
            expect(aliasMatch).toBeDefined();
            expect(aliasMatch!.matchType).toBe('alias');
            
            // Verify ordering
            const basenameIndex = results.findIndex(r => r.file.basename === 'MyFile');
            const aliasIndex = results.findIndex(r => r.file.basename === 'Test');
            expect(basenameIndex).toBeLessThan(aliasIndex);
        });
    });

    describe('Issue #509 - Duplicate aliases should show multiple files', () => {
        it('should return all files that share the same exact alias', async () => {
            // Reset the singleton instance
            (FileIndex as any).instance = null;

            const testFiles = [
                createMockFile('Notes/Caleb.md', 'Caleb'),
                createMockFile('Notes/Zeb.md', 'Zeb'),
            ];

            vi.mocked(mockApp.metadataCache.getFileCache).mockImplementation((file: TFile) => {
                if (file.basename === 'Caleb' || file.basename === 'Zeb') {
                    return {
                        frontmatter: {
                            aliases: ['doctor']
                        }
                    };
                }
                return null;
            });

            vi.mocked(mockApp.vault.getFiles).mockReturnValue(testFiles);
            vi.mocked(mockApp.vault.getMarkdownFiles).mockReturnValue(testFiles);

            const testIndex = FileIndex.getInstance(mockApp as App, mockPlugin);
            await testIndex.ensureIndexed();

            const results = testIndex.search('doctor');
            expect(results.length).toBeGreaterThanOrEqual(2);

            const doctorMatches = results.filter(r => r.matchType === 'alias' && r.displayText === 'doctor');
            expect(doctorMatches.some(r => r.file.basename === 'Caleb')).toBe(true);
            expect(doctorMatches.some(r => r.file.basename === 'Zeb')).toBe(true);
        });
    });
});

describe('FileSuggester DOM XSS safety', () => {
    beforeEach(() => {
        delete (globalThis as typeof globalThis & { __qaXss?: number }).__qaXss;
    });

    it('renders malicious file paths and basenames as text', () => {
        const payload = '<img src=x onerror=globalThis.__qaXss=1>';
        const el = document.createElement('div');

        FileSuggester.prototype.renderSuggestion.call(
            {
                addHoverTooltip: vi.fn(),
            },
            {
                file: createIndexedFile(`Notes/${payload}.md`, payload),
                score: 0,
                matchType: 'exact',
                displayText: payload,
            },
            el,
        );

        expect(el.textContent).toContain(payload);
        expect(el.textContent).toContain(`Notes/${payload}.md`);
        expectNoPayloadDom(el);
    });

    it('renders malicious heading text safely while preserving highlighting', () => {
        const payload = '<svg onload=globalThis.__qaXss=1>Danger</svg>';
        const el = document.createElement('div');

        FileSuggester.prototype.renderSuggestion.call(
            {
                lastInput: `Source#Danger`,
                addHoverTooltip: vi.fn(),
                renderMatch: renderExactHighlight,
            },
            {
                file: createIndexedFile('Source.md', 'Source'),
                score: 0,
                matchType: 'heading',
                displayText: `Source#${payload}`,
            },
            el,
        );

        expect(el.textContent).toContain(payload);
        expect(el.querySelector('mark.qa-highlight')?.textContent).toBe('Danger');
        expectNoPayloadDom(el);
    });

    it('renders alias, unresolved, block, and attachment fields as text', () => {
        const payload = '<img src=x onerror=globalThis.__qaXss=1>';
        const cases = [
            {
                matchType: 'alias' as const,
                displayText: payload,
                expectedText: payload,
            },
            {
                matchType: 'unresolved' as const,
                displayText: payload,
                expectedText: payload,
            },
            {
                matchType: 'block' as const,
                displayText: `Block Source#^${payload}`,
                expectedText: payload,
            },
            {
                matchType: 'fuzzy' as const,
                displayText: payload,
                expectedText: payload,
            },
        ];

        for (const testCase of cases) {
            const el = document.createElement('div');
            FileSuggester.prototype.renderSuggestion.call(
                {
                    addHoverTooltip: vi.fn(),
                },
                {
                    file: createIndexedFile(`Notes/${payload}.md`, payload),
                    score: 0,
                    ...testCase,
                },
                el,
            );

            expect(el.textContent).toContain(testCase.expectedText);
            expectNoPayloadDom(el);
        }
    });

    it('renders tooltip metadata as text', () => {
        const payload = '<img src=x onerror=globalThis.__qaXss=1>';
        const obsidianFile = createRuntimeFile(`Notes/${payload}.md`, payload);

        const tooltip = (
            FileSuggester.prototype as unknown as {
                createTooltip(this: unknown, file: { path: string }): HTMLElement | null;
            }
        ).createTooltip.call(
            {
                inputEl: document.createElement('input'),
                app: {
                    vault: {
                        getAbstractFileByPath: vi.fn(() => obsidianFile),
                    },
                },
            },
            { path: obsidianFile.path },
        );

        expect(tooltip).not.toBeNull();
        expect(tooltip?.textContent).toContain(payload);
        expect(tooltip?.textContent).toContain(`Path: Notes/${payload}.md`);
        expectNoPayloadDom(tooltip!);
    });

    it('uses the input owner document for suggestions, tooltips, timers, and cleanup', () => {
        vi.useFakeTimers();
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const popoutDocument = frame.contentDocument!;
        const popoutWindow = frame.contentWindow!;
        const inputEl = popoutDocument.createElement('input');
        popoutDocument.body.appendChild(inputEl);

        const obsidianFile = createRuntimeFile('Popout.md', 'Popout');
        const app = {
            dom: { appContainerEl: document.body },
            keymap: {
                pushScope: vi.fn(),
                popScope: vi.fn(),
            },
            workspace: {
                getActiveFile: vi.fn(() => null),
                on: vi.fn(() => ({})),
            },
            fileManager: {
                getNewFileParent: vi.fn(() => ({ path: '' })),
            },
            vault: {
                getAbstractFileByPath: vi.fn(() => obsidianFile),
                getFiles: vi.fn(() => []),
                getMarkdownFiles: vi.fn(() => []),
                on: vi.fn(),
            },
            metadataCache: {
                on: vi.fn(),
                getFileCache: vi.fn(),
                unresolvedLinks: {},
            },
        };

        const plugin = { registerEvent: vi.fn() };
        (FileIndex as unknown as { instance?: FileIndex }).instance = new (
            FileIndex as unknown as new (app: App, plugin: unknown) => FileIndex
        )(app as unknown as App, plugin);

        try {
            const suggester = new FileSuggester(app as unknown as App, inputEl);
            (suggester as unknown as { lastInput: string }).lastInput = 'Pop';
            (suggester as unknown as {
                suggest: { setSuggestions(values: unknown[]): void };
            }).suggest.setSuggestions([
                {
                    file: createIndexedFile('Popout.md', 'Popout'),
                    score: 0,
                    matchType: 'exact' as const,
                    displayText: 'Popout',
                },
            ]);
            suggester.open(document.body, inputEl);

            const suggestion = popoutDocument.querySelector<HTMLElement>('.suggestion-item')!;
            expect(suggestion).not.toBeNull();
            expect(document.querySelector('.suggestion-item')).toBeNull();

            suggestion.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: true,
                view: popoutWindow,
            }));
            vi.advanceTimersByTime(200);

            const tooltip = popoutDocument.querySelector('.qa-file-tooltip');
            expect(tooltip).not.toBeNull();
            expect(document.querySelector('.qa-file-tooltip')).toBeNull();

            suggester.destroy();
            expect(popoutDocument.querySelector('.suggestion-container')).toBeNull();
            expect(popoutDocument.querySelector('.qa-file-tooltip')).toBeNull();
        } finally {
            frame.remove();
            vi.useRealTimers();
        }
    });

    it('keeps malicious suggestions selectable by keyboard navigation', async () => {
        const payload = '<img src=x onerror=globalThis.__qaXss=1>';
        const insertedValues: string[] = [];
        const runtimeFiles = new Map([
            [
                `Notes/${payload}.md`,
                createRuntimeFile(`Notes/${payload}.md`, payload),
            ],
            [
                `Fuzzy/${payload} attachment.png`,
                createRuntimeFile(`Fuzzy/${payload} attachment.png`, `${payload} attachment`),
            ],
            [
                `Aliases/${payload}.md`,
                createRuntimeFile(`Aliases/${payload}.md`, payload),
            ],
        ]);
        const inputEl = document.createElement('input');
        inputEl.value = `before [[${payload}]] after`;
        inputEl.setSelectionRange(
            `before [[${payload}`.length,
            `before [[${payload}`.length,
        );
        inputEl.trigger = vi.fn();

        const app = {
            dom: { appContainerEl: document.body },
            keymap: {
                pushScope: vi.fn(),
                popScope: vi.fn(),
            },
            workspace: {
                getActiveFile: vi.fn(() => null),
            },
            fileManager: {
                getNewFileParent: vi.fn(() => ({ path: '' })),
                generateMarkdownLink: vi.fn((file: TFile, _source: string, _sub: string, alias: string) => {
                    const link = alias ? `[[${file.basename}|${alias}]]` : `[[${file.basename}]]`;
                    insertedValues.push(link);
                    return link;
                }),
            },
            vault: {
                getAbstractFileByPath: vi.fn((path: string) => runtimeFiles.get(path) ?? null),
                getFiles: vi.fn(() => Array.from(runtimeFiles.values())),
            },
        };
        const suggestions = [
            {
                kind: 'exact',
                expectedValue: `[[${payload}]]`,
                item: {
                    file: createIndexedFile(`Notes/${payload}.md`, payload),
                    score: 0,
                    matchType: 'exact' as const,
                    displayText: payload,
                },
            },
            {
                kind: 'fuzzy',
                expectedValue: `[[${payload} attachment]]`,
                item: {
                    file: createIndexedFile(`Fuzzy/${payload} attachment.png`, `${payload} attachment`),
                    score: 1,
                    matchType: 'fuzzy' as const,
                    displayText: `${payload} attachment.png`,
                },
            },
            {
                kind: 'alias',
                expectedValue: `[[${payload}|${payload} alias]]`,
                item: {
                    file: createIndexedFile(`Aliases/${payload}.md`, payload),
                    score: 0,
                    matchType: 'alias' as const,
                    displayText: `${payload} alias`,
                },
            },
            {
                kind: 'heading',
                expectedValue: `Source#${payload} Heading`,
                item: {
                    file: createIndexedFile('Source.md', 'Source'),
                    score: 0,
                    matchType: 'heading' as const,
                    displayText: `Source#${payload} Heading`,
                },
            },
            {
                kind: 'block',
                expectedValue: `Source#^${payload}-block`,
                item: {
                    file: createIndexedFile('Source.md', 'Source'),
                    score: 0,
                    matchType: 'block' as const,
                    displayText: `Source#^${payload}-block`,
                },
            },
            {
                kind: 'unresolved',
                expectedValue: `before [[${payload}]]]] after`,
                item: {
                    file: createIndexedFile(`${payload}.md`, payload),
                    score: 0,
                    matchType: 'unresolved' as const,
                    displayText: payload,
                },
            },
            {
                kind: 'attachment',
                expectedValue: `${payload} attachment.png`,
                item: {
                    file: createIndexedFile(`Attachments/${payload} attachment.png`, `${payload} attachment`),
                    score: 0,
                    matchType: 'exact' as const,
                    displayText: `${payload} attachment.png`,
                },
            },
        ];

        for (const { kind, item, expectedValue } of suggestions) {
            const suggester = new FileSuggester(app as unknown as App, inputEl);
            (suggester as unknown as { lastInput: string }).lastInput = payload;
            (suggester as unknown as {
                suggest: { setSuggestions(values: unknown[]): void };
            }).suggest.setSuggestions(suggestions.map(({ item }) => item));
            suggester.open(document.body, inputEl);

            const scope = (suggester as unknown as {
                scope: { trigger(key: string): unknown };
            }).scope;
            const items = Array.from(
                document.querySelectorAll<HTMLElement>('.suggestion-item'),
            );

            expect(items).toHaveLength(suggestions.length);
            for (const el of items) {
                expect(el.textContent).toContain(payload);
                expectNoPayloadDom(el);
            }

            expect(items[0].getAttribute('aria-selected')).toBe('true');
            scope.trigger('ArrowDown');
            expect(items[1].getAttribute('aria-selected')).toBe('true');
            expect(items[0].getAttribute('aria-selected')).toBe('false');
            scope.trigger('ArrowUp');
            expect(items[0].getAttribute('aria-selected')).toBe('true');
            scope.trigger('PageDown');
            expect(items[5].getAttribute('aria-selected')).toBe('true');
            scope.trigger('PageUp');
            expect(items[0].getAttribute('aria-selected')).toBe('true');

            const targetIndex = suggestions.findIndex((candidate) => candidate.item === item);
            for (let i = 0; i < targetIndex; i += 1) {
                scope.trigger('ArrowDown');
            }

            expect(items[targetIndex].getAttribute('aria-selected')).toBe('true');
            await scope.trigger('Enter');

            if (kind === 'exact' || kind === 'fuzzy' || kind === 'alias') {
                expect(insertedValues.at(-1)).toBe(expectedValue);
            } else {
                expect(inputEl.value).toContain(expectedValue);
            }
            expectNoPayloadDom(document.body);

            suggester.destroy();
            inputEl.value = `before [[${payload}]] after`;
            inputEl.setSelectionRange(
                `before [[${payload}`.length,
                `before [[${payload}`.length,
            );
        }
    });
});

describe('FileSuggester - Substring search with long aliases', () => {
    let fileIndex: FileIndex;
    let files: TFile[];

    beforeEach(async () => {
        // Reset the singleton instance
        (FileIndex as any).instance = null;
        
        // Create generic test files that demonstrate the substring matching issue
        files = [
            createMockFile('Projects/Project Alpha.md', 'Project Alpha'),
            createMockFile('Projects/Project Beta Documentation.md', 'Project Beta Documentation'),
            createMockFile('Archive/Old Project Notes.md', 'Old Project Notes'),
            createMockFile('Planning/2025 Project Roadmap.md', '2025 Project Roadmap'),
            createMockFile('References/Project Management Guide.md', 'Project Management Guide'),
            createMockFile('Daily/2024-03-15.md', '2024-03-15'),
            createMockFile('Templates/Project Template.md', 'Project Template'),
        ];
        
        // Add aliases to simulate files with very long aliases
        vi.mocked(mockApp.metadataCache.getFileCache).mockImplementation((file: TFile) => {
            if (file.basename === 'Project Beta Documentation') {
                return {
                    frontmatter: {
                        aliases: ['Complete documentation for Project Beta including all technical specifications and implementation details']
                    }
                };
            }
            if (file.basename === '2024-03-15') {
                return {
                    frontmatter: {
                        aliases: ['Daily review of all ongoing projects and their current status updates']
                    }
                };
            }
            if (file.basename === 'Old Project Notes') {
                return {
                    frontmatter: {
                        aliases: ['Archived notes from previous projects that might be useful for reference']
                    }
                };
            }
            return null;
        });

        vi.mocked(mockApp.vault.getFiles).mockReturnValue(files);
        vi.mocked(mockApp.vault.getMarkdownFiles).mockReturnValue(files);

        fileIndex = FileIndex.getInstance(mockApp as App, mockPlugin);
        await fileIndex.ensureIndexed();
    });

    it('should prioritize basename substring matches over long alias matches', () => {
        const query = 'project';
        const results = fileIndex.search(query);
        
        // Files with "project" in the basename should appear before alias matches
        const projectAlpha = results.findIndex(r => r.file.basename === 'Project Alpha');
        const projectRoadmap = results.findIndex(r => r.file.basename === '2025 Project Roadmap');
        
        // Files that only match via long aliases should appear later
        const dailyNote = results.findIndex(r => r.file.basename === '2024-03-15');
        
        if (dailyNote !== -1) {
            expect(projectAlpha).toBeLessThan(dailyNote);
            expect(projectRoadmap).toBeLessThan(dailyNote);
        }
        
        // Verify that basename matches score better than alias matches
        const basenameMatches = results.filter(r => r.file.basename.toLowerCase().includes('project'));
        const aliasOnlyMatches = results.filter(r => 
            r.matchType === 'alias' && !r.file.basename.toLowerCase().includes('project')
        );
        
        if (basenameMatches.length > 0 && aliasOnlyMatches.length > 0) {
            const worstBasenameScore = Math.max(...basenameMatches.map(m => m.score));
            const bestAliasScore = Math.min(...aliasOnlyMatches.map(m => m.score));
            expect(worstBasenameScore).toBeLessThan(bestAliasScore); // Lower score = better ranking
        }
    });
});
