# October Canvas Bug Fixes & Diagnostics

This repository documents root-cause analyses, verified reproductions, and repair utilities for critical multi-agent orchestration bugs in [October Canvas](https://october.dev) ([october-dev/october-bus](https://github.com/october-dev/october-bus)) on Windows.

---

## Documented Issues

### 1. Terminal Host Launch Failure (`launch-failed` / Ownership Journal Conflict)
* **Full Report:** [`TERMINAL_HOST_LAUNCH_FAILED_BUG.md`](./TERMINAL_HOST_LAUNCH_FAILED_BUG.md)
* **Symptom:** When clicking start or launching an agent CLI (such as Google Antigravity / Atlas) directly on an October canvas, terminal initialization is aborted with a red warning toast:  
  `"The terminal host could not start this session. Review the launch settings and try again."`
* **Root Cause:** October maintains an internal ownership journal (`~/.october/bus-ownership-v1.json`) to merge MCP and lifecycle configurations into workspace files (`.agents/mcp_config.json`). If an existing file contains non-matching descriptors (e.g. stdio bridge or modified parameters), October's `legacyJsonBaseline` fails to recognize and strip the entry because of an over-restrictive regex matching only `127.0.0.1` and `X-October-*` HTTP headers. The reconciliation engine enters an unrecoverable conflict (`"an October-owned JSON value was modified"`), crashing the terminal spawner.
* **Fix & Workaround:** Described in detail with automated repair script.

---

### 2. "Not on the Canvas" Context & Environment Disconnection
* **Full Report:** [`NOT_ON_CANVAS_BUG.md`](./NOT_ON_CANVAS_BUG.md)
* **Symptom:** Agent runs inside an October terminal or external shell but reports that it is not on the canvas, peer discovery returns empty, and peer messages are not routed.
* **Root Cause:**
  1. **PowerShell Parser Error on Windows:** October dispatches lifecycle hook invocations (e.g. `bus-hook.mjs session-start`) without PowerShell's call operator (`&`). When executable or script paths contain spaces (such as `C:\Users\First Last\...`), PowerShell treats adjacent quoted paths as string literals rather than invocations, throwing parser syntax errors (`Unexpected token in expression or statement`).
  2. **Environment Variable Injection:** When terminal nodes are started outside October's integrated spawner, the context bus environment variables (`OCTOBER_BUS_CANVAS`, `OCTOBER_BUS_PORT`, `OCTOBER_BUS_NODE`, `OCTOBER_BUS_MCP_CAPABILITY`) are missing.
* **Fix & Workaround:** Prepend PowerShell call operator `&`, properly escape paths, and ensure context injection.

---

### 3. "Could not reopen this terminal" on Lingering Fallback Shell
* **Full Report:** [`REOPEN_FALLBACK_SHELL_BUG.md`](./REOPEN_FALLBACK_SHELL_BUG.md)
* **Symptom:** When an agent exits and the user clicks the recovery banner **"Reopen Antigravity"**, the UI displays:  
  `"Could not reopen this terminal. Your saved session is preserved. Try again."`
* **Root Cause:** October drops into a fallback `cmd.exe` process upon agent exit. `reopenStoppedTerminal` checks if the terminal process has terminated (`!health.exited`). Because `cmd.exe` is still actively running in the PTY, October rejects the reopen request with `"This terminal is no longer stopped."`.
* **Fix & Workaround:** Type `exit` into the active shell prompt to terminate the fallback shell, then click **"Reopen Antigravity"**. Upstream recommendation: automatically terminate lingering shell processes on reopen.

---

### 4. Agent Setup Modal Terminal Crash (`The filename, directory name, or volume label syntax is incorrect`) & False "Needs setup" Status
* **Full Report:** [`WINDOWS_SETUP_SHELL_SYNTAX_BUG.md`](./WINDOWS_SETUP_SHELL_SYNTAX_BUG.md)
* **Symptom:** Clicking **"Set up"** under Settings -> Agents opens a modal that crashes immediately with:  
  `"The filename, directory name, or volume label syntax is incorrect."`  
  Additionally, Antigravity displays a red dot `"Needs setup"` even when authenticated and functioning via CLI OAuth.
* **Root Cause:**
  1. `loginCmdFor(platform, harness)` formats the prepended PATH string using PowerShell syntax (`$env:PATH = "...;$env:PATH"; <command>`). However, October executes setup commands on Windows via `cmd.exe /d /s /c`. Passing PowerShell `$env:PATH` syntax into `cmd.exe` causes a fatal syntax crash.
  2. October's supervisor checks only for `GEMINI_API_KEY` + `modelProvider: "gemini"` to determine Antigravity readiness, explicitly bypassing Google OAuth/keyring inspection.
* **Fix & Workaround:** Configure October's terminal shell in `settings.json` to PowerShell (`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`) or patch `loginCmdFor` upstream to use cmd.exe syntax (`set "PATH=...;%PATH%" && <cmd>`).

---

### 5. Agent MCP Disconnection on Node Restart (`MCP ERROR (october-bus)`) & Dynamic Process Bridge
* **Full Report:** [`MCP_DISCONNECTED_CAPABILITY_STALE_BUG.md`](./MCP_DISCONNECTED_CAPABILITY_STALE_BUG.md)
* **Symptom:** Whenever an agent terminal node restarts (due to crash, model change, or terminal reload), the agent displays `MCP ERROR (october-bus) - Disconnected`. Direct HTTP queries to October's MCP endpoint return `400 Bad Request: {"error": "UNAUTHENTICATED: invalid MCP execution capability"}`.
* **Root Cause:** October generates a new unique execution capability token (`mcpCapability`) in `~/.october/bus-processes.json` upon every process spawn. However, static configuration files (`mcp_config.json`) retain the stale capability token from the prior session. Because October validates capabilities against live PIDs, the stale token is rejected.
* **Fix & Workaround:** Use the verified zero-dependency dynamic stdio bridge (`bus-process-bridge.mjs` + `bus-process-resolver.mjs`). The bridge dynamically inspects `process.ppid`, walks the process tree via `Win32_Process` (or `ps`), resolves the live capability from `bus-processes.json` at runtime, and proxies JSON-RPC over stdio without requiring configuration file rewrites.

---

## Utilities

* [`scripts/repair-october-ownership.ps1`](./scripts/repair-october-ownership.ps1): A non-destructive PowerShell utility to inspect, backup, and resolve ownership journal conflicts in `~/.october/bus-ownership-v1.json`.
* [`scripts/bus-process-resolver.mjs`](./scripts/bus-process-resolver.mjs): Dynamically inspects parent process ancestry to look up active PID bindings and live capability tokens from `~/.october/bus-processes.json`.
* [`scripts/bus-process-bridge.mjs`](./scripts/bus-process-bridge.mjs): Lightweight stdio MCP bridge runner that dynamically injects resolved process credentials into October's stdio transport.

---

## Author & Contributions
Reported and maintained by [@tomorrowlord03](https://github.com/tomorrowlord03).  
Contributions and issue reports tracked upstream at [october-dev/october-bus](https://github.com/october-dev/october-bus).
