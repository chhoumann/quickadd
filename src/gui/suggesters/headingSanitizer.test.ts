import { describe, it, expect } from 'vitest';
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
	])('sanitizes "%s" to "%s"', (input, expected) => {
		expect(sanitizeHeading(input)).toBe(expected);
	});
	
	// Performance test - ensure regex caching works
	it('performs well with many calls', () => {
		const heading = '**Important** [[Note|Alias]] with ![[image.png]]';
		const start = performance.now();
		
		for (let i = 0; i < 1000; i++) {
			sanitizeHeading(heading);
		}
		
		const duration = performance.now() - start;
		expect(duration).toBeLessThan(100); // Should complete in < 100ms
	});
});
