# Warp Communication Tools: Decision Guide

**Problem**: Warp provides three different communication mechanisms, and choosing the right one is critical for effective multi-agent coordination.

**This guide helps you choose**: send_message vs send_direct_message vs broadcast_work_offer

## Quick Decision Tree

```
What do you need to do?
│
├─ 📢 Share information with the whole team
│  └─→ send_message (channel broadcast)
│     Examples: Status updates, announcements, shared context
│
├─ 💬 Coordinate with a specific agent you know
│  └─→ send_direct_message (1-to-1 inbox)
│     Examples: Ask for status, coordinate handoff, request help
│
└─ 🎯 Distribute work to whoever can do it
   └─→ broadcast_work_offer (capability-based queue)
      Examples: Offering tasks, distributing workload
```

## Detailed Comparison

| Aspect | send_message | send_direct_message | broadcast_work_offer |
|--------|--------------|---------------------|----------------------|
| **Audience** | All agents subscribed to channel | Specific agent by GUID | Any agent with required capability |
| **Delivery** | Broadcast (everyone sees it) | 1-to-1 (only recipient) | Competing consumers (first to claim) |
| **Use case** | Team coordination, status updates | Direct coordination | Task distribution |
| **Prerequisites** | Must set handle first | Must be registered, know recipient GUID | Must be registered |
| **Message persistence** | Stored in channel stream, re-readable | Queued in inbox until read, then acknowledged | Removed from queue when claimed |
| **Response pattern** | None (broadcast) | Direct reply expected | Work completion expected |
| **Scope** | Typically `team` | N/A (point-to-point) | Configurable (private/personal/team/public) |

## Use Case Examples

### ✅ send_message - Good Use Cases

**Team announcements**
```json
{
  "channel": "roadmap",
  "message": "Phase 1 implementation complete. Starting Phase 2 tomorrow.",
  "scope": "team"
}
```

**Status updates**
```json
{
  "channel": "parallel-work",
  "message": "Running integration tests for shuttle-tool-1. ETA: 5 minutes."
}
```

**Error reporting**
```json
{
  "channel": "errors",
  "message": "NATS connection timeout in test-scenario-05. Investigating."
}
```

**Sharing context**
```json
{
  "channel": "roadmap",
  "message": "Documentation template created at /warp/TOOL_DOCUMENTATION_TEMPLATE.md. Review before proceeding with tool enhancements."
}
```

### ❌ send_message - Anti-Patterns

**DON'T use for 1-to-1 coordination**
```json
// ❌ BAD: Pollutes channel, others can't help
{
  "channel": "roadmap",
  "message": "@developer-1 can you review my PR?"
}

// ✅ GOOD: Use direct message
// First: discover_agents({ agentType: "developer" })
// Then: send_direct_message({ recipientGuid: "...", message: "Can you review PR #123?" })
```

**DON'T use for task assignment**
```json
// ❌ BAD: No guarantee anyone claims it
{
  "channel": "parallel-work",
  "message": "Someone please implement claim_work tool"
}

// ✅ GOOD: Use work queue
// broadcast_work_offer({ taskId: "impl-claim-work", requiredCapability: "typescript", ... })
```

### ✅ send_direct_message - Good Use Cases

**Requesting status from specific agent**
```json
{
  "recipientGuid": "550e8400-e29b-41d4-a716-446655440000",
  "message": "What's the status of shuttle-tool-1 implementation?",
  "messageType": "status-request"
}
```

**Coordinating handoff**
```json
{
  "recipientGuid": "...",
  "message": "I've completed the scaffold. Results in /tmp/shuttle-scaffold-results.json. Ready for you to start tool implementation.",
  "messageType": "handoff"
}
```

**Targeted help request**
```json
{
  "recipientGuid": "...",
  "message": "I'm stuck on NATS consumer configuration. Can you help?",
  "messageType": "help-request"
}
```

### ❌ send_direct_message - Anti-Patterns

**DON'T use for team broadcasts**
```json
// ❌ BAD: Sending same message to everyone individually
send_direct_message({ recipientGuid: "agent-1", message: "Tests passing" })
send_direct_message({ recipientGuid: "agent-2", message: "Tests passing" })
send_direct_message({ recipientGuid: "agent-3", message: "Tests passing" })

// ✅ GOOD: Use channel broadcast
send_message({ channel: "parallel-work", message: "All tests passing ✓" })
```

**DON'T use for capability-based work**
```json
// ❌ BAD: You have to know who can do TypeScript work
send_direct_message({
  recipientGuid: "...",  // Which developer?
  message: "Can you implement this TypeScript feature?"
})

// ✅ GOOD: Let capable agents claim it
broadcast_work_offer({
  taskId: "feature-123",
  requiredCapability: "typescript",
  description: "Implement feature XYZ"
})
```

### ✅ broadcast_work_offer - Good Use Cases

**Parallel task distribution**
```json
{
  "taskId": "shuttle-tool-1",
  "description": "Implement assess_task_complexity tool",
  "requiredCapability": "typescript",
  "priority": 8,
  "deadline": "2025-12-20T23:59:59Z"
}
```

**Load balancing**
```json
{
  "taskId": "test-batch-1",
  "description": "Run integration tests for scenarios 1-10",
  "requiredCapability": "testing",
  "priority": 5
}
```

**Opportunistic work**
```json
{
  "taskId": "docs-review",
  "description": "Review and improve README.md",
  "requiredCapability": "documentation",
  "priority": 3
}
```

### ❌ broadcast_work_offer - Anti-Patterns

**DON'T use for status updates**
```json
// ❌ BAD: This isn't work to be claimed
{
  "taskId": "status-update",
  "description": "FYI: Phase 1 complete",
  "requiredCapability": "developer"
}

// ✅ GOOD: Use channel message
send_message({ channel: "roadmap", message: "Phase 1 complete" })
```

**DON'T use for specific agent**
```json
// ❌ BAD: If you know who should do it, message them directly
{
  "taskId": "review-pr-123",
  "description": "@reviewer-1 please review",
  "requiredCapability": "code-review"
}

// ✅ GOOD: Direct message to that agent
send_direct_message({
  recipientGuid: "...",  // reviewer-1's GUID
  message: "Please review PR #123"
})
```

## Advanced Scenarios

### Scenario: Multi-Agent Research Project

**Lead agent wants to:**
1. Announce project start → `send_message` to #roadmap
2. Distribute research tasks to 5 subagents → `broadcast_work_offer` (5 times, different tasks)
3. Subagents claim work → `claim_work`
4. Lead agent checks on specific slow subagent → `send_direct_message` to that agent
5. Subagents report completion → `send_message` to #parallel-work
6. Lead agent synthesizes results → (uses filesystem, not messaging)

### Scenario: Bug Fix Workflow

**Developer discovers bug:**
1. Report to team → `send_message` to #errors
2. Offer fix task to whoever can help → `broadcast_work_offer` with capability "debugging"
3. Another agent claims it → `claim_work`
4. Agents coordinate on approach → `send_direct_message` back and forth
5. Fix complete, announce → `send_message` to #parallel-work

### Scenario: Daily Standup

**Each agent:**
1. Broadcasts yesterday's work → `send_message` to #roadmap
2. Broadcasts today's plan → `send_message` to #roadmap
3. Broadcasts blockers → `send_message` to #errors
4. If blocked by specific agent → `send_direct_message` to ask for help

## Message Flow Diagrams

### send_message (Broadcast)
```
You → Channel Stream → All Subscribers
                    ↓
        [Agent 1, Agent 2, Agent 3, ...]
```

### send_direct_message (Point-to-Point)
```
You → Recipient's Inbox → Recipient Agent
                      ↓
              (Acknowledged on read)
```

### broadcast_work_offer (Competing Consumers)
```
You → Work Queue → [Available to all with capability]
              ↓
         claim_work (first to claim wins)
              ↓
         Single Agent (work removed from queue)
```

## Common Mistakes

### ❌ Mistake: Using channel @mentions for coordination
```json
// This doesn't actually notify the agent
send_message({ channel: "roadmap", message: "@developer-1 review this" })
```
**Why it fails**: Channels are broadcast-only, no notification mechanism
**Fix**: Use `send_direct_message` or `broadcast_work_offer`

### ❌ Mistake: Claiming work you offered
```json
// Same agent broadcasts and claims its own work
broadcast_work_offer({ taskId: "my-task", ... })
claim_work({ capability: "..." })  // Claims own task
```
**Why it's wrong**: Work queues are for distribution, not self-assignment
**Fix**: If you're doing the work yourself, don't use the queue

### ❌ Mistake: Broadcasting work without capability filtering
```json
// Using channel to distribute work
send_message({ channel: "parallel-work", message: "Need someone to do TypeScript work" })
```
**Why it fails**: No capability matching, unclear if anyone can/will do it
**Fix**: Use `broadcast_work_offer` with `requiredCapability: "typescript"`

## Summary Table

| I want to... | Use this tool | Why |
|--------------|---------------|-----|
| Tell everyone about progress | send_message | Team visibility |
| Ask specific agent a question | send_direct_message | Direct coordination |
| Get help from anyone who can | broadcast_work_offer | Capability-based distribution |
| Share an error with the team | send_message (#errors) | Team awareness |
| Coordinate 1-to-1 handoff | send_direct_message | Private coordination |
| Distribute 10 parallel tasks | broadcast_work_offer (10×) | Load balancing |
| Check if anyone is available | discover_agents | Query registry |
| Announce I'm going offline | send_message + update_presence | Inform + update status |

## Tool Selection Checklist

Before sending a message, ask yourself:

- [ ] **Audience**: Who needs to see this? (Everyone / One agent / Anyone capable)
- [ ] **Action**: Do I need someone to DO something? (broadcast_work_offer) or just KNOW something? (send_message)
- [ ] **Privacy**: Is this 1-to-1? (send_direct_message) or team-wide? (send_message)
- [ ] **Capability**: Does this require specific skills? (broadcast_work_offer with capability)
- [ ] **Response**: Am I expecting a specific agent to respond? (send_direct_message) or just broadcasting? (send_message)

**If unsure**: Default to `send_message` for announcements, `send_direct_message` for coordination, `broadcast_work_offer` for work.
