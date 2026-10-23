"use strict"

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Module = require("node:module")

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const extension = require("../extension.js")
const {
  SseParser,
  chooseContextTarget,
  chooseWorkspaceSession,
  commandFor,
  formatRelativeTime,
  quoteCmd,
  resolveExecutable,
  run,
  sortSessionsByActivity,
} = extension.__test

async function main() {
  assert.equal(quoteCmd("C:\\Program Files\\opencode\\opencode.cmd"), '"C:\\Program Files\\opencode\\opencode.cmd"')

  const now = Date.now()
  const sessions = [
    {
      id: "background",
      title: "Background",
      time: { viewed: now - 60_000, updated: now + 60_000 },
    },
    {
      id: "active",
      title: "Active",
      time: { viewed: now, updated: now - 60_000 },
    },
    {
      id: "child",
      parentID: "background",
      title: "Child",
      time: { viewed: now + 120_000, updated: now + 120_000 },
    },
    {
      id: "archived",
      title: "Archived",
      time: { viewed: now + 180_000, archived: now },
    },
  ]

  assert.equal(chooseWorkspaceSession(sessions).id, "active")
  assert.equal(chooseWorkspaceSession(sessions, "background").id, "background")
  assert.equal(chooseWorkspaceSession([], "background"), undefined)
  assert.equal(chooseContextTarget(sessions, undefined, undefined).id, "active")
  assert.equal(chooseContextTarget(sessions, "background", "active").id, "background")
  assert.equal(chooseContextTarget(sessions, "missing", "active").id, "active")
  assert.equal(chooseContextTarget(sessions, "child", "active").id, "active")
  assert.equal(chooseContextTarget(sessions, "archived", "active").id, "active")
  assert.deepEqual(
    sortSessionsByActivity(sessions.filter((session) => !session.parentID && !session.time.archived)).map(
      (session) => session.id,
    ),
    ["active", "background"],
  )

  assert.equal(formatRelativeTime(now), "ahora")
  assert.equal(formatRelativeTime(now - 5 * 60_000), "hace 5 min")
  assert.equal(formatRelativeTime(undefined), "sin registro")

  const parser = new SseParser()
  assert.deepEqual(parser.push('data: {"type":"a"}\n\n'), [{ type: "a" }])
  assert.deepEqual(parser.push('data: {"type":"b"}\n'), [])
  assert.deepEqual(parser.push("\n"), [{ type: "b" }])
  assert.deepEqual(parser.push(": heartbeat\n\n"), [])
  assert.deepEqual(parser.push('data: {"type":"c"}\r\n\r\n'), [{ type: "c" }])
  assert.deepEqual(parser.push('data: {"type":"multi",\ndata: "value":1}\n\n'), [{ type: "multi", value: 1 }])
  assert.deepEqual(parser.push("data: not-json\n\n"), [])

  const unix = commandFor("/bin/sh", ["-c", "exit 0"])
  assert.equal(unix.file, "/bin/sh")
  assert.deepEqual(unix.args, ["-c", "exit 0"])
  assert.equal(unix.windowsVerbatimArguments, false)

  const exe = commandFor("C:\\Program Files\\opencode\\opencode.exe", ["service"], "win32")
  assert.equal(exe.file, "C:\\Program Files\\opencode\\opencode.exe")
  assert.equal(exe.windowsVerbatimArguments, false)

  const cmd = commandFor("C:\\Program Files\\opencode\\opencode.cmd", ["service"], "win32")
  assert.equal(cmd.file, "cmd.exe")
  assert.equal(cmd.windowsVerbatimArguments, true)
  assert.equal(cmd.args[3], '""C:\\Program Files\\opencode\\opencode.cmd" "service""')

  await run("/bin/sh", ["-c", "exit 0"])
  await assert.rejects(run("/bin/sh", ["-c", "exit 3"]), /código 3/)

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-kiro-test-"))
  const originalPath = process.env.PATH
  const originalPathExt = process.env.PATHEXT
  const originalComSpec = process.env.ComSpec
  try {
    fs.writeFileSync(path.join(temp, "opencode.CMD"), "@echo off\r\n")
    process.env.PATH = temp
    process.env.PATHEXT = ".CMD"
    process.env.ComSpec = "cmd.exe"

    const resolved = resolveExecutable("opencode", "win32")
    assert.equal(path.basename(resolved), "opencode.CMD")

    const windows = commandFor("opencode", ["service", "start"], "win32")
    assert.equal(windows.file, "cmd.exe")
    assert.equal(windows.windowsVerbatimArguments, true)
    assert.deepEqual(windows.args.slice(0, 3), ["/d", "/s", "/c"])
    assert.match(windows.args[3], /opencode\.CMD/)
    assert.match(windows.args[3], /"service"/)
    assert.match(windows.args[3], /"start"/)
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    if (originalPathExt === undefined) delete process.env.PATHEXT
    else process.env.PATHEXT = originalPathExt
    if (originalComSpec === undefined) delete process.env.ComSpec
    else process.env.ComSpec = originalComSpec
    fs.rmSync(temp, { recursive: true, force: true })
  }

  console.log("OK: pruebas de plataforma y ejecución")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
