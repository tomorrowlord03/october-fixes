# Bug Report: Agent MCP Disconnection on Node Restart (`MCP ERROR (october-bus)`) & Dynamic Process Bridge

## Summary

In multi-agent canvas workflows on [October Canvas](https://october.dev), whenever an agent terminal node restarts—whether caused by an agent exit, crash, model change, or user-initiated terminal reload—the agent enters a persistent disconnected state:

```text
Configured MCP servers:
  october-bus - Disconnected
  Error: MCP ERROR (october-bus)
```

The agent is rendered context-bus blind: it cannot discover canvas peers (`list_peers`), route peer messages (`message_peer`), or participate in shared task boards.

Direct interrogation of October's local HTTP MCP endpoint (`http://127.0.0.1:<port>/mcp`) reveals that October rejects incoming MCP connections with:
```text
HTTP 400 Bad Request
{"error": "UNAUTHENTICATED: invalid MCP execution capability"}
```

---

## Technical Root Cause Analysis

### 1. Ephemeral Execution Capability Lifecycle
October enforces strict execution authority for every terminal node. When October launches a terminal session (e.g. Atlas, Apollo, or Orion), it generates a unique cryptographic capability token (`mcpCapability`) and writes the process binding into `~/.october/bus-processes.json`:

```json
{
  "17432": {
    "port": 53351,
    "canvas": "3d2819ab-7e0d-4008-8f87-5e589b9c2833",
    "node": "term-mucytwaj-0",
    "launch": "e9265519-25a3-4e7d-8c02-c4ef867371bb",
    "hookCredential": "idml-9S-RcYbTTn_Hw0zckWhNEGMco19nldi4iMJ0iA",
    "mcpCapability": "5ZnyrFg1U-G58kDtoPnZZbrEdsTEgN_x5YKwUax9gp4",
    "createdAt": 1790102530874
  }
}
```

October's HTTP MCP server validates that every incoming request carries a live `X-October-MCP-Capability` header (or `?cap=` parameter) matching the active PID registered in `bus-processes.json`.

### 2. Static Configuration Binding vs. Dynamic Process Restarts
October configures agents by writing static JSON files:
* Workspace files: `<workspace>/.agents/mcp_config.json`
* Global fallback files: `~/.gemini/config/mcp_config.json` and `~/.agents/mcp_config.json`

These files are populated with literal, static capability headers:
```json
{
  "mcpServers": {
    "october-bus": {
      "serverUrl": "http://127.0.0.1:53351/mcp",
      "headers": {
        "X-October-Canvas": "3d2819ab-7e0d-4008-8f87-5e589b9c2833",
        "X-October-Node": "term-mucytwaj-0",
        "X-October-MCP-Capability": "5ZnyrFg1U-G58kDtoPnZZbrEdsTEgN_x5YKwUax9gp4"
      }
    }
  }
}
```

### 3. The Stale Token Failure
When an agent is restarted:
1. The operating system assigns a **new PID** (e.g. PID `18520` instead of `17432`).
2. October mints a **brand-new `mcpCapability`** token for the new PID and records it in `bus-processes.json`.
3. However, the static configuration file (`mcp_config.json`) still contains the **stale capability token** from the prior session.
4. When the agent starts up, it reads the stale capability token from `mcp_config.json` and submits it to October's `/mcp` endpoint.
5. October checks the token against the active entries in `bus-processes.json`, finds no match, and rejects the handshake with `400 Bad Request: UNAUTHENTICATED: invalid MCP execution capability`.
6. The agent marks `october-bus` as disconnected, disabling all canvas collaboration tools.

---

## Architectural Fix: Dynamic Local stdio MCP Bridge

To permanently resolve this architectural fragility, we designed and verified a lightweight, zero-dependency **dynamic stdio-to-HTTP MCP bridge**:

```
+------------------+         stdio         +-------------------------------------+
|   Agent Host     | <===================> |      bus-process-bridge.mjs         |
| (Antigravity/    |      JSON-RPC         |                                     |
|  Claude/Gemini)  |                       |  1. Inspect process.ppid            |
+------------------+                       |  2. Walk ancestry via Win32_Process |
                                           |  3. Read ~/.october/bus-processes   |
                                           |  4. Dynamically resolve live cap    |
                                           +-------------------------------------+
                                                              ||
                                                     HTTP POST / SSE stream
                                                     X-October-MCP-Capability: <LIVE>
                                                              ||
                                                              \/
                                                   +----------------------+
                                                   | October Core HTTP/SSE|
                                                   |     (Port 53351)     |
                                                   +----------------------+
```

### Components

#### 1. Process Ancestry Resolver (`bus-process-resolver.mjs`)
The resolver traverses the process tree starting from `process.ppid` (the parent terminal / PTY process).
* On Windows, it invokes `Get-CimInstance Win32_Process` via PowerShell to resolve parent process IDs up to 15 levels.
* On POSIX systems, it queries `ps -o ppid= -p <pid>`.
* It matches the ancestry against active PIDs in `~/.october/bus-processes.json`, dynamically extracting:
  - `OCTOBER_BUS_PORT`
  - `OCTOBER_BUS_CANVAS`
  - `OCTOBER_BUS_NODE`
  - `OCTOBER_BUS_MCP_CAPABILITY` (the fresh, live execution capability)

#### 2. Process Bridge Runner (`bus-process-bridge.mjs`)
Invoked by the agent as a local stdio command:
```javascript
#!/usr/bin/env node
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveOctoberBusIdentity } from "./bus-process-resolver.mjs"

const identity = resolveOctoberBusIdentity("mcp")
if (identity) Object.assign(process.env, identity)
await import(pathToFileURL(join(homedir(), ".october", "bus-bridge.mjs")).href)
```

#### 3. Agent Configuration
In `~/.gemini/config/mcp_config.json`, `.agents/mcp_config.json`, or `~/.claude.json`:
```json
{
  "mcpServers": {
    "october-bus": {
      "command": "node",
      "args": [
        "C:\\Users\\<User>\\.october\\bus-process-bridge.mjs"
      ]
    }
  }
}
```

### Key Advantages of the Dynamic Bridge
* **Zero Configuration Churn:** No files need to be modified when agents restart or reload.
* **Immune to Stale Tokens:** The bridge always resolves the live capability of the currently executing terminal node.
* **Universal Compatibility:** Works transparently across Antigravity, Claude Code, Gemini CLI, Cursor, and Codex.

---

## Recommended Upstream Fixes for October Core

1. **Ship the Dynamic stdio Bridge Upstream:**
   Adopt the dynamic stdio bridge pattern as the standard MCP adapter architecture in `october-dev/october-bus` rather than relying on static `serverUrl` entries with embedded query parameters.

2. **Event-Driven Config Re-synchronization:**
   If static HTTP URLs are retained, October Core must hook into `terminal:restarted` and `node:spawned` events to immediately re-write `<workspace>/.agents/mcp_config.json` and user fallback files with the newly minted capability token before the agent process initializes.

3. **PowerShell Call Operator (`&`) in Windows Terminal Runner:**
   Ensure all lifecycle hooks (such as `bus-hook.mjs session-start`) are invoked on Windows using the PowerShell call operator:
   ```typescript
   const command = `& "${nodeExecutable}" "${hookScriptPath}" ${args.map(a => `"${a}"`).join(' ')}`;
   ```
   This prevents syntax parser failures when paths contain whitespace.

---

## Verification Runbook

1. **Verify Live Capability in Registry:**
   ```powershell
   Get-Content "$env:USERPROFILE\.october\bus-processes.json" | ConvertFrom-Json
   ```
2. **Test Direct HTTP Endpoint with Capability:**
   ```powershell
   $cap = "<active_capability>"
   $port = 53351
   Invoke-RestMethod -Uri "http://127.0.0.1:$port/mcp" -Method Post -Headers @{ "X-October-MCP-Capability" = $cap } -Body '{"jsonrpc":"2.0","method":"tools/list","id":1}' -ContentType "application/json"
   ```
3. **Verify Bridge via stdio:**
   ```powershell
   & node "$env:USERPROFILE\.october\bus-process-bridge.mjs"
   ```
4. **Confirm Agent Connectivity:**
   In Antigravity or Gemini CLI, run `/mcp`. Verify that `october-bus` displays as **Enabled** and all 66 canvas tools are listed.
