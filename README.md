# NATS MCP Server

A generalized MCP (Model Context Protocol) server for agent-to-agent communication via NATS JetStream. Enables AI agents in Claude Code to communicate across projects with persistent, channel-based messaging.

## Features

### Phase 1: Channel-Based Messaging
- **Channel-based messaging**: Organize communication into configurable channels
- **Message persistence**: All messages stored in NATS JetStream for history retrieval
- **Project isolation**: Each project gets its own namespace to prevent message cross-contamination
- **Configurable**: Define custom channels, retention policies, and settings per project
- **Reliable**: Automatic reconnection, message acknowledgment, and graceful shutdown

### Phase 2: Cross-Computer Agent Communication
- **Agent Registry**: Register agents in a shared KV store for discovery across computers
- **Agent Discovery**: Find other agents by type, capabilities, hostname, or project
- **Direct Messaging**: Send messages directly to specific agents via personal inboxes
- **Heartbeat System**: Automatic presence updates with stale agent detection
- **Visibility Controls**: Configure agent visibility (private, project-only, user-only, public)

### Phase 3: Work Distribution and Reliability
- **Work Queues**: Capability-based work queues with competing consumers (load balancing)
- **Work Handoff Protocol**: Structured message types for work-offer, work-claim, progress-update, work-complete, work-error
- **Dead Letter Queue (DLQ)**: Failed work items are captured for debugging and retry
- **Automatic Retries**: Configurable retry attempts before moving to DLQ
- **Optional Coordinator**: Centralized work management pattern (optional, not required)

## Prerequisites

- Node.js 18 or later
- NATS server with JetStream enabled

### Starting NATS with JetStream

```bash
# macOS/Linux
nats-server -js

# Docker
docker run -p 4222:4222 nats:latest -js
```

## Installation

### Global Installation (Recommended)

```bash
npm install -g nats-mcp-server
```

### Project-Level Installation

```bash
npm install nats-mcp-server
```

### Run without Installation

```bash
npx nats-mcp-server
```

### Docker Installation

```bash
# Build the Docker image
docker build -t nats-mcp-server:latest .

# Or pull from registry (when published)
# docker pull ghcr.io/your-org/nats-mcp-server:latest
```

Configure Claude Code to use Docker (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "nats-mcp": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network=host", "nats-mcp-server:latest"],
      "env": {
        "NATS_URL": "nats://localhost:4222"
      }
    }
  }
}
```

### Docker Compose (Local Development)

Start NATS with JetStream for local development:

```bash
# Start NATS
docker-compose up -d

# View logs
docker-compose logs -f nats

# Stop
docker-compose down
```

## Configuration

### Claude Code MCP Configuration

Add to your `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "nats-mcp": {
      "command": "nats-mcp-server",
      "env": {
        "NATS_URL": "nats://localhost:4222"
      }
    }
  }
}
```

### Project Configuration

Create a `.mcp-config.json` in your project root:

```json
{
  "namespace": "my-project",
  "channels": [
    {
      "name": "planning",
      "description": "Sprint planning and prioritization",
      "maxMessages": 5000,
      "maxAge": "7d"
    },
    {
      "name": "implementation",
      "description": "Development work coordination"
    },
    {
      "name": "review",
      "description": "Code review discussions"
    }
  ]
}
```

### Default Channels

If no configuration is provided, these default channels are created:

- **roadmap**: Discussion about project roadmap and planning
- **parallel-work**: Coordination for parallel work among agents
- **errors**: Error reporting and troubleshooting

## Usage

### Available Tools

#### `set_handle`

Set your agent identity for messages:

```
Agent: set_handle("project-manager")
Server: Handle set to: project-manager
```

#### `get_my_handle`

Get your current handle:

```
Agent: get_my_handle()
Server: Your current handle: project-manager
```

#### `list_channels`

List available channels:

```
Agent: list_channels()
Server: Available channels:
- **planning**: Sprint planning and prioritization
- **implementation**: Development work coordination
- **review**: Code review discussions
```

#### `send_message`

Send a message to a channel:

```
Agent: send_message("planning", "Starting Sprint 5 planning. Focus: API endpoints.")
Server: Message sent to #planning by project-manager
```

#### `read_messages`

Read recent messages from a channel:

```
Agent: read_messages("planning", limit=10)
Server: Messages from #planning:

[2025-01-15T10:00:00Z] **project-manager**: Starting Sprint 5 planning. Focus: API endpoints.
[2025-01-15T10:05:00Z] **business-analyst**: Prioritizing user authentication requirements.
```

### Agent Registration & Discovery Tools

#### `register_agent`

Register this agent in the global registry:

```
Agent: register_agent(agentType="developer", capabilities=["coding", "testing"], visibility="project-only")
Server: Agent registered successfully!
- GUID: 550e8400-e29b-41d4-a716-446655440000
- Handle: developer
- Heartbeat: active (60s interval)
```

#### `discover_agents`

Find other agents in the registry:

```
Agent: discover_agents(agentType="reviewer", status="online")
Server: Found 2 agents:

**code-reviewer** (reviewer)
- GUID: 123e4567-e89b-12d3-a456-426614174000
- Status: online
- Capabilities: [code-review, security-audit]
- Last seen: 2025-01-15T10:05:00Z
```

#### `get_agent_info`

Get detailed information about a specific agent:

```
Agent: get_agent_info(guid="123e4567-e89b-12d3-a456-426614174000")
Server: ## Agent: code-reviewer

| Field | Value |
|-------|-------|
| GUID | 123e4567-e89b-12d3-a456-426614174000 |
| Type | reviewer |
| Status | online |
| Capabilities | code-review, security-audit |
```

#### `update_presence`

Update your agent's presence information:

```
Agent: update_presence(status="busy", currentTaskCount=3)
Server: Presence updated:
- Status: online → busy
- Current Tasks: 0 → 3
```

#### `deregister_agent`

Deregister this agent from the registry:

```
Agent: deregister_agent()
Server: Agent deregistered successfully.
- Status: offline
- Heartbeat: stopped
```

### Direct Messaging Tools

#### `send_direct_message`

Send a direct message to another agent:

```
Agent: send_direct_message(recipientGuid="123e4567-e89b-12d3-a456-426614174000", message="Please review PR #42")
Server: Message sent successfully!
- Message ID: 789e0123-e89b-12d3-a456-426614174000
- To: code-reviewer
- Status: delivered
```

#### `read_direct_messages`

Read messages from your inbox:

```
Agent: read_direct_messages(limit=5)
Server: ## Direct Messages (2 messages)

---
**From:** project-manager (guid)
**Type:** text
**Time:** 2025-01-15T10:00:00Z

Please review PR #42 when you have time.

---
**From:** developer (guid)
**Type:** work-offer
**Time:** 2025-01-15T10:05:00Z

I've completed the API endpoints. Ready for review.
```

### Work Distribution Tools

#### `broadcast_work_offer`

Publish work to a capability-based work queue:

```
Agent: broadcast_work_offer(taskId="feature-123", capability="typescript", description="Implement user auth", priority=7)
Server: Work item published successfully!
- Work Item ID: 550e8400-e29b-41d4-a716-446655440000
- Task ID: feature-123
- Capability: typescript
- Priority: 7
```

### Dead Letter Queue Tools

#### `list_dead_letter_items`

List failed work items in the dead letter queue:

```
Agent: list_dead_letter_items(limit=10)
Server: ## Dead Letter Queue Items (1 item)

---
**ID:** 550e8400-e29b-41d4-a716-446655440000
**Task ID:** feature-123
**Capability:** typescript
**Failed At:** 2025-01-15T10:00:00Z
**Attempts:** 3
**Reason:** Worker crashed unexpectedly
```

#### `retry_dead_letter_item`

Move a failed work item back to the work queue:

```
Agent: retry_dead_letter_item(itemId="550e8400-e29b-41d4-a716-446655440000", resetAttempts=true)
Server: Work item retried successfully!
- Moved back to work queue: typescript
- Attempts reset: yes
```

#### `discard_dead_letter_item`

Permanently remove a failed work item:

```
Agent: discard_dead_letter_item(itemId="550e8400-e29b-41d4-a716-446655440000")
Server: Work item discarded successfully.
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NATS_URL` | `nats://localhost:4222` | NATS server connection URL |
| `MCP_PROJECT_PATH` | Current directory | Override project path for config discovery |
| `LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARN, ERROR) |
| `LOG_FORMAT` | `json` | Log format (json, text) |
| `WORKQUEUE_ACK_TIMEOUT` | `300000` | Work item acknowledgment timeout (ms) |
| `WORKQUEUE_MAX_ATTEMPTS` | `3` | Max delivery attempts before moving to DLQ |
| `WORKQUEUE_DLQ_TTL` | `604800000` | Dead letter queue TTL (ms, default 7 days) |

## Troubleshooting

### NATS Connection Failed

```
Error: NATS connection failed. Make sure NATS server with JetStream is running
```

**Solution**: Start NATS with JetStream enabled:
```bash
nats-server -js
```

### JetStream Not Enabled

```
Error: JetStream not enabled
```

**Solution**: Ensure you're using the `-js` flag when starting NATS.

### Invalid Channel Name

```
Error: Invalid channel name. Must be lowercase alphanumeric with hyphens only
```

**Solution**: Use channel names like `my-channel`, `work-items`, `sprint-1`.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint
```

## Cross-Computer Agent Communication

To enable agents on different computers to communicate, they must all connect to the same NATS server.

### Setup

1. **Deploy a shared NATS server** (see Kubernetes Deployment below, or use a cloud NATS service)

2. **Configure each computer's MCP** to use the shared NATS URL:

```json
{
  "mcpServers": {
    "nats-mcp": {
      "command": "nats-mcp-server",
      "env": {
        "NATS_URL": "nats://your-shared-nats-server:4222"
      }
    }
  }
}
```

3. **Register agents** on each computer:
   - Each agent calls `register_agent` with their type and capabilities
   - Agents are automatically discoverable across all connected computers
   - Heartbeats keep agents marked as online (60s interval)

### Visibility Controls

Control who can discover your agent:

| Visibility | Who can see |
|------------|-------------|
| `private` | Only the agent itself |
| `project-only` | Agents in the same project (default) |
| `user-only` | Agents with the same username |
| `public` | All agents on the NATS server |

### Security Best Practices

- Use TLS for NATS connections in production (`nats://` → `tls://`)
- Configure NATS authentication (username/password or tokens)
- Use network segmentation to limit NATS access
- Consider separate NATS clusters for different environments

## Kubernetes Deployment

Deploy NATS with JetStream to Kubernetes for multi-computer agent communication.

### Quick Start

```bash
# Apply Kubernetes manifests
kubectl apply -f config/

# Verify deployment
kubectl get pods -n nats-mcp
kubectl get svc -n nats-mcp

# Get external IP for NATS
kubectl get svc nats-external -n nats-mcp
```

### ArgoCD (GitOps)

```bash
# Update repoURL in nats.argocd.yaml, then:
kubectl apply -f nats.argocd.yaml
```

See [config/README.md](config/README.md) for detailed Kubernetes deployment instructions.

## License

MIT
