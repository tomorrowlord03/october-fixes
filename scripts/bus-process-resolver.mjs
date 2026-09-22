import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const registryPath = join(homedir(), ".october", "bus-processes.json")

const bindingAt = (registry, pid) => {
  const value = registry[String(pid)]
  if (!value || typeof value !== "object") return null
  if (!Number.isInteger(value.port) || value.port <= 0) return null
  if (typeof value.canvas !== "string" || !value.canvas || typeof value.node !== "string" || !value.node) return null
  if (typeof value.launch !== "string" || !value.launch || value.launch.length > 256) return null
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) return null
  if (typeof value.hookCredential !== "string" || !/^[A-Za-z0-9_-]{40,128}$/.test(value.hookCredential)) return null
  if (typeof value.mcpCapability !== "string" || !/^[A-Za-z0-9_-]{40,128}$/.test(value.mcpCapability)) return null
  return { common: {
    OCTOBER_BUS_PORT: String(value.port),
    OCTOBER_BUS_CANVAS: value.canvas,
    OCTOBER_BUS_NODE: value.node
  }, launch: value.launch, hookCredential: value.hookCredential, mcpCapability: value.mcpCapability, createdAt: value.createdAt }
}

const freshLaunchAt = (registry, key) => {
  const binding = bindingAt(registry, key)
  if (!binding) return null
  const age = Date.now() - binding.createdAt
  return age >= 0 && age <= 30000 ? binding : null
}

export function resolveOctoberBusIdentity(purpose, startPid = process.ppid) {
  try {
    const seen = new Set()
    const ancestry = []
    let pid = Number(startPid)
    for (let depth = 0; depth < 15; depth += 1) {
      if (!Number.isInteger(pid) || pid <= 1 || seen.has(pid)) break
      seen.add(pid)
      ancestry.push(pid)
      const result = process.platform === "win32"
        ? spawnSync("powershell.exe", [
            "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
            "& { param($id) $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $id); if ($null -ne $p) { [Console]::Out.Write($p.ParentProcessId) } }",
            String(pid)
          ], { encoding: "utf8", timeout: 2500, stdio: ["ignore", "pipe", "ignore"] })
        : spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"]
      })
      const parent = String(result.stdout || "").trim()
      if (!/^[1-9]\d*$/.test(parent)) break
      pid = Number(parent)
    }
    // A scrubbed provider child can start between Core spawning the PTY root and main publishing
    // that root pid. Main writes a validated launch:* record before spawn and removes it only after
    // exact PID publication or rollback. While any such launch is pending, wait for state change and
    // keep matching only this child's ancestry; the pending record is a barrier, never an identity.
    // Outside an October launch there is no pending record, so the wrapper remains immediately inert.
    const waitCell = new Int32Array(new SharedArrayBuffer(4))
    for (;;) {
      let registry = {}
      try { registry = JSON.parse(readFileSync(registryPath, "utf8")) } catch {}
      const launch = process.env.OCTOBER_BUS_LAUNCH
      const launched = typeof launch === "string" ? freshLaunchAt(registry, "launch:" + launch) : null
      const found = launched || ancestry.map((ancestor) => bindingAt(registry, ancestor)).find(Boolean)
      if (found) return purpose === "hook"
        ? { ...found.common, OCTOBER_BUS_LAUNCH: found.launch, OCTOBER_BUS_TOKEN: found.hookCredential, OCTOBER_BUS_MCP_CAPABILITY: found.mcpCapability }
        : { ...found.common, OCTOBER_BUS_MCP_CAPABILITY: found.mcpCapability }
      const launchPending = Object.entries(registry).some(([key]) => key.startsWith("launch:") && freshLaunchAt(registry, key))
      if (!launchPending) break
      Atomics.wait(waitCell, 0, 0, 25)
    }
  } catch {}
  return null
}
