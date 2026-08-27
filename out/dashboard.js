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
const benchmarkEngine_1 = require("./benchmarkEngine");
const systemDiagnostics_1 = require("./systemDiagnostics");
const telemetryTracker_1 = require("./telemetryTracker");
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
            retainContextWhenHidden: false,
        });
        SimpleSignalDashboard.currentPanel = new SimpleSignalDashboard(panel, extensionUri);
    }
    constructor(panel, _extensionUri) {
        this._extensionUri = _extensionUri;
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        // Subscribe to live telemetry events from any model used in VS Code
        this._disposables.push(telemetryTracker_1.ModelTelemetryTracker.onTelemetryEvent((event) => {
            this._panel.webview.postMessage({
                type: 'liveModelTelemetry',
                event,
                activeStats: telemetryTracker_1.ModelTelemetryTracker.getActiveStats(),
                lastStats: telemetryTracker_1.ModelTelemetryTracker.getLastStats(),
                history: telemetryTracker_1.ModelTelemetryTracker.getHistory(),
            });
        }));
        this._panel.webview.onDidReceiveMessage(async (message) => {
            try {
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
                    case 'openGitHub':
                        await vscode.env.openExternal(vscode.Uri.parse('https://github.com/falabellamichael/SimpleSignal-VS-Code-Extension'));
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
                    case 'getTelemetry':
                        await this.sendTelemetryData();
                        break;
                    case 'runBenchmark':
                        await this.handleRunBenchmark(message);
                        break;
                    case 'runAllBenchmarks':
                        await this.handleRunAllBenchmarks();
                        break;
                    case 'unloadModel':
                        await this.handleUnloadModel(message);
                        break;
                    case 'clearBenchmarkHistory':
                        benchmarkEngine_1.BenchmarkEngine.clearHistory();
                        await this.sendTelemetryData();
                        break;
                    case 'clearMessageHistory':
                        telemetryTracker_1.ModelTelemetryTracker.clearHistory();
                        await this.sendTelemetryData();
                        break;
                }
            }
            catch (err) {
                vscode.window.showErrorMessage(`SimpleSignal Hub error: ${err.message || err}`);
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
    async sendTelemetryData() {
        try {
            const [ram, vram, loadedModels] = await Promise.all([
                systemDiagnostics_1.SystemDiagnostics.getRAMDiagnostics(),
                systemDiagnostics_1.SystemDiagnostics.getVRAMDiagnostics(),
                systemDiagnostics_1.SystemDiagnostics.getLoadedModels(),
            ]);
            const history = benchmarkEngine_1.BenchmarkEngine.getHistory();
            const lastMessage = telemetryTracker_1.ModelTelemetryTracker.getLastStats();
            const activeMessage = telemetryTracker_1.ModelTelemetryTracker.getActiveStats();
            const messageHistory = telemetryTracker_1.ModelTelemetryTracker.getHistory();
            this._panel.webview.postMessage({
                type: 'telemetryUpdate',
                ram,
                vram,
                loadedModels,
                history,
                lastMessage,
                activeMessage,
                messageHistory,
            });
        }
        catch (e) {
            // ignore
        }
    }
    async handleRunBenchmark(msg) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        const ep = endpoints.find((e) => e.name === msg.endpointName);
        if (!ep) {
            vscode.window.showErrorMessage(`Endpoint "${msg.endpointName}" not found.`);
            return;
        }
        try {
            const res = await benchmarkEngine_1.BenchmarkEngine.runBenchmark(ep, msg.modelId, msg.presetId, msg.customPrompt, msg.customMaxTokens, (chunk, currentTokens, currentTPS) => {
                this._panel.webview.postMessage({
                    type: 'benchmarkChunk',
                    modelId: msg.modelId,
                    chunk,
                    currentTokens,
                    currentTPS,
                });
            });
            this._panel.webview.postMessage({
                type: 'benchmarkDone',
                result: res,
                history: benchmarkEngine_1.BenchmarkEngine.getHistory(),
            });
        }
        catch (err) {
            vscode.window.showErrorMessage(`Benchmark error: ${err.message || err}`);
        }
    }
    async handleRunAllBenchmarks() {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []).filter((e) => e.enabled !== false);
        let count = 0;
        for (const ep of endpoints) {
            for (const m of ep.models || []) {
                count++;
                this._panel.webview.postMessage({
                    type: 'benchmarkBatchStatus',
                    currentModel: m.id,
                    endpoint: ep.name,
                    progress: count,
                });
                await benchmarkEngine_1.BenchmarkEngine.runBenchmark(ep, m.id, 'quick_speed', undefined, 48, (chunk, curTok, curTPS) => {
                    this._panel.webview.postMessage({
                        type: 'benchmarkChunk',
                        modelId: m.id,
                        chunk,
                        currentTokens: curTok,
                        currentTPS: curTPS,
                    });
                });
            }
        }
        this._panel.webview.postMessage({
            type: 'benchmarkBatchComplete',
            history: benchmarkEngine_1.BenchmarkEngine.getHistory(),
        });
    }
    async handleUnloadModel(msg) {
        if (msg.source === 'ollama') {
            const ok = await systemDiagnostics_1.SystemDiagnostics.unloadOllamaModel(msg.modelName);
            if (ok)
                vscode.window.showInformationMessage(`⚡ Unloaded Ollama model: ${msg.modelName}`);
            else
                vscode.window.showErrorMessage(`Failed to unload Ollama model: ${msg.modelName}`);
        }
        else if (msg.pid) {
            const ok = await systemDiagnostics_1.SystemDiagnostics.killProcess(msg.pid);
            if (ok)
                vscode.window.showInformationMessage(`⚡ Terminated process (PID ${msg.pid}) for ${msg.modelName}`);
            else
                vscode.window.showErrorMessage(`Failed to terminate PID ${msg.pid}`);
        }
        await this.sendTelemetryData();
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
        this._panel.title = '⚡ SimpleSignal Hub';
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }
    _getHtmlForWebview(_webview) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        const totalModels = endpoints.reduce((sum, ep) => sum + (ep.models?.length || 0), 0);
        const allModelsList = [];
        for (const ep of endpoints) {
            if (ep.enabled === false)
                continue;
            for (const m of ep.models || []) {
                allModelsList.push({ epName: ep.name, modelId: m.id });
            }
        }
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>SimpleSignal Hub</title>
  <style>
    :root {
      --neon-accent: var(--vscode-focusBorder, #ffe600);
      --neon-glow: rgba(255, 230, 0, 0.28);
      --neon-cyan: #00e5ff;
      --neon-cyan-glow: rgba(0, 229, 255, 0.25);
      --card-bg: var(--vscode-editor-background, #121212);
      --card-border: var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
      --text-color: var(--vscode-editor-foreground, #e0e0e0);
      --muted-text: var(--vscode-descriptionForeground, #888888);
      --badge-bg: var(--vscode-badge-background, #ffe600);
      --badge-fg: var(--vscode-badge-foreground, #000000);
      --green: #4caf50;
      --orange: #ff9800;
      --blue: #2196f3;
      --red: #ff5252;
    }

    * { box-sizing: border-box; }

    body {
      background-color: var(--vscode-editor-background);
      color: var(--text-color);
      font-family: var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
      margin: 0;
      padding: 20px 24px;
      line-height: 1.5;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 24px;
      background: linear-gradient(135deg, rgba(255, 230, 0, 0.08) 0%, rgba(0, 0, 0, 0.45) 100%);
      border: 1px solid var(--neon-accent);
      border-radius: 12px;
      box-shadow: 0 4px 20px var(--neon-glow);
      margin-bottom: 20px;
    }

    .hero-title h1 {
      margin: 0 0 4px 0;
      font-size: 22px;
      font-weight: 700;
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
      gap: 12px;
    }

    .stat-box {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 6px 14px;
      text-align: center;
      min-width: 75px;
    }

    .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--neon-accent);
    }

    .stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted-text);
    }

    /* Tabs Navigation */
    .tabs-nav {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 20px;
      padding-bottom: 8px;
    }

    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--muted-text);
      padding: 9px 18px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
      user-select: none;
    }

    .tab-btn:hover {
      color: var(--text-color);
      background: rgba(255, 255, 255, 0.06);
    }

    .tab-btn.active {
      background: rgba(255, 230, 0, 0.14) !important;
      border: 1px solid var(--neon-accent) !important;
      color: var(--neon-accent) !important;
      box-shadow: 0 0 10px var(--neon-glow);
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block !important;
    }

    .actions-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      align-items: center;
    }

    .btn {
      background: var(--vscode-button-background, #333);
      color: var(--vscode-button-foreground, #fff);
      border: 1px solid var(--neon-accent);
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      user-select: none;
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

    .btn-primary-neon {
      background: #ffe600;
      color: #000;
      font-weight: 700;
    }

    .btn-primary-neon:hover {
      background: #fff04d;
      box-shadow: 0 0 15px rgba(255, 230, 0, 0.6);
    }

    .search-box, .select-box, .input-text {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 7px 12px;
      color: var(--text-color);
      font-size: 12px;
      outline: none;
    }

    .search-box:focus, .select-box:focus, .input-text:focus {
      border-color: var(--neon-accent);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 18px;
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
      margin-bottom: 8px;
    }

    .card-title {
      font-size: 14px;
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
      background: var(--green);
      display: inline-block;
      box-shadow: 0 0 8px var(--green);
    }

    .status-dot.disabled {
      background: #888;
      box-shadow: none;
    }

    .card-url {
      font-size: 11px;
      color: var(--muted-text);
      font-family: var(--vscode-editor-font-family, monospace);
      word-break: break-all;
      margin-bottom: 10px;
    }

    .model-list {
      max-height: 160px;
      overflow-y: auto;
      border-top: 1px solid var(--card-border);
      padding-top: 8px;
      margin-top: 8px;
    }

    .model-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 3px;
      background: rgba(255, 255, 255, 0.02);
    }

    .badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-color);
    }

    .badge-neon {
      background: rgba(255, 230, 0, 0.15);
      border: 1px solid var(--neon-accent);
      color: var(--neon-accent);
      font-weight: 600;
    }

    .badge-cyan {
      background: rgba(0, 229, 255, 0.15);
      border: 1px solid var(--neon-cyan);
      color: var(--neon-cyan);
      font-weight: 600;
    }

    .badge-green {
      background: rgba(76, 175, 80, 0.15);
      border: 1px solid var(--green);
      color: var(--green);
      font-weight: 600;
    }

    .card-footer {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--card-border);
    }

    .card-btn {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-color);
      padding: 3px 8px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
    }

    .card-btn:hover {
      border-color: var(--neon-accent);
      color: var(--neon-accent);
    }

    /* ========================================================
       LIVE MODEL TELEMETRY & PERFORMANCE STYLES
       ======================================================== */
    @keyframes pulseNeon {
      0% { box-shadow: 0 0 6px rgba(255, 230, 0, 0.4); border-color: rgba(255, 230, 0, 0.6); }
      50% { box-shadow: 0 0 20px rgba(255, 230, 0, 0.9); border-color: #ffe600; }
      100% { box-shadow: 0 0 6px rgba(255, 230, 0, 0.4); border-color: rgba(255, 230, 0, 0.6); }
    }

    @keyframes pulseGreen {
      0% { box-shadow: 0 0 4px rgba(76, 175, 80, 0.4); }
      50% { box-shadow: 0 0 14px rgba(76, 175, 80, 0.8); }
      100% { box-shadow: 0 0 4px rgba(76, 175, 80, 0.4); }
    }

    .live-telemetry-hud {
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.05) 0%, rgba(0, 0, 0, 0.5) 100%);
      border: 1px solid rgba(0, 229, 255, 0.35);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
      position: relative;
    }

    .live-telemetry-hud.streaming {
      border-color: var(--neon-accent);
      animation: pulseNeon 1.8s infinite;
    }

    .hud-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
    }

    .hud-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .live-status-pill {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .live-status-pill.streaming {
      background: rgba(255, 230, 0, 0.2);
      color: #ffe600;
      border: 1px solid #ffe600;
      animation: pulseNeon 1.5s infinite;
    }

    .live-status-pill.completed {
      background: rgba(76, 175, 80, 0.2);
      color: #4caf50;
      border: 1px solid #4caf50;
    }

    .live-status-pill.error {
      background: rgba(255, 82, 82, 0.2);
      color: #ff5252;
      border: 1px solid #ff5252;
    }

    .live-status-pill.idle {
      background: rgba(255, 255, 255, 0.08);
      color: var(--muted-text);
      border: 1px solid var(--card-border);
    }

    .meter-grid-4 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }

    @media (max-width: 800px) {
      .meter-grid-4 {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .hud-meter-card {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 14px 12px;
      text-align: center;
      transition: all 0.2s ease;
      position: relative;
    }

    .hud-meter-card:hover {
      border-color: var(--neon-cyan);
      box-shadow: 0 0 10px var(--neon-cyan-glow);
    }

    .hud-meter-val {
      font-size: 26px;
      font-weight: 800;
      color: var(--neon-cyan);
      letter-spacing: -0.5px;
      line-height: 1.1;
      margin-bottom: 4px;
    }

    .hud-meter-lbl {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted-text);
      font-weight: 600;
    }

    .hud-meter-sub {
      font-size: 11px;
      color: var(--neon-accent);
      margin-top: 4px;
      font-weight: 600;
    }

    .inspector-split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    @media (max-width: 900px) {
      .inspector-split {
        grid-template-columns: 1fr;
      }
    }

    .inspector-box {
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .inspector-box-header {
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--card-border);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted-text);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .inspector-content {
      padding: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      min-height: 110px;
      max-height: 160px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
    }

    .inspector-content.prompt-text {
      color: #90caf9;
    }

    .inspector-content.stream-text {
      color: #b0ffb0;
    }

    /* Benchmark Controls */
    .benchmark-panel {
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }

    @media (max-width: 850px) {
      .benchmark-panel {
        grid-template-columns: 1fr;
      }
    }

    .benchmark-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
    }

    .benchmark-form-group {
      margin-bottom: 12px;
    }

    .benchmark-form-group label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted-text);
      margin-bottom: 4px;
    }

    /* Tables */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 20px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }

    th {
      background: rgba(255, 230, 0, 0.06);
      padding: 10px 14px;
      font-weight: 700;
      color: var(--neon-accent);
      border-bottom: 1px solid var(--card-border);
    }

    td {
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    tr:hover {
      background: rgba(255, 230, 0, 0.04);
    }

    .speed-bar-container {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
    }

    .speed-bar {
      height: 100%;
      background: linear-gradient(90deg, #ffe600, #00e5ff, #4caf50);
      border-radius: 3px;
    }

    /* Telemetry Section */
    .telemetry-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }

    .gauge-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
    }

    .gauge-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-weight: 700;
    }

    .progress-bar-wrap {
      width: 100%;
      height: 12px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 12px;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #2196f3, #ffe600, #ff5722);
      transition: width 0.3s ease;
    }

    .proc-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 4px;
      background: rgba(255, 255, 255, 0.03);
    }

    .proc-item.ai-model {
      border-left: 3px solid var(--neon-accent);
      background: rgba(255, 230, 0, 0.06);
    }
  </style>
</head>
<body>
  <div class="hero">
    <div class="hero-title">
      <h1>⚡ SimpleSignal Hub</h1>
      <p>Universal AI orchestration, real-time message telemetry, speed benchmarks & hardware diagnostics</p>
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

  <!-- Navigation Tabs -->
  <div class="tabs-nav">
    <button class="tab-btn active" id="btn-tab-endpoints" data-tab="tab-endpoints">
      📡 Signal Endpoints & Models
    </button>
    <button class="tab-btn" id="btn-tab-benchmarks" data-tab="tab-benchmarks">
      ⚡ Performance & Live Telemetry
    </button>
    <button class="tab-btn" id="btn-tab-telemetry" data-tab="tab-telemetry">
      📊 Hardware Telemetry
    </button>
  </div>

  <!-- TAB 1: ENDPOINTS & MODELS -->
  <div id="tab-endpoints" class="tab-content active">
    <div class="actions-bar">
      <button class="btn" id="btnAutoFetch">⚡ Auto-Fetch & Fill JSON</button>
      <button class="btn btn-secondary" id="btnSettings">⚙️ Settings JSON</button>
      <button class="btn btn-secondary" id="btnGitHub">
        <svg height="13" width="13" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: -1px; margin-right: 4px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
        GitHub
      </button>
      <input type="text" class="search-box" id="searchInput" placeholder="🔍 Filter models across all endpoints..." />
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
                <span style="font-family: monospace;">${m.id}</span>
                <div>
                  ${m.supportsVision ? '<span class="badge">👁️</span>' : ''}
                  ${m.supportsTools ? '<span class="badge">🛠️</span>' : ''}
                </div>
              </div>`)
                    .join('')
                : '<div style="color: var(--muted-text); font-size: 12px;">No models fetched yet. Click "Auto-Fetch".</div>'}
          </div>
          <div class="card-footer">
            <button class="card-btn" data-action="test" data-endpoint="${ep.name}">🧪 Test</button>
            <button class="card-btn" data-action="toggle" data-endpoint="${ep.name}">${isEnabled ? 'Disable' : 'Enable'}</button>
          </div>
        </div>`;
        })
            .join('')}
    </div>
  </div>

  <!-- TAB 2: PERFORMANCE & LIVE TELEMETRY -->
  <div id="tab-benchmarks" class="tab-content">
    
    <!-- 📡 LIVE MODEL TELEMETRY (LAST MESSAGE SENT IN VS CODE) -->
    <div class="live-telemetry-hud" id="liveTelemetryHud">
      <div class="hud-header">
        <div class="hud-header-left">
          <span class="live-status-pill idle" id="liveStatusBadge">⚪ Ready for Message</span>
          <span class="badge badge-neon" id="liveModelBadge">🤖 Model: None</span>
          <span class="badge badge-cyan" id="liveEndpointBadge">📡 Endpoint: -</span>
          <span class="badge" id="liveSourceBadge">💬 VS Code Chat</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="liveTimestampBadge" style="font-size: 11px; color: var(--muted-text);">No messages recorded yet</span>
          <button class="card-btn" id="btnClearMessageHistory" title="Clear message history">🗑️ Clear</button>
        </div>
      </div>

      <!-- 4 Primary Gauges -->
      <div class="meter-grid-4">
        <div class="hud-meter-card">
          <div class="hud-meter-val" id="liveTPS">0.0</div>
          <div class="hud-meter-lbl">Generation Speed (TPS)</div>
          <div class="hud-meter-sub" id="livePeakTPS">Peak: 0.0 tok/s</div>
        </div>
        <div class="hud-meter-card">
          <div class="hud-meter-val" id="liveTTFT">0 ms</div>
          <div class="hud-meter-lbl">Time to 1st Token (TTFT)</div>
          <div class="hud-meter-sub" id="liveTTFTRating">Latency: -</div>
        </div>
        <div class="hud-meter-card">
          <div class="hud-meter-val" id="liveTokens">0</div>
          <div class="hud-meter-lbl">Output Tokens</div>
          <div class="hud-meter-sub" id="livePromptTokens">Prompt: 0 tok</div>
        </div>
        <div class="hud-meter-card">
          <div class="hud-meter-val" id="liveDuration">0.0s</div>
          <div class="hud-meter-lbl">Total Latency</div>
          <div class="hud-meter-sub" id="liveGenDuration">Gen: 0.0s</div>
        </div>
      </div>

      <!-- Split Inspector: Prompt Sent vs Live Output Stream -->
      <div class="inspector-split">
        <div class="inspector-box">
          <div class="inspector-box-header">
            <span>📥 Prompt / Last Message Sent</span>
            <span id="livePromptLength" style="font-weight: normal; font-size: 10px;">0 chars</span>
          </div>
          <div class="inspector-content prompt-text" id="livePromptBox">Waiting for next message sent from VS Code...</div>
        </div>
        <div class="inspector-box">
          <div class="inspector-box-header">
            <span>⚡ Live Response Stream Preview</span>
            <span id="liveThinkingIndicator" style="display: none; color: var(--neon-accent); font-weight: normal; font-size: 10px;">💭 Thinking...</span>
          </div>
          <div class="inspector-content stream-text" id="liveStreamOutput">No active stream. Send a message in chat or run a test below!</div>
        </div>
      </div>
    </div>

    <!-- PERFORMANCE BENCHMARK CONTROLLER -->
    <div class="benchmark-panel">
      <!-- Performance Controller -->
      <div class="benchmark-card">
        <h3 style="margin-top: 0; color: var(--neon-accent); font-size: 15px;">⚡ Model Speed Test Setup</h3>
        
        <div class="benchmark-form-group">
          <label>Target Model & Endpoint</label>
          <select id="benchModelSelect" class="select-box" style="width: 100%;">
            ${allModelsList
            .map((m) => `<option value="${m.epName}|${m.modelId}">${m.modelId} [${m.epName}]</option>`)
            .join('')}
          </select>
        </div>

        <div class="benchmark-form-group">
          <label>Performance Preset</label>
          <select id="benchPresetSelect" class="select-box" style="width: 100%;">
            <option value="quick_speed">🚀 Quick Speed (64 Tokens)</option>
            <option value="code_gen">🎮 Lua 200-Line Sudoku Game (900 Tokens)</option>
            <option value="reasoning_stress">🧠 Complex Algorithm (400 Tokens)</option>
          </select>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 16px;">
          <button class="btn btn-primary-neon" style="flex: 1;" id="btnRunBenchmark">
            ▶️ Run Performance Test
          </button>
          <button class="btn btn-secondary" id="btnBatchBenchmark" title="Run speed test across all models">
            🔥 Test All Models
          </button>
        </div>
      </div>

      <!-- Quick Benchmark Output Preview -->
      <div class="benchmark-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="margin: 0; color: var(--neon-accent); font-size: 15px;">🚀 Active Test Stream Output</h3>
          <span class="badge" id="benchStatusTag">Idle</span>
        </div>
        <div class="inspector-content stream-text" id="streamOutput" style="min-height: 140px; max-height: 170px; background: rgba(0,0,0,0.4); border: 1px solid var(--card-border); border-radius: 6px;">
Waiting to run performance test...
        </div>
      </div>
    </div>

    <!-- RECENT VS CODE MODEL MESSAGES LOG -->
    <div class="table-container">
      <div style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--card-border);">
        <h3 style="margin: 0; font-size: 14px; color: var(--neon-cyan);">📜 Recent VS Code Model Messages & Live Log</h3>
        <button class="card-btn" id="btnRefreshMessages">🔄 Refresh Log</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Model ID</th>
            <th>Endpoint</th>
            <th>Source</th>
            <th>Speed (TPS)</th>
            <th>1st Token (TTFT)</th>
            <th>Tokens (Out/In)</th>
            <th>Latency</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="messageHistoryBody">
          <tr><td colspan="9" style="text-align: center; color: var(--muted-text);">No messages sent yet. Use VS Code Chat or run a speed test!</td></tr>
        </tbody>
      </table>
    </div>

    <!-- LEADERBOARD -->
    <div class="table-container" style="margin-top: 20px;">
      <div style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--card-border);">
        <h3 style="margin: 0; font-size: 14px; color: var(--neon-accent);">🏆 Model Performance Leaderboard</h3>
        <button class="card-btn" id="btnClearHistory">Clear Leaderboard</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Model ID</th>
            <th>Endpoint</th>
            <th>Speed (TPS)</th>
            <th>1st Token (TTFT)</th>
            <th>Tokens</th>
            <th>Total Latency</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="leaderboardBody">
          <tr><td colspan="8" style="text-align: center; color: var(--muted-text);">No benchmark runs recorded yet. Click "Run Performance Test" above!</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- TAB 3: TELEMETRY & HARDWARE -->
  <div id="tab-telemetry" class="tab-content">
    <div class="actions-bar">
      <button class="btn btn-primary-neon" id="btnRefreshTelemetry">🔄 Refresh Hardware Telemetry</button>
      <button class="btn btn-secondary" id="btnCheckVRAM">🎮 Detailed VRAM</button>
      <button class="btn btn-secondary" id="btnCheckRAM">💾 Detailed RAM</button>
      <button class="btn btn-secondary" id="btnCheckModels">🤖 Stray Models</button>
    </div>

    <div class="telemetry-grid">
      <!-- VRAM Gauge -->
      <div class="gauge-card">
        <div class="gauge-header">
          <span id="gpuNameDisplay">🎮 GPU Dedicated VRAM</span>
          <span id="gpuUsageDisplay" style="color: var(--neon-accent);">0 MB Used</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" id="vramBarFill" style="width: 0%;"></div>
        </div>
        <div style="font-size: 11px; color: var(--muted-text); margin-bottom: 8px; font-weight: 600;">TOP GPU PROCESSES</div>
        <div id="gpuProcessList" style="max-height: 220px; overflow-y: auto;">
          <div style="color: var(--muted-text); font-size: 12px;">Loading GPU telemetry...</div>
        </div>
      </div>

      <!-- RAM Gauge -->
      <div class="gauge-card">
        <div class="gauge-header">
          <span>💾 System RAM Memory</span>
          <span id="ramUsageDisplay" style="color: var(--neon-accent);">0 GB / 0 GB (0%)</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" id="ramBarFill" style="width: 0%;"></div>
        </div>
        <div style="font-size: 11px; color: var(--muted-text); margin-bottom: 8px; font-weight: 600;">ACTIVE AI MODEL PROCESSES</div>
        <div id="aiProcessList" style="max-height: 220px; overflow-y: auto;">
          <div style="color: var(--muted-text); font-size: 12px;">Loading RAM telemetry...</div>
        </div>
      </div>
    </div>

    <!-- Loaded Stray Models -->
    <div class="table-container">
      <div style="padding: 12px 16px; border-bottom: 1px solid var(--card-border);">
        <h3 style="margin: 0; font-size: 14px; color: var(--neon-accent);">🤖 Active & Stray Models in Memory</h3>
      </div>
      <table>
        <thead>
          <tr>
            <th>Model Name / Details</th>
            <th>Source</th>
            <th>PID</th>
            <th>VRAM</th>
            <th>RAM</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="loadedModelsBody">
          <tr><td colspan="6" style="text-align: center; color: var(--muted-text);">No stray models detected.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    (function() {
      let vscode;
      try {
        vscode = acquireVsCodeApi();
      } catch (e) {
        console.error('VsCode API acquire error:', e);
      }

      let liveStopwatchTimer = null;
      let liveStartTime = 0;

      function post(cmd, data) {
        if (vscode) {
          vscode.postMessage(Object.assign({ command: cmd }, data || {}));
        }
      }

      function formatTimeAgo(timestamp) {
        if (!timestamp) return 'Just now';
        const secAgo = Math.floor((Date.now() - timestamp) / 1000);
        if (secAgo < 5) return 'Just now';
        if (secAgo < 60) return secAgo + 's ago';
        const minAgo = Math.floor(secAgo / 60);
        if (minAgo < 60) return minAgo + 'm ago';
        const hrAgo = Math.floor(minAgo / 60);
        return hrAgo + 'h ago';
      }

      function getTTFTRating(ttftMs) {
        if (!ttftMs || ttftMs <= 0) return 'Latency: -';
        if (ttftMs < 300) return '🚀 Ultra-Fast (<300ms)';
        if (ttftMs < 800) return '⚡ Fast (<800ms)';
        if (ttftMs < 2000) return '🟢 Normal (<2s)';
        return '⏱️ ' + (ttftMs / 1000).toFixed(1) + 's TTFT';
      }

      function switchTab(tabId) {
        try {
          const tabBtns = document.querySelectorAll('.tab-btn');
          tabBtns.forEach(function(b) {
            b.classList.remove('active');
            if (b.getAttribute('data-tab') === tabId || b.id === 'btn-' + tabId) {
              b.classList.add('active');
            }
          });

          const tabContents = document.querySelectorAll('.tab-content');
          tabContents.forEach(function(c) {
            c.classList.remove('active');
            c.style.display = 'none';
          });

          const targetEl = document.getElementById(tabId);
          if (targetEl) {
            targetEl.classList.add('active');
            targetEl.style.display = 'block';
          }

          if (tabId === 'tab-telemetry' || tabId === 'tab-benchmarks') {
            post('getTelemetry');
          }
        } catch (err) {
          console.error('switchTab error:', err);
        }
      }

      // Attach DOM Listeners
      function initListeners() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            const tabId = this.getAttribute('data-tab');
            if (tabId) switchTab(tabId);
          });
        });

        // Main action buttons
        const btnAutoFetch = document.getElementById('btnAutoFetch');
        if (btnAutoFetch) btnAutoFetch.addEventListener('click', function() { post('autoFetch'); });

        const btnSettings = document.getElementById('btnSettings');
        if (btnSettings) btnSettings.addEventListener('click', function() { post('openSettings'); });

        const btnGitHub = document.getElementById('btnGitHub');
        if (btnGitHub) btnGitHub.addEventListener('click', function() { post('openGitHub'); });

        const btnRunBenchmark = document.getElementById('btnRunBenchmark');
        if (btnRunBenchmark) btnRunBenchmark.addEventListener('click', startBenchmark);

        const btnBatchBenchmark = document.getElementById('btnBatchBenchmark');
        if (btnBatchBenchmark) btnBatchBenchmark.addEventListener('click', startBatchBenchmark);

        const btnClearHistory = document.getElementById('btnClearHistory');
        if (btnClearHistory) btnClearHistory.addEventListener('click', function() { post('clearBenchmarkHistory'); });

        const btnClearMessageHistory = document.getElementById('btnClearMessageHistory');
        if (btnClearMessageHistory) btnClearMessageHistory.addEventListener('click', function() { post('clearMessageHistory'); });

        const btnRefreshMessages = document.getElementById('btnRefreshMessages');
        if (btnRefreshMessages) btnRefreshMessages.addEventListener('click', function() { post('getTelemetry'); });

        const btnRefreshTelemetry = document.getElementById('btnRefreshTelemetry');
        if (btnRefreshTelemetry) btnRefreshTelemetry.addEventListener('click', function() { post('getTelemetry'); });

        const btnCheckVRAM = document.getElementById('btnCheckVRAM');
        if (btnCheckVRAM) btnCheckVRAM.addEventListener('click', function() { post('checkVRAM'); });

        const btnCheckRAM = document.getElementById('btnCheckRAM');
        if (btnCheckRAM) btnCheckRAM.addEventListener('click', function() { post('checkRAM'); });

        const btnCheckModels = document.getElementById('btnCheckModels');
        if (btnCheckModels) btnCheckModels.addEventListener('click', function() { post('checkModels'); });

        // Search filter
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.addEventListener('input', function() {
            filterModels(this.value);
          });
        }

        // Endpoint card buttons (test / toggle)
        document.querySelectorAll('.card-btn').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            const action = this.getAttribute('data-action');
            const ep = this.getAttribute('data-endpoint');
            if (action === 'test' && ep) {
              post('testEndpoint', { name: ep });
            } else if (action === 'toggle' && ep) {
              post('toggleEndpoint', { name: ep });
            }
          });
        });
      }

      function startBenchmark() {
        const sel = document.getElementById('benchModelSelect');
        if (!sel || !sel.value) return;
        const parts = sel.value.split('|');
        const epName = parts[0];
        const modelId = parts[1];

        const presetSel = document.getElementById('benchPresetSelect');
        const presetId = presetSel ? presetSel.value : 'quick_speed';

        const outBox = document.getElementById('streamOutput');
        if (outBox) outBox.innerText = 'Initializing stream benchmark...';

        const statusTag = document.getElementById('benchStatusTag');
        if (statusTag) {
          statusTag.innerText = 'Running ⚡';
          statusTag.className = 'badge badge-neon';
        }

        post('runBenchmark', {
          endpointName: epName,
          modelId: modelId,
          presetId: presetId,
        });
      }

      function startBatchBenchmark() {
        const outBox = document.getElementById('streamOutput');
        if (outBox) outBox.innerText = 'Starting batch benchmark for all models...';
        post('runAllBenchmarks');
      }

      function filterModels(query) {
        const q = (query || '').toLowerCase();
        document.querySelectorAll('.card').forEach(function(card) {
          const items = card.querySelectorAll('.model-item');
          let anyVisible = false;
          items.forEach(function(item) {
            const text = (item.getAttribute('data-model') || '').toLowerCase();
            if (!q || text.indexOf(q) !== -1) {
              item.style.display = 'flex';
              anyVisible = true;
            } else {
              item.style.display = 'none';
            }
          });
          const cardName = (card.getAttribute('data-name') || '').toLowerCase();
          if (!q || anyVisible || cardName.indexOf(q) !== -1) {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
      }

      // Handle messages from VS Code backend
      window.addEventListener('message', function(event) {
        try {
          const msg = event.data;
          if (!msg) return;

          if (msg.type === 'liveModelTelemetry') {
            handleLiveTelemetryEvent(msg);
          } else if (msg.type === 'benchmarkChunk') {
            const outBox = document.getElementById('streamOutput');
            if (outBox) {
              outBox.innerText += (msg.chunk || '');
              outBox.scrollTop = outBox.scrollHeight;
            }
          } else if (msg.type === 'benchmarkDone') {
            const statusTag = document.getElementById('benchStatusTag');
            if (statusTag) {
              statusTag.innerText = 'Complete 🟢';
              statusTag.className = 'badge badge-green';
            }
            renderLeaderboard(msg.history);
          } else if (msg.type === 'benchmarkBatchComplete') {
            renderLeaderboard(msg.history);
          } else if (msg.type === 'telemetryUpdate') {
            renderTelemetry(msg);
          }
        } catch (e) {
          console.error('Message handler error:', e);
        }
      });

      function handleLiveTelemetryEvent(data) {
        const ev = data.event;
        const stats = ev ? ev.stats : (data.activeStats || data.lastStats);
        if (!stats) return;

        const hud = document.getElementById('liveTelemetryHud');
        const statusBadge = document.getElementById('liveStatusBadge');
        const modelBadge = document.getElementById('liveModelBadge');
        const epBadge = document.getElementById('liveEndpointBadge');
        const srcBadge = document.getElementById('liveSourceBadge');
        const timeBadge = document.getElementById('liveTimestampBadge');

        const tpsEl = document.getElementById('liveTPS');
        const peakTpsEl = document.getElementById('livePeakTPS');
        const ttftEl = document.getElementById('liveTTFT');
        const ttftRatingEl = document.getElementById('liveTTFTRating');
        const tokEl = document.getElementById('liveTokens');
        const promptTokEl = document.getElementById('livePromptTokens');
        const durEl = document.getElementById('liveDuration');
        const genDurEl = document.getElementById('liveGenDuration');

        const promptBox = document.getElementById('livePromptBox');
        const promptLenEl = document.getElementById('livePromptLength');
        const streamBox = document.getElementById('liveStreamOutput');
        const thinkingIndicator = document.getElementById('liveThinkingIndicator');

        if (modelBadge) modelBadge.innerText = '🤖 ' + (stats.modelName || stats.modelId || 'Unknown');
        if (epBadge) epBadge.innerText = '📡 ' + (stats.endpointName || 'Default');
        if (srcBadge) {
          srcBadge.innerText = stats.source === 'benchmark' ? '🎮 Benchmark Test' : '💬 VS Code Chat';
          srcBadge.className = stats.source === 'benchmark' ? 'badge badge-neon' : 'badge badge-cyan';
        }

        if (ev.type === 'start') {
          if (hud) hud.className = 'live-telemetry-hud streaming';
          if (statusBadge) {
            statusBadge.className = 'live-status-pill streaming';
            statusBadge.innerText = '⚡ ACTIVE STREAMING...';
          }
          if (timeBadge) timeBadge.innerText = 'Active now';

          if (tpsEl) tpsEl.innerText = '0.0';
          if (peakTpsEl) peakTpsEl.innerText = 'Peak: 0.0 tok/s';
          if (ttftEl) ttftEl.innerText = '...';
          if (ttftRatingEl) ttftRatingEl.innerText = 'Measuring latency...';
          if (tokEl) tokEl.innerText = '0';
          if (promptTokEl) promptTokEl.innerText = 'Prompt: ' + (stats.promptTokens || 0) + ' tok';
          if (durEl) durEl.innerText = '0.0s';
          if (genDurEl) genDurEl.innerText = 'Gen: 0.0s';

          if (promptBox) promptBox.innerText = stats.promptPreview || 'No user prompt text';
          if (promptLenEl) promptLenEl.innerText = (stats.promptPreview?.length || 0) + ' chars';
          if (streamBox) streamBox.innerText = '';
          if (thinkingIndicator) thinkingIndicator.style.display = 'none';

          liveStartTime = Date.now();
          clearInterval(liveStopwatchTimer);
          liveStopwatchTimer = setInterval(function() {
            const sec = ((Date.now() - liveStartTime) / 1000).toFixed(1);
            if (durEl) durEl.innerText = sec + 's';
          }, 100);
        } else if (ev.type === 'chunk') {
          if (tpsEl) tpsEl.innerText = (stats.tokensPerSec || 0).toFixed(1);
          if (peakTpsEl) peakTpsEl.innerText = 'Peak: ' + (stats.peakTPS || stats.tokensPerSec || 0).toFixed(1) + ' tok/s';
          if (ttftEl) ttftEl.innerText = (stats.ttftMs || 0) + ' ms';
          if (ttftRatingEl) ttftRatingEl.innerText = getTTFTRating(stats.ttftMs);
          if (tokEl) tokEl.innerText = stats.tokensGenerated || 0;
          if (promptTokEl) promptTokEl.innerText = 'Prompt: ' + (stats.promptTokens || 0) + ' tok';

          if (streamBox && ev.chunk) {
            streamBox.innerText += ev.chunk;
            streamBox.scrollTop = streamBox.scrollHeight;
          }

          if (thinkingIndicator) {
            thinkingIndicator.style.display = stats.isThinking ? 'inline' : 'none';
          }
        } else if (ev.type === 'complete') {
          clearInterval(liveStopwatchTimer);
          if (hud) hud.className = 'live-telemetry-hud';
          if (statusBadge) {
            statusBadge.className = 'live-status-pill completed';
            statusBadge.innerText = '🟢 LAST MESSAGE COMPLETE';
          }
          if (timeBadge) timeBadge.innerText = 'Completed ' + formatTimeAgo(stats.endTime);

          if (tpsEl) tpsEl.innerText = (stats.tokensPerSec || 0).toFixed(1);
          if (peakTpsEl) peakTpsEl.innerText = 'Peak: ' + (stats.peakTPS || stats.tokensPerSec || 0).toFixed(1) + ' tok/s';
          if (ttftEl) ttftEl.innerText = (stats.ttftMs || 0) + ' ms';
          if (ttftRatingEl) ttftRatingEl.innerText = getTTFTRating(stats.ttftMs);
          if (tokEl) tokEl.innerText = stats.tokensGenerated || 0;
          if (promptTokEl) promptTokEl.innerText = 'Prompt: ' + (stats.promptTokens || 0) + ' tok';
          if (durEl) durEl.innerText = ((stats.totalDurationMs || 0) / 1000).toFixed(2) + 's';
          if (genDurEl) genDurEl.innerText = 'Gen: ' + ((stats.generationDurationMs || 0) / 1000).toFixed(2) + 's';

          if (streamBox && stats.outputPreview && streamBox.innerText.length < 5) {
            streamBox.innerText = stats.outputPreview;
          }
          if (thinkingIndicator) thinkingIndicator.style.display = 'none';

          if (data.history) {
            renderMessageHistory(data.history);
          }
        } else if (ev.type === 'error') {
          clearInterval(liveStopwatchTimer);
          if (hud) hud.className = 'live-telemetry-hud';
          if (statusBadge) {
            statusBadge.className = 'live-status-pill error';
            statusBadge.innerText = '🔴 ' + (stats.errorMessage ? 'ERROR: ' + stats.errorMessage.slice(0, 30) : 'ERROR / ABORTED');
          }
          if (timeBadge) timeBadge.innerText = formatTimeAgo(stats.endTime);
          if (data.history) {
            renderMessageHistory(data.history);
          }
        }
      }

      function renderMessageHistory(history) {
        try {
          const tbody = document.getElementById('messageHistoryBody');
          if (!tbody) return;

          if (!history || history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--muted-text);">No messages sent yet. Use VS Code Chat or run a speed test!</td></tr>';
            return;
          }

          const maxTPS = Math.max.apply(Math, history.map(function(s) { return s.tokensPerSec || 1; })) || 1;

          tbody.innerHTML = history.map(function(h) {
            const tps = h.tokensPerSec || 0;
            const barW = Math.min(100, Math.round((tps / maxTPS) * 100));
            const totalSec = ((h.totalDurationMs || 0) / 1000).toFixed(2);
            const timeStr = formatTimeAgo(h.timestamp || h.startTime);
            const srcBadge = h.source === 'benchmark' ? '<span class="badge badge-neon">Benchmark</span>' : '<span class="badge badge-cyan">VS Code Chat</span>';
            const statusTxt = h.status === 'completed' ? '🟢 OK' : h.status === 'streaming' ? '⚡ Streaming' : '🔴 ' + (h.errorMessage || 'Error');

            return '<tr>' +
              '<td style="color: var(--muted-text); white-space: nowrap;">' + timeStr + '</td>' +
              '<td><strong>' + (h.modelId || '') + '</strong><div class="speed-bar-container"><div class="speed-bar" style="width: ' + barW + '%;"></div></div></td>' +
              '<td><span class="badge">' + (h.endpointName || '') + '</span></td>' +
              '<td>' + srcBadge + '</td>' +
              '<td style="color: var(--neon-accent); font-weight: 700; font-size: 13px;">' + tps + ' tok/s</td>' +
              '<td>' + (h.ttftMs || 0) + ' ms</td>' +
              '<td>' + (h.tokensGenerated || 0) + ' / ' + (h.promptTokens || 0) + '</td>' +
              '<td>' + totalSec + 's</td>' +
              '<td>' + statusTxt + '</td>' +
            '</tr>';
          }).join('');
        } catch (err) {
          console.error('renderMessageHistory error:', err);
        }
      }

      function renderLeaderboard(history) {
        try {
          const tbody = document.getElementById('leaderboardBody');
          if (!tbody) return;

          if (!history || history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--muted-text);">No benchmark history available.</td></tr>';
            return;
          }

          const sorted = history.slice().sort(function(a, b) {
            return (b.tokensPerSec || 0) - (a.tokensPerSec || 0);
          });
          const maxTPS = Math.max.apply(Math, sorted.map(function(s) { return s.tokensPerSec || 1; }));

          tbody.innerHTML = sorted.map(function(h, i) {
            const tps = h.tokensPerSec || 0;
            const barW = Math.min(100, Math.round((tps / maxTPS) * 100));
            const rank = i + 1;
            const totalSec = ((h.totalDurationMs || 0) / 1000).toFixed(2);
            const statusTxt = h.status === 'success' ? '🟢 OK' : '🔴 ' + (h.errorMessage || 'Error');
            return '<tr>' +
              '<td><strong>#' + rank + '</strong></td>' +
              '<td><strong>' + (h.modelId || '') + '</strong><div class="speed-bar-container"><div class="speed-bar" style="width: ' + barW + '%;"></div></div></td>' +
              '<td><span class="badge">' + (h.endpointName || '') + '</span></td>' +
              '<td style="color: var(--neon-accent); font-weight: 700; font-size: 14px;">' + tps + ' tok/s</td>' +
              '<td>' + (h.ttftMs || 0) + ' ms</td>' +
              '<td>' + (h.tokensGenerated || 0) + '</td>' +
              '<td>' + totalSec + 's</td>' +
              '<td>' + statusTxt + '</td>' +
            '</tr>';
          }).join('');
        } catch (err) {
          console.error('renderLeaderboard error:', err);
        }
      }

      function renderTelemetry(data) {
        try {
          if (!data) return;

          // Render live message / last stats if available
          if (data.activeMessage || data.lastMessage) {
            const stats = data.activeMessage || data.lastMessage;
            handleLiveTelemetryEvent({
              event: {
                type: data.activeMessage ? 'chunk' : 'complete',
                stats: stats,
              },
              activeStats: data.activeMessage,
              lastStats: data.lastMessage,
              history: data.messageHistory || [],
            });
          }

          if (data.messageHistory) {
            renderMessageHistory(data.messageHistory);
          }

          if (data.ram) {
            const ramText = (data.ram.usedGB || 0) + ' GB / ' + (data.ram.totalGB || 0) + ' GB (' + (data.ram.usedPercent || 0) + '%)';
            const ramEl = document.getElementById('ramUsageDisplay');
            if (ramEl) ramEl.innerText = ramText;

            const ramBar = document.getElementById('ramBarFill');
            if (ramBar) ramBar.style.width = (data.ram.usedPercent || 0) + '%';

            const aiList = document.getElementById('aiProcessList');
            if (aiList) {
              if (data.ram.aiProcesses && data.ram.aiProcesses.length > 0) {
                aiList.innerHTML = data.ram.aiProcesses.map(function(p) {
                  return '<div class="proc-item ai-model">' +
                    '<span>🤖 <strong>' + (p.modelDetails || p.name) + '</strong> (PID ' + p.pid + ')</span>' +
                    '<span class="badge">' + (p.ramMB || 0) + ' MB RAM</span>' +
                  '</div>';
                }).join('');
              } else {
                aiList.innerHTML = '<div style="color: var(--muted-text); font-size: 12px;">No active AI processes detected.</div>';
              }
            }
          }

          if (data.vram) {
            const gpuName = data.vram.gpuName || 'Graphics Adapter';
            const vramMB = typeof data.vram.usedVRAM_MB === 'number' ? data.vram.usedVRAM_MB : 0;

            const gpuNameEl = document.getElementById('gpuNameDisplay');
            if (gpuNameEl) gpuNameEl.innerText = '🎮 ' + gpuName;

            const gpuUsageEl = document.getElementById('gpuUsageDisplay');
            if (gpuUsageEl) gpuUsageEl.innerText = vramMB.toLocaleString() + ' MB Used';

            const vramBar = document.getElementById('vramBarFill');
            if (vramBar) vramBar.style.width = Math.min(100, Math.round((vramMB / 12000) * 100)) + '%';

            const gpuList = document.getElementById('gpuProcessList');
            if (gpuList) {
              if (data.vram.processes && data.vram.processes.length > 0) {
                gpuList.innerHTML = data.vram.processes.slice(0, 8).map(function(p) {
                  return '<div class="proc-item ' + (p.isAIModel ? 'ai-model' : '') + '">' +
                    '<span>' + (p.isAIModel ? '🤖' : '🖥️') + ' <strong>' + p.name + '</strong> (PID ' + p.pid + ')</span>' +
                    '<span class="badge">' + (p.vramMB || 0) + ' MB</span>' +
                  '</div>';
                }).join('');
              }
            }
          }

          if (data.loadedModels) {
            const tbody = document.getElementById('loadedModelsBody');
            if (tbody) {
              if (data.loadedModels.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted-text);">No loaded stray models detected.</td></tr>';
              } else {
                tbody.innerHTML = data.loadedModels.map(function(m) {
                  const vramStr = m.vramMB ? m.vramMB + ' MB' : '-';
                  const ramStr = m.ramMB ? (m.ramMB / 1024).toFixed(1) + ' GB' : '-';
                  return '<tr>' +
                    '<td><strong>' + (m.name || '') + '</strong><br><small style="color: var(--muted-text);">' + (m.details || '') + '</small></td>' +
                    '<td><span class="badge">' + (m.source || '').toUpperCase() + '</span></td>' +
                    '<td>' + (m.pid || 'N/A') + '</td>' +
                    '<td>' + vramStr + '</td>' +
                    '<td>' + ramStr + '</td>' +
                    '<td>' +
                      '<button class="card-btn btn-unload" style="border-color: #ff5722; color: #ff5722;" data-source="' + (m.source || '') + '" data-name="' + (m.name || '') + '" data-pid="' + (m.pid || 0) + '">' +
                        '🗑️ Unload' +
                      '</button>' +
                    '</td>' +
                  '</tr>';
                }).join('');

                // Attach unload listeners
                tbody.querySelectorAll('.btn-unload').forEach(function(b) {
                  b.addEventListener('click', function() {
                    post('unloadModel', {
                      source: this.getAttribute('data-source'),
                      modelName: this.getAttribute('data-name'),
                      pid: parseInt(this.getAttribute('data-pid') || '0', 10),
                    });
                  });
                });
              }
            }
          }

          if (data.history) {
            renderLeaderboard(data.history);
          }
        } catch (err) {
          console.error('renderTelemetry error:', err);
        }
      }

      // Initialize when script runs
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initListeners);
      } else {
        initListeners();
      }

      // Auto-fetch telemetry after UI renders
      setTimeout(function() {
        post('getTelemetry');
      }, 50);
    })();
  </script>
</body>
</html>`;
    }
}
exports.SimpleSignalDashboard = SimpleSignalDashboard;
//# sourceMappingURL=dashboard.js.map