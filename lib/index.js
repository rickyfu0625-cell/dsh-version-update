/**
 * dsh-version-update — Host 半（零第三方依赖，仅 node 内置）。
 *
 * 提供两个 HTTP 路由：
 *   GET  /api/version/check   → 读取本机 dsh 版本 + 查 npm registry 最新版并对比。
 *   POST /api/version/update  → 打开终端并运行 npm install -g 升级命令（前台可见进度）。
 *
 * 当前版本优先读已安装 CLI 的 package.json（通过 `dsh` 可执行文件定位安装前缀），
 * 失败则回退 `dsh --version`；更新前缀同样由 `dsh` 可执行文件反推，失败回退 ~/.local。
 */

import { execFile, execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const name = "dsh-version-update";
const inject = ["webServer"];

const CHECK_PATH = "/api/version/check";
const UPDATE_PATH = "/api/version/update";
const REGISTRY_URL = "https://registry.npmjs.org/@deepseek-ai/dsh/latest";
const UPDATE_TIMEOUT_MS = 600000;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

// ────────────────────────────── 版本比较 ──────────────────────────────

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (match === null) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] || null };
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const ia = pa.pre.split(".");
  const ib = pb.pre.split(".");
  const len = Math.max(ia.length, ib.length);
  for (let i = 0; i < len; i += 1) {
    const x = ia[i];
    const y = ib[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** 转义字符串，使其可安全嵌入 AppleScript 的双引号字符串字面量。 */
function escapeAppleScript(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ────────────────────────────── 安装定位 ──────────────────────────────

/** 定位 dsh 的安装前缀：从 `dsh` 可执行文件反推（解析软链），失败回退 ~/.local。 */
function dshPrefix() {
  try {
    const which = execFileSync("which", ["dsh"], { encoding: "utf8", timeout: 5000 }).trim();
    const real = realpathSync(which.split("\n")[0]);
    // real = <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js → 上溯 6 层到 <prefix>
    let dir = dirname(real);
    for (let i = 0; i < 5; i += 1) dir = dirname(dir);
    return dir;
  } catch {
    return join(homedir(), ".local");
  }
}

/** 本机已安装的 dsh 版本：优先读 package.json，失败回退 `dsh --version`。 */
function currentVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(dshPrefix(), "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8")
    );
    if (typeof pkg.version === "string" && pkg.version !== "") return pkg.version;
  } catch {
    /* fall through to `dsh --version` */
  }
  try {
    const out = execFileSync("dsh", ["--version"], { encoding: "utf8", timeout: 15000 }).trim();
    const match = out.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
    if (match) return match[0];
  } catch {
    /* fall through */
  }
  return null;
}

// ────────────────────────────── 网络与安装 ──────────────────────────────

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout: UPDATE_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || "").trim();
        reject(new Error(detail || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * 打开 macOS 终端并运行命令（前台执行，用户可见进度）。
 * `do script` 立即返回，不等待命令完成；无可用终端/权限时会 reject。
 */
function openTerminal(command) {
  const script = 'tell application "Terminal"\n  activate\n  do script "' + escapeAppleScript(command) + '"\nend tell';
  return run("osascript", ["-e", script]);
}

async function fetchLatestVersion() {
  const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`npm registry 返回 HTTP ${res.status}`);
  const data = await res.json();
  if (data === null || typeof data !== "object" || typeof data.version !== "string") {
    throw new Error("npm registry 响应缺少 version 字段");
  }
  return data.version;
}

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

// ────────────────────────────── 插件主体 ──────────────────────────────

function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: CHECK_PATH,
    handler: async (_req, res) => {
      const current = currentVersion();
      try {
        const latest = await fetchLatestVersion();
        const upToDate = current === null ? null : compareVersions(current, latest) >= 0;
        sendJson(res, 200, { current, latest, upToDate, error: null });
      } catch (error) {
        sendJson(res, 200, { current, latest: null, upToDate: null, error: messageOf(error) });
      }
    }
  }), "dsh-version-update: check route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: UPDATE_PATH,
    handler: async (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        const url = new URL(req.url ?? "/", "http://x");
        const requested = url.searchParams.get("version");
        const target = (typeof requested === "string" && requested !== "") ? requested : await fetchLatestVersion();
        const prefix = dshPrefix();
        const command = `npm install -g @deepseek-ai/dsh@${target} --prefix ${prefix} --no-audit --no-fund --no-progress`;
        await openTerminal(command);
        sendJson(res, 200, { ok: true, error: null });
      } catch (error) {
        sendJson(res, 200, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-version-update: update route");
}

export { name, inject, apply };
