# Bug Report: Agent Setup Terminal Crashes on Windows & False "Needs setup" Status

## Summary

When attempting to connect or sign in to an agent (such as Antigravity / `agy`) from **October Settings -> Agents**, two related issues occur:

1. **Terminal Launch Crash:**  
   Clicking **"Set up"** opens the *"Sign in to [Agent]"* modal, which immediately terminates with the error:  
   ```text
   The filename, directory name, or volume label syntax is incorrect.
   ```
2. **False "Needs setup" Status:**  
   The agent row in Settings displays a red indicator with `"Needs setup"` even when the agent CLI is already installed, authenticated, and functioning properly on the canvas.

---

## Technical Root Cause Analysis

### 1. PowerShell vs `cmd.exe` Syntax Mismatch in `loginCmdFor`

When the user clicks "Set up" in `AgentSetupModal`, October constructs the sign-in command using `loginCmdFor(platform, harness)`:

```javascript
function loginCmdFor(platform2, t) {
  const command = LOGIN_CMD[t];
  if (!command) return null;
  if (platform2 === "win32") {
    const homes = [
      "$HOME\\.local\\bin",
      "$HOME\\.opencode\\bin",
      "$HOME\\.kimi-code\\bin",
      "$HOME\\.grok\\bin",
      "$env:LOCALAPPDATA\\agy\\bin",
      "$env:APPDATA\\npm",
      "$env:LOCALAPPDATA\\Microsoft\\WindowsApps",
      "$env:ProgramFiles\\GitHub CLI"
    ].join(";");
    return `$env:PATH = "${homes};$env:PATH"; ${command}`;
  }
  return `export PATH="$HOME/.local/bin:...:$PATH"; ${command}`;
}
```

Notice that on `win32`, October generates:
```text
$env:PATH = "...;$env:PATH"; agy
```
This is **PowerShell syntax**.

However, October's setup terminal runner passes this command to `plainCommandInvocation(shell, command)`:
```javascript
function plainCommandInvocation(shell, command2) {
  const family = (shell.split(/[\\/]/).pop() || shell).toLowerCase();
  if (family === "bash" || family === "zsh" || family === "fish" || family === "sh")
    return { ok: true, executable: shell, args: ["-c", command2] };
  if (family === "pwsh" || family === "pwsh.exe" || family === "powershell" || family === "powershell.exe")
    return { ok: true, executable: shell, args: ["-NoLogo", "-NoProfile", "-Command", command2] };
  if (family === "cmd" || family === "cmd.exe")
    return { ok: true, executable: shell, args: ["/d", "/s", "/c", command2] };
  return { ok: false, error: "Unsupported shell" };
}
```

If the terminal shell defaults to `cmd.exe` (such as when `pwsh.exe` is not installed and `powershell.exe` is not resolved in October's `hardenedPath()`), October launches:
```cmd
cmd.exe /d /s /c "$env:PATH = \"...;$env:PATH\"; agy"
```

Because `$env:PATH` is not valid syntax in `cmd.exe`, Windows `cmd.exe` fails immediately:
```text
The filename, directory name, or volume label syntax is incorrect.
```

---

### 2. Antigravity Readiness Check Ignores OAuth Keyring Sign-In

In October's agent health checker (`agentsHealth()`):

```javascript
antigravity: {
  installed: antigravityInstalled,
  ready: antigravityInstalled && auth.antigravityApiProviderConfigured && (auth.hasGeminiKey || Boolean(process.env.GEMINI_API_KEY))
}
```

October's source includes this explicit comment:
> *"// Antigravity: keyring OAuth is unreadable, so ready folds the only verifiable signal — the API-key path, which needs a Gemini key (stored or env, like gemini's row) AND agy's own modelProvider: "gemini" setting... Installed-but-keyring-signed-in reads as not-ready here"*

October assumes that because OS keyring OAuth credentials cannot be trivially inspected by the supervisor, Antigravity must be marked `ready: false` unless a `GEMINI_API_KEY` is provided. The CLI itself works perfectly on the canvas without an API key because the user has already signed in with their Google account via browser/keyring.

---

## Teammate Peer Consultation (Canvas Collaboration)

We consulted directly with **Atlas** (the Antigravity agent on the canvas) via `october-bus` peer messaging. Atlas confirmed and suggested:

> 1. **Shell syntax mismatch:**  
>    Since October runs plain command invocations using `cmd.exe /d /s /c` on Windows, using `cmd.exe` syntax for setting `PATH` is the most direct and lightweight fix:  
>    `set "PATH=...;%PATH%" && <command>`  
>    Alternatively, October should explicitly wrap the invocation with `powershell.exe -Command ...`.
>
> 2. **Readiness check limitation:**  
>    Relying strictly on `GEMINI_API_KEY` is insufficient for users authenticated via Google OAuth. October should ideally run a quick lightweight command (e.g. `agy auth status` or `agy --version`) or inspect for the OAuth session file/keyring marker rather than treating OAuth sessions as unready.

---

## Solutions & Workarounds

### 1. Local Workaround (Available Immediately)

Configure October to explicitly use `powershell.exe` as its terminal shell.

In `%APPDATA%\October\settings.json`:
```json
{
  "terminal": {
    "shell": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  }
}
```

With `shell` set to `powershell.exe`, October matches `family === "powershell.exe"` in `plainCommandInvocation` and launches commands using:
```powershell
powershell.exe -NoLogo -NoProfile -Command "$env:PATH = ...; agy"
```
which executes cleanly without errors.

---

### 2. Recommended Upstream Fix

#### In `loginCmdFor(platform, t)`:

Switch Windows command prepending to use `cmd.exe`-compatible syntax, or set environment variables cleanly via `launchSpec.env` rather than prepending shell code into command strings:

```javascript
// Option A: cmd.exe compatible string
if (platform2 === "win32") {
  const homes = [
    "%USERPROFILE%\\.local\\bin",
    "%USERPROFILE%\\.opencode\\bin",
    "%LOCALAPPDATA%\\agy\\bin",
    "%APPDATA%\\npm",
    "%LOCALAPPDATA%\\Microsoft\\WindowsApps",
    "%ProgramFiles%\\GitHub CLI"
  ].join(";");
  return `set "PATH=${homes};%PATH%" && ${command}`;
}
```

```javascript
// Option B: Explicit PowerShell wrapper
if (platform2 === "win32") {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$env:PATH = '${homes};' + $env:PATH; ${command}"`;
}
```

#### In `agentsHealth()`:

Support OAuth sign-in detection for Antigravity, either by checking the credential file presence or running a cached health probe like `agy auth status`.
