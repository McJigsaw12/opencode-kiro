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
const { commandFor, quoteCmd, resolveExecutable, run } = extension.__test

async function main() {
  assert.equal(quoteCmd("C:\\Program Files\\opencode\\opencode.cmd"), '"C:\\Program Files\\opencode\\opencode.cmd"')

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
