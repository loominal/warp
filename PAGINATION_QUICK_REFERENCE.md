# Pagination Quick Reference - Warp v0.4.0

Quick guide for using pagination with Warp tools.

## Basic Pagination Pattern

```javascript
// First page - no cursor needed
tool({ limit: 20 })
// Response includes: count, total, hasMore, nextCursor

// Next page - use cursor from previous response
tool({ limit: 20, cursor: "eyJvZmZzZXQiOjIwLCJsaW1pdCI6MjB9" })
```

## Tools Supporting Pagination

| Tool | Default | Max | Ordering | Notes |
|------|---------|-----|----------|-------|
| `discover_agents` | 20 | 100 | Latest heartbeat first | Agents online by default |
| `read_messages` | 50 | 1000 | Newest first (inverse) | Messages archived as published |
| `read_direct_messages` | 10 | 100 | Newest first | Consume-once (ack on read) |
| `list_dead_letter_items` | 20 | 100 | Oldest first (insertion order) | DLQ items from failures |

## Tool Examples

### discover_agents - Find Agents by Capability

```javascript
// First page: 10 agents with "typescript" capability
discover_agents({
  capability: "typescript",
  limit: 10
})

// Response includes cursor for next page if hasMore=true
// To get next page:
discover_agents({
  capability: "typescript",
  cursor: "eyJvZmZzZXQiOjEwLCJsaW1pdCI6MTB9"
})
```

### read_messages - Paginate Channel History

```javascript
// Last 50 messages (newest first)
read_messages({
  channel: "parallel-work",
  limit: 50
})

// Older messages (use cursor)
read_messages({
  channel: "parallel-work",
  cursor: "eyJvZmZzZXQiOjUwLCJsaW1pdCI6NTB9"
})

// Very detailed history (max limit=1000)
read_messages({
  channel: "errors",
  limit: 1000
})
```

### list_dead_letter_items - Check Failed Work

```javascript
// Failed items from "testing" work queue
list_dead_letter_items({
  capability: "testing",
  limit: 20
})

// Next batch of failures
list_dead_letter_items({
  capability: "testing",
  cursor: "eyJvZmZzZXQiOjIwLCJsaW1pdCI6MjB9"
})
```

## Response Pagination Info

All paginated tools include pagination metadata in the response:

```
Showing {count} of {total} items

To see more items, use: { ..., cursor: "{nextCursor}" }
```

**Fields**:
- `count`: Items in this page
- `total`: Total items available
- `hasMore`: true if more pages exist
- `nextCursor`: Use in next call to fetch next page
- `prevCursor`: Use in next call to fetch previous page

## Cursor Format

**Encoding**: Base64url (RFC 4648 without padding)

**Example**:
- Decoded: `{"offset":20,"limit":50}`
- Encoded: `eyJvZmZzZXQ6MjAsImxpbWl0Ijo1MH0`
- Characters: Only `[A-Za-z0-9_-]` (URL-safe)

**Validation** (automatic on server):
- offset >= 0
- 1 <= limit <= 1000
- filterHash matches if provided

## Common Patterns

### Iterate Through All Pages

```javascript
async function getAllAgents(capability) {
  const agents = [];
  let cursor = null;

  do {
    const result = await discover_agents({
      capability,
      limit: 50,
      ...(cursor && { cursor })
    });

    agents.push(...result.agents);

    // Check if more pages (infer from response text)
    const hasMore = result.text.includes("To see more");
    cursor = extractCursorFromResponse(result.text);

    if (!hasMore) break;
  } while (cursor);

  return agents;
}
```

### Limit Enforcement

Tools automatically enforce min/max limits:

```javascript
// limit=0 → clamped to 1
// limit=200 (max=100) → clamped to 100
// limit=50 (default=20, max=100) → accepted as 50
// No limit → uses default (20, 50, or 10)
```

## Pagination Metadata Examples

### First Page (has next)
```
count: 20
total: 150
hasMore: true
nextCursor: "eyJvZmZzZXQ6MjAsImxpbWl0IjoyMH0"
prevCursor: null
```

### Middle Page
```
count: 20
total: 150
hasMore: true
nextCursor: "eyJvZmZzZXQ6NDAsbGltaXQiOjIwfQ"
prevCursor: "eyJvZmZzZXQ6MCwibGltaXQiOjIwfQ"
```

### Last Page
```
count: 10
total: 150
hasMore: false
nextCursor: null
prevCursor: "eyJvZmZzZXQ6MTIwLCJsaW1pdCI6MjB9"
```

## Tips & Best Practices

1. **Respect hasMore**: Check response text for "To see more items" before trying next page
2. **Don't construct cursors**: Use cursors from previous responses only
3. **Preserve limit**: For consistent results, use same limit across pages
4. **Monitor total**: Total count helps estimate remaining pages
5. **Handle empty**: Empty results are valid (no more items)
6. **Page size**: Larger limits = fewer requests but slower responses
7. **Filter consistency**: Avoid changing filters between paginated requests

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Invalid cursor" | Malformed cursor string | Use cursor from response, don't construct |
| "Filter mismatch" | Changed filters mid-pagination | Start fresh pagination with new filters |
| Duplicate items | Using wrong offset | Use provided cursors, don't modify |
| Missing total | Unknown in some contexts | Infer hasMore from response presence |
| Wrong ordering | Expected different order | Check tool documentation for order |

## Version Support

- **Introduced**: Warp v0.4.0
- **Tools affected**: discover_agents, read_messages, read_direct_messages, list_dead_letter_items
- **Cursor format**: Base64url (stable, backward compatible)
- **Limits**: Enforced server-side (min 1, max varies by tool)

## See Also

- Full test report: `PAGINATION_TEST_REPORT.md`
- Implementation: `src/pagination.ts`
- Tools: `src/tools/*.ts`
- Types: `src/types.ts` (PaginationMetadata interface)
