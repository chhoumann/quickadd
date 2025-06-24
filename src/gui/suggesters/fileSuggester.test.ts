import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { App, TFile, Vault, MetadataCache, Workspace, Plugin } from 'obsidian';
import { FileIndex } from './FileIndex';

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
});

describe('FileSuggester - Budget search example', () => {
    let fileIndex: FileIndex;
    let files: TFile[];

    beforeEach(async () => {
        // Reset the singleton instance
        (FileIndex as any).instance = null;
        
        // Create files that replicate the problematic budget search
        files = [
            createMockFile('Notes/2025 Budget Fælles.md', '2025 Budget Fælles'),
            createMockFile('People/Warren Buffett.md', 'Warren Buffett'),
            createMockFile('Quotes/What you get by achieving your goals.md', '` What you get by achieving your goals is not as important as what you become by achieving your goals'),
            createMockFile('Quotes/Ignorance more frequently begets confidence.md', '` Ignorance more frequently begets confidence than does knowledge'),
            createMockFile('Daily/210812 You can update your title.md', '210812 You can update your title and thumbnail until you get 8+ CTR after uploading'),
            createMockFile('Courses/MS27 Bliv personligt mere effektiv.md', '% MS27 Bliv personligt mere effektiv på studiet med disse to metoder'),
            createMockFile('Business/210829 You grow your business.md', '210829 You grow your business by getting more customers and by increasing each customers value'),
            createMockFile('Tech/2023-09-09 - CodeWars - Can you get the loop.md', '2023-09-09 - CodeWars - Can you get the loop'),
        ];
        
        // Add aliases to simulate the real scenario
        vi.mocked(mockApp.metadataCache.getFileCache).mockImplementation((file: TFile) => {
            if (file.basename === '% MS27 Bliv personligt mere effektiv på studiet med disse to metoder') {
                return {
                    frontmatter: {
                        aliases: ['MS27 Bliv personligt mere effektiv på studiet med disse to metoder']
                    }
                };
            }
            if (file.basename === '210829 You grow your business by getting more customers and by increasing each customers value') {
                return {
                    frontmatter: {
                        aliases: ['You grow your business by getting more customers and by increasing each customers value']
                    }
                };
            }
            if (file.basename === '2023-09-09 - CodeWars - Can you get the loop') {
                return {
                    frontmatter: {
                        aliases: ['CodeWars - Can you get the loop']
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

    it('should prioritize basename matches over alias matches for "budget"', () => {
        const query = 'budget';
        const results = fileIndex.search(query);
        
        // Log for debugging
        console.log('Budget search results:', results.map(r => ({
            basename: r.file.basename,
            score: r.score,
            matchType: r.matchType,
            displayText: r.displayText
        })));
        
        // "2025 Budget Fælles" should be at or near the top (substring match in basename)
        const budgetFileIndex = results.findIndex(r => r.file.basename === '2025 Budget Fælles');
        expect(budgetFileIndex).toBeLessThan(3); // Should be in top 3 results
        
        // Warren Buffett might appear due to fuzzy match, but should be after the budget file
        const buffettIndex = results.findIndex(r => r.file.basename === 'Warren Buffett');
        if (buffettIndex !== -1) {
            expect(buffettIndex).toBeGreaterThan(budgetFileIndex);
        }
        
        // Long alias matches should be penalized and appear later
        const aliasMatches = results.filter(r => r.matchType === 'alias');
        aliasMatches.forEach(match => {
            expect(match.score).toBeGreaterThan(results[budgetFileIndex].score); // Higher score = worse ranking
        });
    });
});