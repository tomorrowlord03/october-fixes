# Bug Report: "Not on the Canvas" Context & Environment Disconnection

## Summary
When spawning an agent terminal in October Canvas on Windows, agents frequently report that they are not connected to any canvas peers, or output:

> **"Orientation — this terminal is not connected to October's context bus."** / **"Not on the canvas."**

Consequently, peer-to-peer discovery (`list_peers`) fails, queued messages are deferred, and agents cannot coordinate.

---

## Root Causes

### 1. Windows PowerShell Quoting & Call Operator (`&`) Syntax Failure
When October initializes a terminal session, it invokes its session orientation hook:
```text
C:\Users\<User>\AppData\Roaming\October\runtime\node-v24.19.0-win-x64\node.exe C:\Users\<User>\.october\bus-hook.mjs session-start <agent>
```

On Windows systems, user home directories frequently contain spaces (e.g. `C:\Users\Anshuman Yadav\...`). If October wraps paths in double quotes and passes the raw string to PowerShell:
```powershell
"C:\Program Files\...\node.exe" "C:\Users\...\bus-hook.mjs" session-start antigravity
```
PowerShell interprets two adjacent quoted strings as expression literals rather than a command invocation. This causes a PowerShell ParserError:
```text
Unexpected token '"C:\Users\...\bus-hook.mjs"' in expression or statement.
At line:1 char:150
+ ... \bus-hook.mjs" session-start antigravity; ...
+ ~~~~~~~~~~~~~
Unexpected token 'session-start' in expression or statement.
```
Because the hook crashes before executing, October Core never receives the `session-start` registration event.

### 2. Missing Injected Bus Environment Variables
When an agent process is started from an independent shell rather than October's terminal spawner, the context bus environment variables are not injected:
* `OCTOBER_BUS_PORT`
* `OCTOBER_BUS_CANVAS`
* `OCTOBER_BUS_NODE`
* `OCTOBER_BUS_MCP_CAPABILITY`

Without these variables, the stdio bridge and hooks cannot identify which canvas node the process belongs to.

---

## Fixes & Solutions Applied

### 1. PowerShell Call Operator Prepending
Ensure all command invocations dispatched to PowerShell prepend the `&` operator:
```powershell
& "$env:APPDATA\October\runtime\node-v24.19.0-win-x64\node.exe" "$env:USERPROFILE\.october\bus-hook.mjs" session-start antigravity
```

### 2. Static Bus Bridge Fallback
In user-global configuration files (`~/.agents/mcp.json`), register October's process ancestry bridge `bus-process-bridge.mjs` under `october-bus-static`:
```json
{
  "mcpServers": {
    "october-bus-static": {
      "type": "stdio",
      "command": "C:\\Users\\<user>\\AppData\\Roaming\\October\\runtime\\node-v24.19.0-win-x64\\node.exe",
      "args": [
        "C:\\Users\\<user>\\.october\\bus-process-bridge.mjs"
      ],
      "env": {}
    }
  }
}
```
The bridge inspects the process ancestry tree (walking parent PIDs via `Win32_Process`) and matches the active entry in `~/.october/bus-processes.json`, resolving the live canvas, node ID, and capability token automatically even if environment variables were not explicitly inherited.
