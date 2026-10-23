"use strict"

const vscode = require("vscode")
const { spawn } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

const VIEW_ID = "opencode.view"
const OUTPUT_NAME = "OpenCode"

/** @type {vscode.OutputChannel | undefined} */
let output

function log(line) {
  output?.appendLine(line)
}

function stateDirectory() {
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
}

function serviceFile() {
  return path.join(stateDirectory(), "opencode", "service.json")
}

/** @returns {Promise<{ url: string, password: string, pid?: number, version?: string } | undefined>} */
async function readService() {
  try {
    const info = JSON.parse(await fs.readFile(serviceFile(), "utf8"))
    if (typeof info?.url === "string" && typeof info?.password === "string") return info
    log(`[service] ${serviceFile()} no tiene url/password`)
  } catch (error) {
    log(`[service] no se pudo leer ${serviceFile()}: ${error.message}`)
  }
  return undefined
}

function authorization(password) {
  return "Basic " + Buffer.from(`opencode:${password}`).toString("base64")
}

async function fetchServiceInfo(info) {
  try {
    const response = await fetch(new URL("/api/info", info.url), {
      headers: { authorization: authorization(info.password) },
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

async function healthy(info) {
  const body = await fetchServiceInfo(info)
  if (!body) return false
  if (typeof body?.pid === "number" && typeof info.pid === "number" && body.pid !== info.pid) return false
  return body
}

function assertCompatible(body) {
  const version = body?.version
  if (typeof version !== "string" || !version) {
    log("[service] /api/info no reporta versión; se asume OpenCode v2")
    return
  }
  if (!/^2(\.|$)/.test(version)) {
    throw new Error(`OpenCode ${version} no es compatible: esta extensión requiere OpenCode v2.`)
  }
}

function executableCandidates() {
  const configured = vscode.workspace.getConfiguration("opencode").get("path", "opencode")
  const home = os.homedir()
  const names = process.platform === "win32" ? ["opencode.exe", "opencode.cmd"] : ["opencode"]
  const candidates = [configured]
  for (const name of names) {
    candidates.push(path.join(home, ".opencode", "bin", name))
    candidates.push(path.join("/usr/local/bin", name))
    candidates.push(path.join("/usr/bin", name))
  }
  return [...new Set(candidates.filter(Boolean))]
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} ${args.join(" ")} tardó demasiado`))
    }, 25_000)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} terminó con código ${code}`))
    })
  })
}

async function runServiceCommand(args) {
  const failures = []
  for (const candidate of executableCandidates()) {
    try {
      await run(candidate, args)
      log(`[service] ${candidate} ${args.join(" ")} -> ok`)
      return
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`)
      log(`[service] ${candidate} ${args.join(" ")} -> ${error.message}`)
      if (error.code !== "ENOENT") break
    }
  }
  throw new Error(`No se pudo ejecutar "opencode ${args.join(" ")}". ${failures.join(" | ")}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForService(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = await readService()
    if (info && (await healthy(info))) return info
    await sleep(400)
  }
  return undefined
}

async function ensureService() {
  const existing = await readService()
  if (existing) {
    const body = await healthy(existing)
    if (body) {
      assertCompatible(body)
      log(`[service] reutilizando ${existing.url}`)
      return existing
    }
  }

  if (!vscode.workspace.getConfiguration("opencode").get("autoStart", true)) {
    throw new Error(
      "El servicio de OpenCode no está en marcha. Arráncalo con `opencode service start` o activa `opencode.autoStart`.",
    )
  }

  log("[service] arrancando")
  await runServiceCommand(["service", "start"])
  let info = await waitForService(20_000)
  if (!info) {
    await runServiceCommand(["service", "restart"])
    info = await waitForService(20_000)
  }
  if (!info) throw new Error("El servicio de OpenCode no respondió después de arrancarlo.")
  const body = await healthy(info)
  if (!body) throw new Error("El servicio de OpenCode no respondió después de arrancarlo.")
  assertCompatible(body)
  return info
}

async function issueToken(info) {
  const pair = await fetch(new URL("/api/pair", info.url), {
    method: "POST",
    headers: { authorization: authorization(info.password) },
    signal: AbortSignal.timeout(5000),
  })
  if (!pair.ok) throw new Error(`No se pudo crear el código de emparejamiento (HTTP ${pair.status}).`)
  const { code } = await pair.json()

  const connect = await fetch(new URL(`/auth/connect/${code}`, info.url), {
    headers: { accept: "application/json", authorization: authorization(info.password) },
    signal: AbortSignal.timeout(5000),
  })
  if (!connect.ok) throw new Error(`No se pudo canjear el código de emparejamiento (HTTP ${connect.status}).`)
  const { token } = await connect.json()
  if (typeof token !== "string") throw new Error("El servidor no devolvió un token de sesión.")
  return token
}

async function apiRequest(info, pathname, options = {}) {
  const headers = {
    accept: "application/json",
    authorization: authorization(info.password),
  }
  if (options.body !== undefined) headers["content-type"] = "application/json"
  const response = await fetch(new URL(pathname, info.url), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${pathname}`)
  if (response.status === 204) return undefined
  return response.json()
}

function workspaceDirectory(document) {
  if (document) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (folder) return folder.uri.fsPath
  }
  const active = vscode.window.activeTextEditor?.document
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active.uri)
    if (folder) return folder.uri.fsPath
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

async function ensureWorkspaceSession(info, directory, options = {}) {
  const query = `directory=${encodeURIComponent(directory)}&limit=100&order=desc`
  const list = await apiRequest(info, `/api/session?${query}`)
  const roots = (list?.data ?? []).filter((session) => !session.parentID)
  // El chat abierto en la UI se marca con time.viewed. Es mejor señal que
  // time.updated, porque otra conversación puede estar corriendo en segundo
  // plano y actualizarse más tarde sin ser la que el usuario está viendo.
  const viewed = roots
    .filter((session) => typeof session.time?.viewed === "number")
    .sort((a, b) => (b.time.viewed ?? 0) - (a.time.viewed ?? 0))
  const existing = viewed[0] ?? roots[0]
  if (existing?.id) return existing.id
  if (options.create === false) return undefined

  const created = await apiRequest(info, "/api/session", {
    method: "POST",
    body: { location: { directory } },
  })
  const id = created?.data?.id
  if (!id) throw new Error("OpenCode no devolvió el ID de la sesión creada.")
  log(`[session] creada ${id} en ${directory}`)
  return id
}

function appUrl(info, token, sessionID) {
  const encoded = Buffer.from(`opencode:${token}`).toString("base64")
  const auth = `auth_token=${encodeURIComponent(encoded)}`
  const base = info.url.replace(/\/+$/, "")
  if (!sessionID) return `${base}/?${auth}`
  const serverKey = Buffer.from(base).toString("base64url")
  return `${base}/server/${serverKey}/session/${encodeURIComponent(sessionID)}?${auth}`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function documentHtml(body, script) {
  const nonce = crypto.randomBytes(16).toString("base64")
  const origin = (() => {
    try {
      return new URL(body.origin).origin
    } catch {
      return ""
    }
  })()
  const frame = body.frame ? `frame-src ${origin};` : ""
  const style = `
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: var(--vscode-sideBar-background, #1e1e1e); color: var(--vscode-foreground, #ccc); font-family: var(--vscode-font-family, sans-serif); }
    iframe { border: 0; width: 100%; height: 100%; display: block; background: transparent; }
    .state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; box-sizing: border-box; text-align: center; }
    .state p { margin: 0; opacity: 0.8; font-size: 12px; line-height: 1.5; }
    .state code { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
    .spinner { width: 22px; height: 22px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: spin 0.8s linear infinite; opacity: 0.7; }
    button { border: 0; border-radius: 4px; padding: 6px 12px; cursor: pointer; color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); font-size: 12px; }
    button:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    @keyframes spin { to { transform: rotate(360deg); } }
  `
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${frame} style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${origin || "'none'"} data:;" />
<style>${style}</style>
</head>
<body>
${body.content}
${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`
}

function loadingHtml() {
  return documentHtml({
    origin: "https://localhost",
    content: `<div class="state"><div class="spinner"></div><p>Conectando con OpenCode…</p></div>`,
  })
}

function errorHtml(message) {
  return documentHtml({
    origin: "https://localhost",
    content: `<div class="state">
      <p><strong>No se pudo abrir OpenCode</strong></p>
      <p><code>${escapeHtml(message)}</code></p>
      <button id="retry">Reintentar</button>
    </div>`,
    script: `document.getElementById('retry').addEventListener('click', () => acquireVsCodeApi().postMessage({ type: 'retry' }))`,
  })
}

function appHtml(url) {
  return documentHtml({
    origin: url,
    frame: true,
    content: `<iframe id="app" src="${escapeHtml(url)}" allow="clipboard-read; clipboard-write"></iframe>`,
  })
}

class OpenCodePanels {
  constructor(context) {
    this.context = context
    /** @type {Set<vscode.Webview>} */
    this.webviews = new Set()
    /** @type {vscode.WebviewPanel | undefined} */
    this.panel = undefined
    /** @type {vscode.WebviewView | undefined} */
    this.view = undefined
    /** @type {string | undefined} */
    this.pendingSession = undefined
  }

  async attach(webview) {
    this.webviews.add(webview)
    webview.onDidReceiveMessage((message) => {
      if (message?.type === "retry") void this.render(webview)
    })
    await this.render(webview)
  }

  async render(webview, sessionID) {
    webview.html = loadingHtml()
    try {
      const info = await ensureService()
      const token = await issueToken(info)
      let sid = sessionID ?? this.pendingSession
      if (!sid) {
        const directory = workspaceDirectory()
        if (directory) {
          try {
            sid = await ensureWorkspaceSession(info, directory)
          } catch (error) {
            log(`[session] no se pudo abrir el workspace: ${error.message}`)
          }
        }
      }
      webview.html = appHtml(appUrl(info, token, sid))
      log(`[webview] conectado a ${info.url}${sid ? ` (sesión ${sid})` : ""}`)
    } catch (error) {
      const message = error?.message ?? String(error)
      log(`[webview] error: ${message}`)
      webview.html = errorHtml(message)
    }
  }

  async showSession(sessionID) {
    this.pendingSession = sessionID
    for (const webview of this.webviews) void this.render(webview, sessionID)
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
  }

  refresh() {
    if (this.webviews.size === 0) {
      void vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      return
    }
    for (const webview of this.webviews) void this.render(webview)
  }

  async resolveWebviewView(view) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.onDidDispose(() => {
      this.webviews.delete(view.webview)
      if (this.view === view) this.view = undefined
    })
    await this.attach(view.webview)
  }

  isOpenCodeVisible() {
    return Boolean(this.view && this.view.visible)
  }

  async openInEditor(column) {
    if (this.panel) {
      this.panel.reveal(undefined, false)
      return
    }

    const placement =
      column ??
      (() => {
        const configured = vscode.workspace.getConfiguration("opencode").get("openInEditorColumn", "left")
        if (configured === "active") return vscode.ViewColumn.Active
        if (configured === "right") return vscode.ViewColumn.Beside
        return vscode.ViewColumn.One
      })()
    const panel = vscode.window.createWebviewPanel("opencode.panel", "OpenCode", placement, {
      enableScripts: true,
      retainContextWhenHidden: true,
    })
    this.panel = panel
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "activity.svg")
    panel.onDidDispose(() => {
      this.webviews.delete(panel.webview)
      if (this.panel === panel) this.panel = undefined
    })
    await this.attach(panel.webview)
  }
}

function fileReference(editor) {
  const document = editor.document
  const selection = editor.selection
  const relative = vscode.workspace.asRelativePath(document.uri, false)
  if (selection.isEmpty) return `@${relative}:${selection.active.line + 1}`
  const start = Math.min(selection.start.line, selection.end.line) + 1
  const end = Math.max(selection.start.line, selection.end.line) + 1
  return start === end ? `@${relative}:${start}` : `@${relative}:${start}-${end}`
}

function selectionPrompt(editor) {
  const document = editor.document
  const selection = editor.selection
  const relative = vscode.workspace.asRelativePath(document.uri, false)
  const hasSelection = !selection.isEmpty
  const reference = fileReference(editor)
  let body = ""
  if (hasSelection) {
    let code = document.getText(selection)
    const limit = 20_000
    if (code.length > limit) code = `${code.slice(0, limit)}\n… (selección recortada)`
    body = `\n\n\`\`\`${document.languageId}\n${code}\n\`\`\``
  }
  return {
    text: `Contexto desde Kiro: ${reference}${body}\n\nUsa esto como contexto para mi siguiente petición.`,
    files: [
      {
        uri: document.uri.toString(),
        name: relative,
        description: "Archivo abierto en Kiro",
      },
    ],
    delivery: "queue",
  }
}

async function diagnose() {
  output.show(true)
  log("")
  log("=== Diagnóstico de OpenCode for Kiro ===")
  const results = []
  const check = (ok, label, detail = "") => {
    results.push({ ok, label })
    log(`${ok ? "✅" : "❌"} ${label}${detail ? `: ${detail}` : ""}`)
  }

  const platformOk = process.platform === "linux" || process.platform === "darwin"
  check(platformOk, "Sistema", `${process.platform} ${os.release()}${platformOk ? "" : " (Windows aún no soportado)"}`)

  const directory = workspaceDirectory()
  check(Boolean(directory), "Workspace de Kiro", directory ?? "abre una carpeta en Kiro")

  let info
  try {
    info = await readService()
  } catch {
    info = undefined
  }
  check(
    Boolean(info),
    "service.json",
    info ? serviceFile() : `no existe ${serviceFile()}. Ejecuta: opencode service start`,
  )

  let body
  if (info) {
    body = await fetchServiceInfo(info)
    check(Boolean(body), "Servicio", body ? info.url : `no responde en ${info.url}. Ejecuta: opencode service restart`)
    if (body) {
      const version = body.version
      check(typeof version === "string" && /^2(\.|$)/.test(version), "OpenCode v2", version ?? "sin versión")
    }
  }

  if (info && body) {
    try {
      const token = await issueToken(info)
      check(true, "Pairing", `token de ${token.length} caracteres`)
    } catch (error) {
      check(false, "Pairing", error.message)
    }
  }

  if (info && body && directory) {
    try {
      const sessionID = await ensureWorkspaceSession(info, directory, { create: false })
      check(true, "Sesión del workspace", sessionID ?? "no hay sesiones todavía; se creará al abrir OpenCode")
    } catch (error) {
      check(false, "Sesión del workspace", error.message)
    }
  }

  const failed = results.filter((result) => !result.ok)
  if (failed.length === 0) {
    vscode.window.showInformationMessage("OpenCode: requisitos correctos. Revisa Output → OpenCode para el detalle.")
  } else {
    vscode.window.showWarningMessage(`OpenCode: ${failed.length} comprobación(es) con problemas. Revisa Output → OpenCode.`)
  }
}

function activate(context) {
  output = vscode.window.createOutputChannel(OUTPUT_NAME)
  context.subscriptions.push(output)

  const panels = new OpenCodePanels(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, panels, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  const showKiroChat = async () => {
    try {
      await vscode.commands.executeCommand("kiroAgent.chatView.focus")
    } catch {
      try {
        await vscode.commands.executeCommand("workbench.view.extension.chat.focus")
      } catch {
        vscode.window.showErrorMessage("OpenCode: no se pudo abrir el chat de Kiro.")
      }
    }
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.text = "$(sparkle) OpenCode"
  status.tooltip = "Alternar OpenCode / chat de Kiro"
  status.command = "opencode.toggle"
  status.show()
  context.subscriptions.push(status)

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.focus", () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
    vscode.commands.registerCommand("opencode.toggle", async () => {
      if (panels.isOpenCodeVisible()) {
        await showKiroChat()
      } else {
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      }
    }),
    vscode.commands.registerCommand("opencode.openInEditor", () => panels.openInEditor()),
    vscode.commands.registerCommand("opencode.showKiroChat", showKiroChat),
    vscode.commands.registerCommand("opencode.refresh", () => panels.refresh()),
    vscode.commands.registerCommand("opencode.restartService", async () => {
      try {
        await runServiceCommand(["service", "restart"])
        panels.refresh()
        vscode.window.showInformationMessage("OpenCode: servicio reiniciado.")
      } catch (error) {
        vscode.window.showErrorMessage(`OpenCode: ${error.message}`)
      }
    }),
    vscode.commands.registerCommand("opencode.diagnose", diagnose),
    vscode.commands.registerCommand("opencode.copyReference", async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showWarningMessage("OpenCode: no hay un archivo activo.")
        return
      }
      const reference = fileReference(editor)
      await vscode.env.clipboard.writeText(reference)
      vscode.window.showInformationMessage(`OpenCode: copiado ${reference}. Pégalo en el chat.`)
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
    }),
    vscode.commands.registerCommand("opencode.sendSelection", async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showWarningMessage("OpenCode: no hay un archivo activo.")
        return
      }
      if (editor.document.uri.scheme !== "file") {
        vscode.window.showWarningMessage("OpenCode: el archivo activo no está en disco.")
        return
      }
      const directory = workspaceDirectory(editor.document)
      if (!directory) {
        vscode.window.showWarningMessage("OpenCode: abre una carpeta en Kiro para usar el workspace.")
        return
      }
      try {
        const info = await ensureService()
        const sessionID = await ensureWorkspaceSession(info, directory)
        await apiRequest(info, `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
          method: "POST",
          body: selectionPrompt(editor),
        })
        await panels.showSession(sessionID)
        vscode.window.setStatusBarMessage("OpenCode: contexto enviado.", 3000)
      } catch (error) {
        vscode.window.showErrorMessage(`OpenCode: ${error.message}`)
      }
    }),
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      panels.pendingSession = undefined
    }),
  )
}

function deactivate() {}

module.exports = { activate, deactivate }
