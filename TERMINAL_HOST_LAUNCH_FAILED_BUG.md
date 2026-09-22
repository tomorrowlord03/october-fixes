# Bug Report: Terminal Host Launch Failure on Agent Start (`launch-failed`)

## Summary
When launching or reopening an agent CLI node (such as Google Antigravity / `agy`) directly from October's canvas interface, the terminal host immediately aborts the launch and displays a red notification toast:

> **"The terminal host could not start this session. Review the launch settings and try again."**

Developers are then forced to manually open a system command shell and start the agent CLI outside October's managed launch flow.

---

## Environment
* **Platform:** Windows 10/11 x64
* **October Version:** Desktop Application (Electron runtime v24.19.0)
* **Agent Harness:** Google Antigravity (`agy`), Gemini CLI
* **Affected Subsystem:** October Terminal Host / Core Process Spawner / Ownership Journal

---

## Log Analysis
Inspecting `%APPDATA%\October\logs\session.log` reveals the exact failure point:

```text
[terminal] launch preparation failed term-mucht2dq-2: antigravity workspace MCP config merge [scope=repo path=~/October/testing-001/.agents/mcp_config.json]: antigravity workspace MCP config merge: cannot safely update previously owned configuration: an October-owned JSON value was modified
[terminal] start refused node=term-mucht2dq-2 canvas=bbd97e1e-d475-4997-99e6-323c771c25bf code=launch-failed
```

---

## Root Cause Analysis

### 1. The Ownership Journal Architecture
October uses an internal journaling mechanism (`~/.october/bus-ownership-v1.json`) to track and manage changes made to configuration files in project repositories and user directories. Every managed file has an entry specifying:
* `provider` (e.g. `antigravity`, `gemini`, `codex`)
* `artifact` (e.g. `workspace MCP config merge`)
* `mode` (`json-merge`, `text-merge`, or `generated`)
* `inverse` (a recorded set of reverse operations to cleanly uninstall or rebase the configuration)

### 2. The Conflict Condition
When October starts an Antigravity agent in a workspace:
1. October executes `writeAntigravityWorkspaceMcpConfig(launchCwd, busBinding)`.
2. Inside `stage$1` (in October Core), October looks up the journal entry for `<workspace>/.agents/mcp_config.json`.
3. If an entry already exists, October calls `rebaseOwnedInverse(previous, current, after, mode, options)` to reconcile the current file on disk with the previously committed inverse operations.
4. `applyInverse` checks if the current JSON value at `["mcpServers", "october-bus"]` matches the `installed` value recorded in `previous.inverse`.
5. If the file was edited, replaced (for example, with a local stdio bridge), or modified in any way, `applyInverse` fails and returns:
   ```json
   { "conflict": "an October-owned JSON value was modified" }
   ```

### 3. The Fallback Regex Flaw in `legacyJsonBaseline`
October attempts to recover from this conflict by stripping October-owned keys to calculate a clean baseline:
```javascript
function legacyJsonBaseline(installed, options) {
  const baseline = cloneJson(installed);
  const servers = baseline.mcpServers;
  if (servers && octoberServer(servers["october-bus"])) {
    delete servers["october-bus"];
    if (Object.keys(servers).length === 0) delete baseline.mcpServers;
  }
  // ...
}

function octoberServer(value) {
  const text = JSON.stringify(value);
  return /127\.0\.0\.1/.test(text) && /OCTOBER_BUS_|X-October-(?:Canvas|Node|MCP-Capability)/.test(text);
}
```

Notice that `octoberServer(value)` strictly requires:
* `127.0.0.1`
* Regex match for `OCTOBER_BUS_` or `X-October-(?:Canvas|Node|MCP-Capability)`

If the configuration inside `.agents/mcp_config.json` was customized or changed to a stdio bridge (`command: node.exe`, `args: bus-process-bridge.mjs`), `octoberServer(value)` evaluates to `false`. Consequently:
1. `legacyJsonBaseline` does **not** delete `october-bus`.
2. `parsedBaseline` remains identical to `parsedCurrent`.
3. `rebaseOwnedInverse` fails to clear the conflict.
4. October throws an unhandled error:
   `antigravity workspace MCP config merge: cannot safely update previously owned configuration: an October-owned JSON value was modified`.
5. The terminal launcher catches this error, collapses it to `"launch-failed"`, and displays the generic toast notification.

---

## Upstream Fix Recommendations for October Core

### Recommendation 1: Relax `legacyJsonBaseline` Matching
Instead of strictly checking for `127.0.0.1` and HTTP headers, `legacyJsonBaseline` should also recognize October stdio bridge configurations or any server named `october-bus` / `october-bus-static`:

```javascript
function isOctoberManagedServer(key, value) {
  if (key === "october-bus" || key === "october-bus-static") {
    const str = JSON.stringify(value);
    return str.includes(".october") || str.includes("127.0.0.1") || str.includes("bus-bridge");
  }
  return false;
}
```

### Recommendation 2: Graceful Lineage Reset on User Conflict
If `rebaseOwnedInverse` encounters a conflict on an agent configuration file during launch preparation, instead of failing the terminal launch completely, October should offer to reset the owned key or overwrite it cleanly with a fresh lease.

---

## Local Workaround / Fix

1. Remove the conflicted file:
   ```powershell
   Remove-Item -Path ".\.agents\mcp_config.json" -Force -ErrorAction SilentlyContinue
   ```
2. Remove the conflicted entry from `~/.october/bus-ownership-v1.json` using [`scripts/repair-october-ownership.ps1`](./scripts/repair-october-ownership.ps1).
3. Restart or reopen the terminal in October Canvas. October will generate a clean, unconflicted `.agents/mcp_config.json` and start the agent automatically.
