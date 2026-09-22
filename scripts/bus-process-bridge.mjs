#!/usr/bin/env node
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveOctoberBusIdentity } from "./bus-process-resolver.mjs"

const identity = resolveOctoberBusIdentity("mcp")
if (identity) Object.assign(process.env, identity)
await import(pathToFileURL(join(homedir(), ".october", "bus-bridge.mjs")).href)
