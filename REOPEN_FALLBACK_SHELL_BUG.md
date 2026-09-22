# Bug Report: Reopen / Restart Failure on Lingering Fallback Shell

## Summary
When an agent process in October Canvas terminates or fails, October places the terminal into a fallback shell (`cmd.exe` on Windows). The terminal card displays a recovery pill banner:

> **"Antigravity exited · Reopen Antigravity"**

However, clicking **"Reopen Antigravity"** or the bottom-toolbar **Restart** button fails immediately, displaying:

> **"Could not reopen this terminal. Your saved session is preserved. Try again."**

---

## Root Cause Analysis
In October Core's renderer controller (`reopenStoppedTerminal` in `app.asar`):

```javascript
async function reopenStoppedTerminal(owner, id2, size = {}) {
  const state2 = owner.getState();
  const node = state2.terminals.find((terminal) => terminal.id === id2);
  const health = state2.terminalHealth[id2];
  const liveFallback = Boolean(health?.shellFallbackEpoch && !health.exited);
  
  if (!node || !health?.exited && !liveFallback)
    return { ok: false, error: "launch-failed", reason: "This terminal is no longer stopped." };
  
  // ...
}
```

### Why Reopening Fails:
1. When an agent was previously running in the terminal and exits, the underlying terminal host PTY drops back into the interactive fallback shell (such as `cmd.exe`).
2. Because the shell process is still active, `health.exited` is `false`.
3. If `shellFallbackEpoch` was cleared during runtime (for example, when October detected the agent as active foreground), `liveFallback` is also `false`.
4. Therefore, `!health.exited && !liveFallback` evaluates to `true`.
5. October's guard condition triggers:
   ```javascript
   return { ok: false, error: "launch-failed", reason: "This terminal is no longer stopped." };
   ```
6. The UI catches `result.reason` and displays:
   `"Could not reopen this terminal. Your saved session is preserved. Try again."`

---

## Verified Solution & Workaround

### User Workaround:
1. Click inside the active terminal window at the prompt (`C:\...>`).
2. Type `exit` and press `Enter`.
3. The background `cmd.exe` process terminates, transitioning the terminal to the `exited: true` state.
4. Click **"Reopen Antigravity"** — October can now acquire the stopped terminal and relaunch the agent cleanly.

### Recommended Upstream Fix for October:
In `reopenStoppedTerminal`, if the terminal has a live fallback shell running, October should terminate or signal the lingering shell process rather than refusing the reopen operation and requiring manual user intervention in the shell.
