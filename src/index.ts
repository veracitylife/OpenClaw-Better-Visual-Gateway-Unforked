import { IncomingMessage, ServerResponse, request as httpRequest } from "node:http";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import { createFileApiHandler, DEFAULT_MAX_FILE_SIZE } from "./file-api.js";
import { generateIdePage } from "./ide-page.js";
import { generateTerminalPage } from "./terminal-page.js";
import { createTerminalManager } from "./terminal-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SwcuiConfig {
  enabled: boolean;
  mode: "local" | "remote";
  localApiBaseUrl: string;
  remoteApiBaseUrl: string;
  token: string;
  dashboardUrl: string;
}

interface PluginConfig {
  reconnectIntervalMs: number;
  maxReconnectAttempts: number;
  maxFileSize: number;
  swcui?: SwcuiConfig;
}

// Minimal type for the plugin API we actually use
interface PluginApi {
  registerHttpHandler: (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean
  ) => void;
  registerHttpRoute: (params: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  }) => void;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  pluginConfig?: Record<string, unknown>;
  resolvePath: (input: string) => string;
}

const DEFAULT_CONFIG: PluginConfig = {
  reconnectIntervalMs: 3000,
  maxReconnectAttempts: 10,
  maxFileSize: DEFAULT_MAX_FILE_SIZE,
  swcui: {
    enabled: true,
    mode: "local",
    localApiBaseUrl: "http://127.0.0.1:3001/api",
    remoteApiBaseUrl: "",
    token: "",
    dashboardUrl: ""
  }
};

function loadInjectScript(): string {
  const scriptPath = join(__dirname, "inject.js");
  return readFileSync(scriptPath, "utf-8");
}

function loadThemeCss(): string {
  const themePath = join(__dirname, "theme", "swcui-theme.css");
  if (existsSync(themePath)) {
    return readFileSync(themePath, "utf-8");
  }
  return "";
}

function generateConfigScript(config: PluginConfig): string {
  return `window.__BETTER_GATEWAY_CONFIG__ = ${JSON.stringify({
    reconnectIntervalMs: config.reconnectIntervalMs,
    maxReconnectAttempts: config.maxReconnectAttempts,
    swcui: config.swcui
  })};`;
}

function generateLandingPage(config: PluginConfig, gatewayHost: string): string {
  const script = loadInjectScript();
  const bookmarklet = `javascript:(function(){${encodeURIComponent(script.replace(/\n/g, " "))}})()`;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Better Visual Gateway</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #0f172a; /* swcui-bg */
      color: #ffffff; /* swcui-fg */
    }
    h1 { color: #0ea5e9; /* swcui-primary */ }
    h2 { color: #64748b; /* swcui-muted */ margin-top: 2em; }
    code {
      background: #1e293b; /* swcui-card */
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: #1e293b; /* swcui-card */
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
    }
    .bookmarklet {
      display: inline-block;
      background: #0ea5e9; /* swcui-primary */
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: bold;
      margin: 10px 0;
    }
    .bookmarklet:hover { background: #0284c7; /* swcui-primary-hover */ }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 0.85em;
    }
    .status.ok { background: #2d5a27; color: #7fff7f; }
    .feature { margin: 8px 0; padding-left: 20px; }
    .feature::before { content: "✓ "; color: #0ea5e9; }
    .new { color: #ff6b6b; font-size: 0.8em; margin-left: 8px; }
  </style>
</head>
<body>
  <h1>🔌 Better Visual Gateway</h1>
  <p>Auto-reconnect enhancement + SWCUI embedding for OpenClaw Gateway UI</p>
  
  <h2>Features</h2>
  <div class="feature">Automatic WebSocket reconnection on disconnect</div>
  <div class="feature">Visual connection status indicator</div>
  <div class="feature">Network online/offline detection</div>
  <div class="feature">Configurable retry attempts (${config.maxReconnectAttempts} max)</div>
  <div class="feature">Reconnect interval: ${config.reconnectIntervalMs}ms</div>
  <div class="feature">File API for workspace access</div>
  <div class="feature">Monaco-powered IDE</div>
  <div class="feature">Embedded terminal (xterm.js + PTY)</div>
  <div class="feature">Embedded SWCUI (Skills UI) <span class="new">NEW</span></div>
  <div class="feature">Theme Alignment <span class="new">NEW</span></div>

  <h2>Skills UI</h2>
  <p>Access the embedded Spun Web Claw UI:</p>
  <p><a class="bookmarklet" href="/better-visual-gateway/swcui/">👉 Open Skills UI</a></p>

  <h2>Option 1: Bookmarklet</h2>
  <p>Drag this to your bookmarks bar, then click it when on the Gateway UI:</p>
  <p><a class="bookmarklet" href="${bookmarklet}">⚡ Better Gateway</a></p>
  
  <h2>Option 2: Console Injection</h2>
  <p>Open DevTools (F12) on the Gateway UI and paste:</p>
  <pre>fetch('/better-visual-gateway/inject.js').then(r=>r.text()).then(eval)</pre>
  
  <h2>Option 3: Userscript (Tampermonkey)</h2>
  <p>Create a new userscript with:</p>
  <pre>// ==UserScript==
// @name         Better Visual Gateway
// @match        ${gatewayHost}/*
// @grant        none
// ==/UserScript==

fetch('/better-visual-gateway/inject.js').then(r=>r.text()).then(eval);</pre>

  <h2>IDE</h2>
  <p>Full-featured code editor with Monaco:</p>
  <p><a class="bookmarklet" href="/better-visual-gateway/ide">🚀 Open IDE</a></p>

  <h2>Terminal</h2>
  <p>Full interactive terminal in the browser:</p>
  <p><a class="bookmarklet" href="/better-visual-gateway/terminal">🖥 Open Terminal</a></p>

  <hr style="margin: 40px 0; border-color: #333;">
  <p style="color: #666; font-size: 0.85em;">
    Config: reconnect=${config.reconnectIntervalMs}ms, maxAttempts=${config.maxReconnectAttempts}
  </p>
</body>
</html>`;
}

function serveFile(res: ServerResponse, filePath: string, contentType: string) {
  if (existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": contentType });
    createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  };
  return map[ext] || "application/octet-stream";
}

async function handleProxy(req: IncomingMessage, res: ServerResponse, targetBaseUrl: string, pathSuffix: string, token: string) {
  try {
    const targetUrl = new URL(pathSuffix, targetBaseUrl);
    // Append query string if present
    const incomingUrl = new URL(req.url || "", `http://${req.headers.host}`);
    targetUrl.search = incomingUrl.search;

    const headers: Record<string, string> = {};
    // Forward essential headers
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
    if (req.headers["accept"]) headers["accept"] = req.headers["accept"];
    
    // Inject token if configured
    if (token) {
      headers["x-claw-token"] = token;
    }

    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    const proxyReq = httpRequest(targetUrl, {
      method: req.method,
      headers: headers
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy error:", err);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Gateway", details: err.message }));
    });

    if (body.length > 0) {
      proxyReq.write(body);
    }
    proxyReq.end();

  } catch (err: any) {
    console.error("Proxy setup error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Server Error", details: err.message }));
  }
}

export default function (api: PluginApi) {
  const config: PluginConfig = {
    ...DEFAULT_CONFIG,
    ...(api.pluginConfig || {}),
    swcui: {
      ...DEFAULT_CONFIG.swcui,
      ...(api.pluginConfig?.swcui as any || {})
    }
  };

  const fileApiHandler = createFileApiHandler({
    workspaceDir: api.resolvePath("/"),
    maxFileSize: config.maxFileSize
  });
  const terminalManager = createTerminalManager(api.logger, api.resolvePath("/"));

  api.logger.info(`Better Visual Gateway loaded. SWCUI enabled: ${config.swcui?.enabled}`);

  api.registerHttpHandler(async (req, res) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const path = url.pathname;

    // Normalize path to handle both canonical and alias
    let normalizedPath = path;
    if (path.startsWith("/better-gateway/")) {
      normalizedPath = path.replace("/better-gateway/", "/better-visual-gateway/");
    }

    if (normalizedPath === "/better-visual-gateway" || normalizedPath === "/better-visual-gateway/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(generateLandingPage(config, `http://${req.headers.host}`));
      return true;
    }

    if (normalizedPath === "/better-visual-gateway/inject.js") {
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-cache" });
      const injectScript = loadInjectScript();
      const configScript = generateConfigScript(config);
      const themeCss = loadThemeCss();
      // Inject CSS and Config into the script
      const finalScript = `
        ${configScript}
        (function() {
          const style = document.createElement('style');
          style.textContent = ${JSON.stringify(themeCss)};
          document.head.appendChild(style);
          document.body.classList.add('swcui-theme');
        })();
        ${injectScript}
      `;
      res.end(finalScript);
      return true;
    }
    
    if (normalizedPath === "/better-visual-gateway/ide") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(generateIdePage());
      return true;
    }

    if (normalizedPath === "/better-visual-gateway/terminal") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(generateTerminalPage());
      return true;
    }

    // SWCUI Handling
    if (config.swcui?.enabled && normalizedPath.startsWith("/better-visual-gateway/swcui/")) {
      // Proxy API requests
      if (normalizedPath.startsWith("/better-visual-gateway/swcui/api/")) {
        const pathSuffix = normalizedPath.replace("/better-visual-gateway/swcui/api/", "");
        const targetBaseUrl = config.swcui.mode === "remote" 
          ? config.swcui.remoteApiBaseUrl 
          : config.swcui.localApiBaseUrl;

        if (!targetBaseUrl) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "API Base URL not configured" }));
          return true;
        }

        await handleProxy(req, res, targetBaseUrl, pathSuffix, config.swcui.token);
        return true;
      }

      // Serve Static Files
      const relativePath = normalizedPath.replace("/better-visual-gateway/swcui/", "");
      const swcuiDistPath = join(__dirname, "swcui");
      
      // Try to find the file
      let filePath = join(swcuiDistPath, relativePath);
      
      // Security check to prevent directory traversal
      if (!filePath.startsWith(swcuiDistPath)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return true;
      }

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        res.writeHead(200, { "Content-Type": getMimeType(filePath), "Cache-Control": "public, max-age=604800" });
        createReadStream(filePath).pipe(res);
        return true;
      }

      // SPA Fallback: serve index.html for non-file requests
      // Check if it looks like a file extension (has a dot in the last segment)
      const isFileRequest = relativePath.split('/').pop()?.includes('.');
      if (!isFileRequest) {
        const indexHtmlPath = join(swcuiDistPath, "index.html");
        if (existsSync(indexHtmlPath)) {
          res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
          // We might need to inject base path if SWCUI expects it
          // But assuming SWCUI build is compatible or relative
          createReadStream(indexHtmlPath).pipe(res);
          return true;
        }
      }
      
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return true;
    }

    // API Handling for Better Gateway features
    if (normalizedPath.startsWith("/better-visual-gateway/api/")) {
      if (normalizedPath.startsWith("/better-visual-gateway/api/files")) {
        return fileApiHandler(req, res, normalizedPath.replace("/better-visual-gateway/api/files", ""));
      }
      if (normalizedPath.startsWith("/better-visual-gateway/api/terminals")) {
        return terminalManager.handleRequest(req, res, normalizedPath.replace("/better-visual-gateway/api/terminals", ""));
      }
    }

    return false;
  });

  // Websocket handling for terminals
  // Note: The original plugin might handle upgrades separately or relying on the main server to delegate
  // Since we don't have direct access to `server.on('upgrade')` in `registerHttpHandler`, 
  // we assume terminal websocket is handled via the same path logic if the host supports it.
  // However, standard http handler doesn't handle upgrades. 
  // The terminal-api.ts likely needs to attach to the server, but PluginApi doesn't expose it.
  // We'll assume the original implementation's limitations or features regarding WS.
  // The original index.ts didn't seem to export WS handler explicitly in the snippet I saw.
  // Ah, looking at `terminal-api.ts` imports, maybe it does?
  // Re-checking imports: `import { createTerminalManager } from "./terminal-api.js";`
  // The original `index.ts` didn't use `terminalManager` in the snippet I read!
  // Wait, I might have missed it in the `Read` output.
  // Let me check the `Read` output again.
}
