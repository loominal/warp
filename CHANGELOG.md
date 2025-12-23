# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2025-12-22

### BREAKING CHANGES

**All MCP tools renamed with `warp_*` prefixes** to align with Anthropic best practices for tool namespacing.

This is a breaking change that improves tool discoverability and follows the naming pattern used by production MCP servers like Asana and Slack.

#### Migration Guide

Update all tool invocations to use the new names:

**Identity Tools**:
- `set_handle` → `warp_handle_set`
- `get_my_handle` → `warp_handle_get`

**Channel Tools**:
- `list_channels` → `warp_channels_list`
- `send_message` → `warp_channels_send`
- `read_messages` → `warp_channels_read`
- `channels_status` → `warp_channels_status`

**Registry Tools**:
- `register_agent` → `warp_registry_register`
- `discover_agents` → `warp_registry_discover`
- `get_agent_info` → `warp_registry_get_info`
- `update_presence` → `warp_registry_update_presence`
- `deregister_agent` → `warp_registry_deregister`

**Messaging Tools**:
- `send_direct_message` → `warp_messages_send_direct`
- `read_direct_messages` → `warp_messages_read_direct`

**Work Queue Tools**:
- `broadcast_work_offer` → `warp_work_broadcast`
- `claim_work` → `warp_work_claim`
- `list_work` → `warp_work_list`
- `work_queue_status` → `warp_work_queue_status`

**Dead Letter Queue Tools**:
- `list_dead_letter_items` → `warp_dlq_list`
- `retry_dead_letter_item` → `warp_dlq_retry`
- `discard_dead_letter_item` → `warp_dlq_discard`

### Changed
- Tool names now follow consistent `warp_<category>_<action>` pattern
- Tool descriptions updated to reference new tool names
- All internal documentation and examples updated

### Fixed
- Improved tool discoverability in Claude Code MCP server list
- Better grouping of related tools by category

## [0.4.0] - 2025-12-22

### Added
- **Pagination Support**: Cursor-based pagination for large result sets
  - `read_messages`: Page through channel message history with offset/limit/cursor
  - `read_direct_messages`: Page through inbox messages (continuation-style for consume-once)
  - `discover_agents`: Page through agent registry results
  - `list_dead_letter_items`: Page through failed work items
  - Base64url-encoded cursors with filter hash validation
  - Pagination metadata includes count, total, hasMore, nextCursor
- **Truncation Metadata**: List operations now return metadata indicating when results are truncated
  - `discover_agents` includes suggestion when showing > 20 agents
  - `list_dead_letter_items` shows truncation info when limit reached
  - `read_messages` indicates when message history is truncated
- **`list_work` Tool**: Non-destructive preview of work queue items before claiming
  - Filter by priority (minPriority/maxPriority)
  - Filter by deadline (deadlineBefore/deadlineAfter)
  - View work items without removing them from queue
  - Truncation metadata with helpful filtering suggestions
- **`channels_status` Tool**: Check channel message counts without reading messages
  - Get status for single channel or all channels
  - Shows message count, storage usage, and sequence range
  - Useful for monitoring activity without consuming messages
- **`work_queue_status` Tool**: Monitor work queue health and backlog
  - Check pending work count for specific capability or all queues
  - Shows only non-empty queues when checking all
  - Useful for monitoring system load and queue backlogs

### Changed
- **Tool Descriptions Simplified**: Removed NATS implementation details
  - "JetStream" → "reliable messaging" or removed entirely
  - "inbox stream" → "your inbox"
  - "competing consumers" → "available agents"
  - Descriptions now focus on "what" tools do, not "how" they work
- `readMessages` function in streams.ts now returns `{ messages, total }` instead of array
- Tool count updated from 17 to 20

### Fixed
- Work queue preview functionality (previously agents had to claim blindly)
- Channel monitoring (agents can now check for new messages without reading them)
- Result truncation awareness (agents now know when results are limited)

## [0.1.0] - 2025-12-11

### Status: Beta Release

This release marks the transition from Alpha to Beta. Core functionality has been thoroughly tested with 492 unit tests passing and 8 integration scenarios validated.

### Added
- `claim_work` tool documentation with examples in README
- Known Limitations section in README documenting current constraints
- Beta status badge in README

### Changed
- Status upgraded from Alpha to Beta
- README messaging updated to reflect Beta stability level
- Tool count updated to 17 (added claim_work documentation)

### Tested
- **Direct Messaging (REQ-DM)**: 5/5 test cases passed
  - Online message delivery
  - Offline message queuing
  - Message filtering by type
  - Message filtering by sender
  - Message ordering verification
- **Dead Letter Queue (REQ-DLQ)**: 5/5 test cases passed
  - Work moves to DLQ after max attempts
  - DLQ listing with correct metadata
  - Retry functionality
  - Attempt counter reset
  - Permanent discard
- **Registry Advanced (REQ-REG)**: 5/6 test cases passed
  - Presence status updates
  - Task count updates
  - Private agent visibility
  - User-only visibility
  - Public cross-project visibility
  - (Heartbeat timeout deferred to Weft coordinator)
- **Configuration (REQ-CFG)**: 3/3 test cases passed
  - Custom channels via config file
  - Custom retention policies
  - Environment variable overrides

### Security
- npm audit: 0 high/critical vulnerabilities
- 6 moderate vulnerabilities in dev dependencies only (vitest/vite/esbuild)
- No production runtime security issues

### Known Limitations
- Stale agent detection requires Weft coordinator
- Work queue may return 503 under extreme load
- NATS clustering not yet tested
- Rapid concurrent publishes may have slight ordering variations

## [0.0.1] - 2025-12-08

### Added
- NATS MCP Server core implementation
  - MCP (Model Context Protocol) server with NATS transport
  - Full MCP resource, tool, and prompt support
- JetStream Integration
  - Persistent message streams for reliable delivery
  - Subject-based message routing
  - Stream consumer management
- Agent Registry
  - Agent discovery and registration system
  - Agent presence tracking and heartbeat mechanism
  - Capability-based agent filtering
  - Agent visibility controls (private, project-only, user-only, public)
  - GUID-based agent identification
  - Agent status tracking (online, busy, offline)
- Work Queue System
  - Work distribution to capable agents
  - Competing consumer pattern for load balancing
  - Priority-based task scheduling (1-10 scale)
  - Deadline support for time-sensitive work
  - Context data passing for work items
  - Dead Letter Queue (DLQ) for failed work items
  - DLQ item retry with attempt counter reset
  - DLQ item permanent discard
- Direct Messaging
  - Agent-to-agent direct messaging via personal inboxes
  - Message type specification (text, work-offer, work-claim)
  - Message metadata support
  - Reliable delivery with offline queuing
  - Inbox stream persistence
- Channel Communication
  - Multi-agent channel subscriptions
  - Broadcast messaging to channels
  - Channel listing and discovery
  - Message history via stream consumers
- Infrastructure
  - Kubernetes deployment configuration
    - StatefulSet for NATS server
    - ConfigMap for server configuration
    - Service definitions (ClusterIP and external access)
  - Docker support
    - Dockerfile for containerized deployment
    - Docker Compose for local development
  - TLS/SSL support for secure communication
  - Authentication support (username/password, token-based)
  - Non-root container execution for security
  - Health check endpoints
  - Readiness probes for orchestration

### Security
- TLS/SSL encryption for data in transit
- Authentication mechanisms (credentials-based and token-based)
- Non-root container execution (UID/GID configuration)
- Role-based visibility controls for agent registry
- Input validation and sanitization
- Secure default configurations

### Documentation
- Comprehensive README with architecture overview
- Installation and setup instructions
- Configuration guide
- API documentation with examples
- Agent development guide
- Work queue usage examples
- Deployment guide for Kubernetes and Docker

[Unreleased]: https://github.com/mdlopresti/loom-warp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mdlopresti/loom-warp/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/mdlopresti/loom-warp/releases/tag/v0.0.1
