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

## Utilities

* [`scripts/repair-october-ownership.ps1`](./scripts/repair-october-ownership.ps1): A non-destructive PowerShell utility to inspect, backup, and resolve ownership journal conflicts in `~/.october/bus-ownership-v1.json`.

---

## Author & Contributions
Reported and maintained by [@tomorrowlord03](https://github.com/tomorrowlord03).  
Contributions and issue reports tracked upstream at [october-dev/october-bus](https://github.com/october-dev/october-bus).
