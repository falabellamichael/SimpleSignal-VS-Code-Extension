"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleSignalDashboard = void 0;
const vscode = __importStar(require("vscode"));
const modelFetcher_1 = require("./modelFetcher");
class SimpleSignalDashboard {
    _extensionUri;
    static currentPanel;
    _panel;
    _disposables = [];
    static createOrShow(extensionUri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (SimpleSignalDashboard.currentPanel) {
            SimpleSignalDashboard.currentPanel._panel.reveal(column);
            SimpleSignalDashboard.currentPanel._update();
            return;
        }
        const panel = vscode.window.createWebviewPanel('simplesignalDashboard', 'SimpleSignal Hub', column || vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        SimpleSignalDashboard.currentPanel = new SimpleSignalDashboard(panel, extensionUri);
    }
    constructor(panel, _extensionUri) {
        this._extensionUri = _extensionUri;
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'autoFetch':
                    await vscode.commands.executeCommand('simplesignal.autoFetchModels');
                    this._update();
                    break;
                case 'checkVRAM':
                    await vscode.commands.executeCommand('simplesignal.checkVRAM');
                    break;
                case 'checkRAM':
                    await vscode.commands.executeCommand('simplesignal.checkRAM');
                    break;
                case 'checkModels':
                    await vscode.commands.executeCommand('simplesignal.checkLoadedModels');
                    break;
                case 'openSettings':
                    await vscode.commands.executeCommand('workbench.action.openSettingsJson');
                    break;
                case 'toggleEndpoint':
                    await this.toggleEndpoint(message.name);
                    break;
                case 'testEndpoint':
                    await this.testEndpoint(message.name);
                    break;
            }
        }, null, this._disposables);
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('simplesignal.endpoints')) {
                this._update();
            }
        }, null, this._disposables);
    }
    async toggleEndpoint(name) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = JSON.parse(JSON.stringify(config.get('endpoints', [])));
        const target = endpoints.find((e) => e.name === name);
        if (target) {
            target.enabled = target.enabled === false ? true : false;
            await config.update('endpoints', endpoints, vscode.ConfigurationTarget.Global);
            this._update();
        }
    }
    async testEndpoint(name) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        const target = endpoints.find((e) => e.name === name);
        if (target) {
            try {
                const models = await modelFetcher_1.ModelFetcher.fetchModelsForEndpoint(target);
                vscode.window.showInformationMessage(`✅ ${target.name} Connected! (${models.length} models online)`);
            }
            catch (err) {
                vscode.window.showErrorMessage(`❌ ${target.name} Connection Failed: ${err.message || err}`);
            }
        }
    }
    dispose() {
        SimpleSignalDashboard.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x)
                x.dispose();
        }
    }
    _update() {
        const webview = this._panel.webview;
        this._panel.title = '⚡ SimpleSignal Hub';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }
    _getHtmlForWebview(_webview) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        const totalModels = endpoints.reduce((sum, ep) => sum + (ep.models?.length || 0), 0);
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SimpleSignal Hub</title>
  <style>
    :root {
      --neon-accent: var(--vscode-focusBorder, #ffe600);
      --neon-glow: rgba(255, 230, 0, 0.25);
      --card-bg: var(--vscode-editor-background, #121212);
      --card-border: var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
      --text-color: var(--vscode-editor-foreground, #e0e0e0);
      --muted-text: var(--vscode-descriptionForeground, #888888);
      --badge-bg: var(--vscode-badge-background, #ffe600);
      --badge-fg: var(--vscode-badge-foreground, #000000);
    }

    * { box-sizing: border-box; }

    body {
      background-color: var(--vscode-editor-background);
      color: var(--text-color);
      font-family: var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      background: linear-gradient(135deg, rgba(255, 230, 0, 0.08) 0%, rgba(0, 0, 0, 0.4) 100%);
      border: 1px solid var(--neon-accent);
      border-radius: 12px;
      box-shadow: 0 4px 20px var(--neon-glow);
      margin-bottom: 24px;
    }

    .hero-title h1 {
      margin: 0 0 4px 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: var(--neon-accent);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .hero-title p {
      margin: 0;
      color: var(--muted-text);
      font-size: 13px;
    }

    .hero-stats {
      display: flex;
      gap: 16px;
    }

    .stat-box {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 8px 16px;
      text-align: center;
    }

    .stat-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--neon-accent);
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted-text);
    }

    .actions-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .btn {
      background: var(--vscode-button-background, #333);
      color: var(--vscode-button-foreground, #fff);
      border: 1px solid var(--neon-accent);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    }

    .btn:hover {
      background: var(--neon-accent);
      color: #000;
      box-shadow: 0 0 12px var(--neon-glow);
      transform: translateY(-1px);
    }

    .btn-secondary {
      border-color: var(--card-border);
      background: rgba(255, 255, 255, 0.05);
    }

    .search-box {
      flex: 1;
      min-width: 240px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--text-color);
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-box:focus {
      border-color: var(--neon-accent);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 20px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
      position: relative;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      border-color: var(--neon-accent);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4caf50;
      display: inline-block;
      box-shadow: 0 0 8px #4caf50;
    }

    .status-dot.disabled {
      background: #888;
      box-shadow: none;
    }

    .card-url {
      font-size: 12px;
      color: var(--muted-text);
      font-family: var(--vscode-editor-font-family, monospace);
      word-break: break-all;
      margin-bottom: 12px;
    }

    .model-list {
      max-height: 180px;
      overflow-y: auto;
      border-top: 1px solid var(--card-border);
      padding-top: 10px;
      margin-top: 10px;
    }

    .model-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 4px;
      background: rgba(255, 255, 255, 0.02);
    }

    .model-item:hover {
      background: rgba(255, 230, 0, 0.08);
    }

    .model-name {
      font-family: var(--vscode-editor-font-family, monospace);
      font-weight: 500;
    }

    .badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-color);
      margin-left: 4px;
    }

    .card-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--card-border);
    }

    .card-btn {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-color);
      padding: 4px 10px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
    }

    .card-btn:hover {
      border-color: var(--neon-accent);
      color: var(--neon-accent);
    }
  </style>
</head>
<body>
  <div class="hero">
    <div class="hero-title">
      <h1>⚡ SimpleSignal Hub</h1>
      <p>Universal AI endpoints active directly in VS Code native Chat & Inline Chat</p>
    </div>
    <div class="hero-stats">
      <div class="stat-box">
        <div class="stat-value">${endpoints.length}</div>
        <div class="stat-label">Endpoints</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${totalModels}</div>
        <div class="stat-label">Models</div>
      </div>
    </div>
  </div>

  <div class="actions-bar">
    <button class="btn" onclick="triggerAutoFetch()">
      ⚡ Auto-Fetch & Fill JSON
    </button>
    <button class="btn btn-secondary" onclick="checkVRAM()">
      🎮 Check VRAM
    </button>
    <button class="btn btn-secondary" onclick="checkRAM()">
      💾 Check RAM
    </button>
    <button class="btn btn-secondary" onclick="checkModels()">
      🤖 Stray Models
    </button>
    <button class="btn btn-secondary" onclick="openSettings()">
      ⚙️ Settings JSON
    </button>
    <input type="text" class="search-box" id="searchInput" placeholder="🔍 Filter models across all endpoints..." onkeyup="filterModels()" />
  </div>

  <div class="grid" id="endpointsGrid">
    ${endpoints
            .map((ep) => {
            const isEnabled = ep.enabled !== false;
            const models = ep.models || [];
            return `
      <div class="card" data-name="${ep.name.toLowerCase()}">
        <div class="card-header">
          <h3 class="card-title">
            <span class="status-dot ${isEnabled ? '' : 'disabled'}"></span>
            ${ep.name}
          </h3>
          <span class="badge">${ep.protocol || 'openai'}</span>
        </div>
        <div class="card-url">${ep.baseUrl}</div>
        <div class="model-list">
          ${models.length > 0
                ? models
                    .map((m) => `
            <div class="model-item" data-model="${m.id.toLowerCase()}">
              <span class="model-name">${m.id}</span>
              <div>
                ${m.supportsVision ? '<span class="badge">👁️</span>' : ''}
                ${m.supportsTools ? '<span class="badge">🛠️</span>' : ''}
              </div>
            </div>`)
                    .join('')
                : '<div style="color: var(--muted-text); font-size: 12px;">No models fetched yet. Click "Auto-Fetch".</div>'}
        </div>
        <div class="card-footer">
          <button class="card-btn" onclick="testEndpoint('${ep.name}')">🧪 Test</button>
          <button class="card-btn" onclick="toggleEndpoint('${ep.name}')">${isEnabled ? 'Disable' : 'Enable'}</button>
        </div>
      </div>`;
        })
            .join('')}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function triggerAutoFetch() {
      vscode.postMessage({ command: 'autoFetch' });
    }

    function checkVRAM() {
      vscode.postMessage({ command: 'checkVRAM' });
    }

    function checkRAM() {
      vscode.postMessage({ command: 'checkRAM' });
    }

    function checkModels() {
      vscode.postMessage({ command: 'checkModels' });
    }

    function openSettings() {
      vscode.postMessage({ command: 'openSettings' });
    }

    function toggleEndpoint(name) {
      vscode.postMessage({ command: 'toggleEndpoint', name });
    }

    function testEndpoint(name) {
      vscode.postMessage({ command: 'testEndpoint', name });
    }

    function filterModels() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const cards = document.querySelectorAll('.card');
      cards.forEach(card => {
        const items = card.querySelectorAll('.model-item');
        let anyVisible = false;
        items.forEach(item => {
          const text = item.getAttribute('data-model') || '';
          if (text.includes(q) || !q) {
            item.style.display = 'flex';
            anyVisible = true;
          } else {
            item.style.display = 'none';
          }
        });
        const cardName = card.getAttribute('data-name') || '';
        if (cardName.includes(q) || anyVisible || !q) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
    }
}
exports.SimpleSignalDashboard = SimpleSignalDashboard;
//# sourceMappingURL=dashboard.js.map