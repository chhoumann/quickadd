---
title: QuickAdd API Date Module
---
# Date Module
Formats always default to ``YYYY-MM-DD``.
### ``now(format?: string, offset?: number)``
Gets the current time and formats according to the given format.

Providing an offset will offset the date by number of days. Giving -1 would mean yesterday, and giving 1 would mean tomorrow - and so on.

### ``tomorrow(format?: string)``
Same as ``now`` but with offset set to 1.

### ``yesterday(format?: string)``
Again, same as ``now`` but with offset set to -1.
