# Macro note discovery and one-page inputs

The native one-page form combines note search/create with subsequent capture inputs. A selected note is stored separately from anonymous capture answers. Template-only fields appear when creating a note, and changing selections preserves drafts. A named field stays visible when a capture also needs it.

Prepared answers belong to command occurrences, so two uses of the same Capture can receive different anonymous answers. Each step receives its answers when it runs. Named variables retain sharing, and explicit API/script values remain authoritative. Ordinary macros retain their existing shared anonymous values. Remote prompt providers retain their existing form contract.

A discovery Template set to Never is a collection boundary. It runs its picker and template first, then remaining eligible captures receive one grouped form. Scripts and conditional commands keep their existing boundaries.

The Macro builder exposes the existing one-page override. Its scope includes later step forms, explicit child overrides take precedence, and nested execution restores the enclosing setting. No settings migration is required.

Discovery forms use labels above full-width controls so the note picker, capture, and named fields share one alignment at desktop and narrow widths.

## Verification

- Real Obsidian: seven automated workflow cases passed, covering existing/create, conditional fields and draft preservation, separate captures in the Never suffix form, and macro overrides.
- Registered command: one submit opened Project Atlas and appended both independent capture answers without another prompt.
- Layout: desktop and 390 px viewport inspected; no horizontal form overflow at 390 px.
- Build with lint passed. Svelte check reported zero errors and warnings. Full unit suite passed 5,269 tests, with 37 skipped.
