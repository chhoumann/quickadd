import { describe, it, expect } from 'vitest';
import { itPerf } from '../../../tests/perfUtils';
import { sanitizeHeading } from './utils';

describe('sanitizeHeading', () => {
	it.each([
		// Basic cases
		['Simple Heading', 'Simple Heading'],
		['', ''],
		
		// Wikilink cases
		['[[Target Note]]', 'Target Note'],
		['[[Target|Alias]]', 'Alias'],
		['Link to [[Another Note]] here', 'Link to Another Note here'],
		['[[Page]] and [[Other|Alias]]', 'Page and Alias'],
		
		// Image cases
		['![[image.png]]', ''],
		['Heading with ![[diagram.svg]] embedded', 'Heading with  embedded'],
		['![[folder/image.jpg]] at start', 'at start'],
		
		// Markdown formatting
		['**Bold Text**', 'Bold Text'],
		['*Italic Text*', 'Italic Text'],
		['`Code Text`', 'Code Text'],
		['~~Strikethrough~~', 'Strikethrough'],
		['**Bold _and_ `code`**', 'Bold and code'],
		
		// Mixed cases
		['**Bold** with [[Link|Alias]] and ![[image.png]]', 'Bold with Alias and'],
		['Complex *markdown* [[Note]] with `code` and ![[img.png]]', 'Complex markdown Note with code and'],
		
		// ATX heading markers
		['# Heading', 'Heading'],
		['## Heading ##', 'Heading'],
		['### Heading with **bold** ###', 'Heading with bold'],
		
		// Edge cases
		['[[Incomplete link', 'Incomplete link'],
		[']]Backwards link[[', 'Backwards link'],
		['[[]]', ''],
		['[[|]]', ''],
		['   Whitespace heading   ', 'Whitespace heading'],
		
		// Stray brackets
		['Heading with [[ leftover', 'Heading with  leftover'],
		['Heading with ]] brackets', 'Heading with  brackets'],
		['[[Link]] with ]] stray', 'Link with  stray'],

		// Scanner-edge cases pinned against the historical regex pipeline
		// (differentially fuzzed byte-identical; these are the trickiest shapes)
		['[[a]b]]', 'a]b'],           // single ] inside link → no wiki match, strays stripped
		['[[a|b]c]]', 'a|b]c'],       // alias broken by single ] → no wiki match
		['[[a|b|c]]', 'b|c'],         // second | belongs to the alias
		['[[a[[b]]', 'ab'],           // nested opener consumed into the target
		['![[a![[b]]', ''],           // nested image opener consumed into the embed
		['[[|x]]', 'x'],              // empty target, alias wins
		['![[a]b]]', '!a]b'],         // broken image embed leaves the bang literal
		['  ## x', '## x'],           // leading hashes after whitespace are NOT ATX-trimmed
		['a#  ##', 'a#'],             // only the trailing whitespace+hash run trims
		['x ### y', 'x ### y'],       // interior hash run untouched
		['abc ### ', 'abc ###'],      // trailing hashes not at end-of-string stay
		['a ## b ##', 'a ## b'],
		['#x#', 'x'],
		['# #', ''],
		['##  ##', ''],
	])('sanitizes "%s" to "%s"', (input, expected) => {
		expect(sanitizeHeading(input)).toBe(expected);
	});

	// The old chained regexes backtracked quadratically on adversarial headings
	// (any single `#`-prefixed note line, unbounded length, reaches this via
	// FileIndex.createIndexedFile for every heading of every file — full reindex
	// AND every metadataCache 'changed' event). wikiRE was O(n^2) on a "["
	// flood, imgRE on a "![[" flood, and trimHashRE on interior "#"/whitespace
	// runs. The linear scanners stay in single-digit milliseconds at these
	// sizes; a generous budget keeps the test non-flaky while failing hard on
	// any quadratic regression (the old code took seconds here).
	describe('ReDoS resistance', () => {
		const BUDGET_MS = 1000;
		const N = 200_000;

		it.each([
			['wikilink opener flood', '['.repeat(N), ''],
			['image opener flood', '![['.repeat(Math.floor(N / 3)), '!'.repeat(Math.floor(N / 3))],
			['alias opener flood', '[[a|'.repeat(Math.floor(N / 4)), 'a|'.repeat(Math.floor(N / 4))],
			['interior hash run', 'x' + '#'.repeat(N) + 'y', 'x' + '#'.repeat(N) + 'y'],
			['interior whitespace run', 'x' + ' '.repeat(N) + 'y', 'x' + ' '.repeat(N) + 'y'],
		])('sanitizes a %s in linear time', (_name, input, expected) => {
			const start = performance.now();
			expect(sanitizeHeading(input)).toBe(expected);
			expect(performance.now() - start).toBeLessThan(BUDGET_MS);
		}, 20_000);
	});
	
	// Performance test - ensure regex caching works
	itPerf('performs well with many calls', () => {
		const heading = '**Important** [[Note|Alias]] with ![[image.png]]';
		const start = performance.now();
		
		for (let i = 0; i < 1000; i++) {
			sanitizeHeading(heading);
		}
		
		const duration = performance.now() - start;
		expect(duration).toBeLessThan(100); // Should complete in < 100ms
	});

	// Test idempotency - multiple sanitizations should yield same result
	it('is idempotent', () => {
		const input = '## **Bold** [[Link|Alias]] with ![[image.png]] ##';
		const firstPass = sanitizeHeading(input);
		const secondPass = sanitizeHeading(firstPass);
		expect(secondPass).toBe(firstPass);
		expect(firstPass).toBe('Bold Alias with');
	});
});
