import * as vscode from 'vscode';
import { EndpointConfig, BenchmarkResult, RAMDiagnostics, VRAMDiagnostics, LoadedAIModel } from './types';
import { ModelFetcher } from './modelFetcher';
import { BenchmarkEngine } from './benchmarkEngine';
import { SystemDiagnostics } from './systemDiagnostics';

export class SimpleSignalDashboard {
  public static currentPanel: SimpleSignalDashboard | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SimpleSignalDashboard.currentPanel) {
      SimpleSignalDashboard.currentPanel._panel.reveal(column);
      SimpleSignalDashboard.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'simplesignalDashboard',
      'SimpleSignal Hub',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false, // Ensure clean refresh when hidden/shown
      }
    );

    SimpleSignalDashboard.currentPanel = new SimpleSignalDashboard(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri) {
    this._panel = panel;
    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
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
              BenchmarkEngine.clearHistory();
              await this.sendTelemetryData();
              break;
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`SimpleSignal Hub error: ${err.message || err}`);
        }
      },
      null,
      this._disposables
    );

    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('simplesignal.endpoints')) {
          this._update();
        }
      },
      null,
      this._disposables
    );
  }

  private async toggleEndpoint(name: string) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints: EndpointConfig[] = JSON.parse(JSON.stringify(config.get<EndpointConfig[]>('endpoints', [])));
    const target = endpoints.find((e) => e.name === name);
    if (target) {
      target.enabled = target.enabled === false ? true : false;
      await config.update('endpoints', endpoints, vscode.ConfigurationTarget.Global);
      this._update();
    }
  }

  private async testEndpoint(name: string) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const target = endpoints.find((e) => e.name === name);
    if (target) {
      try {
        const models = await ModelFetcher.fetchModelsForEndpoint(target);
        vscode.window.showInformationMessage(`✅ ${target.name} Connected! (${models.length} models online)`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ ${target.name} Connection Failed: ${err.message || err}`);
      }
    }
  }

  private async sendTelemetryData() {
    try {
      const [ram, vram, loadedModels] = await Promise.all([
        SystemDiagnostics.getRAMDiagnostics(),
        SystemDiagnostics.getVRAMDiagnostics(),
        SystemDiagnostics.getLoadedModels(),
      ]);

      const history = BenchmarkEngine.getHistory();

      this._panel.webview.postMessage({
        type: 'telemetryUpdate',
        ram,
        vram,
        loadedModels,
        history,
      });
    } catch (e) {
      // ignore
    }
  }

  private async handleRunBenchmark(msg: { endpointName: string; modelId: string; presetId: string; customPrompt?: string; customMaxTokens?: number }) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const ep = endpoints.find((e) => e.name === msg.endpointName);

    if (!ep) {
      vscode.window.showErrorMessage(`Endpoint "${msg.endpointName}" not found.`);
      return;
    }

    try {
      const res = await BenchmarkEngine.runBenchmark(
        ep,
        msg.modelId,
        msg.presetId,
        msg.customPrompt,
        msg.customMaxTokens,
        (chunk, currentTokens, currentTPS) => {
          this._panel.webview.postMessage({
            type: 'benchmarkChunk',
            modelId: msg.modelId,
            chunk,
            currentTokens,
            currentTPS,
          });
        }
      );

      this._panel.webview.postMessage({
        type: 'benchmarkDone',
        result: res,
        history: BenchmarkEngine.getHistory(),
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Benchmark error: ${err.message || err}`);
    }
  }

  private async handleRunAllBenchmarks() {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []).filter((e) => e.enabled !== false);

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

        await BenchmarkEngine.runBenchmark(ep, m.id, 'quick_speed', undefined, 48, (chunk, curTok, curTPS) => {
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
      history: BenchmarkEngine.getHistory(),
    });
  }

  private async handleUnloadModel(msg: { source: string; modelName: string; pid?: number }) {
    if (msg.source === 'ollama') {
      const ok = await SystemDiagnostics.unloadOllamaModel(msg.modelName);
      if (ok) vscode.window.showInformationMessage(`⚡ Unloaded Ollama model: ${msg.modelName}`);
      else vscode.window.showErrorMessage(`Failed to unload Ollama model: ${msg.modelName}`);
    } else if (msg.pid) {
      const ok = await SystemDiagnostics.killProcess(msg.pid);
      if (ok) vscode.window.showInformationMessage(`⚡ Terminated process (PID ${msg.pid}) for ${msg.modelName}`);
      else vscode.window.showErrorMessage(`Failed to terminate PID ${msg.pid}`);
    }
    await this.sendTelemetryData();
  }

  public dispose() {
    SimpleSignalDashboard.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _update() {
    this._panel.title = '⚡ SimpleSignal Hub';
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  private _getHtmlForWebview(_webview: vscode.Webview) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const totalModels = endpoints.reduce((sum, ep) => sum + (ep.models?.length || 0), 0);

    const allModelsList: { epName: string; modelId: string }[] = [];
    for (const ep of endpoints) {
      if (ep.enabled === false) continue;
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
      --neon-glow: rgba(255, 230, 0, 0.25);
      --card-bg: var(--vscode-editor-background, #121212);
      --card-border: var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
      --text-color: var(--vscode-editor-foreground, #e0e0e0);
      --muted-text: var(--vscode-descriptionForeground, #888888);
      --badge-bg: var(--vscode-badge-background, #ffe600);
      --badge-fg: var(--vscode-badge-foreground, #000000);
      --green: #4caf50;
      --orange: #ff9800;
      --blue: #2196f3;
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

    /* Benchmark Section */
    .benchmark-panel {
      display: grid;
      grid-template-columns: 340px 1fr;
      gap: 20px;
      margin-bottom: 24px;
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

    .meter-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }

    .meter-card {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }

    .meter-val {
      font-size: 24px;
      font-weight: 800;
      color: var(--neon-accent);
    }

    .meter-lbl {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted-text);
    }

    .live-stream-box {
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      min-height: 120px;
      max-height: 180px;
      overflow-y: auto;
      white-space: pre-wrap;
      color: #b0ffb0;
    }

    /* Leaderboard Table */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 16px;
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
      background: linear-gradient(90deg, #ffe600, #4caf50);
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
      <p>Universal AI orchestration, model speed benchmarks, and hardware telemetry</p>
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
      ⚡ Performance
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
            ${
              models.length > 0
                ? models
                    .map(
                      (m) => `
              <div class="model-item" data-model="${m.id.toLowerCase()}">
                <span style="font-family: monospace;">${m.id}</span>
                <div>
                  ${m.supportsVision ? '<span class="badge">👁️</span>' : ''}
                  ${m.supportsTools ? '<span class="badge">🛠️</span>' : ''}
                </div>
              </div>`
                    )
                    .join('')
                : '<div style="color: var(--muted-text); font-size: 12px;">No models fetched yet. Click "Auto-Fetch".</div>'
            }
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

  <!-- TAB 2: PERFORMANCE -->
  <div id="tab-benchmarks" class="tab-content">
    <div class="benchmark-panel">
      <!-- Performance Controller -->
      <div class="benchmark-card">
        <h3 style="margin-top: 0; color: var(--neon-accent); font-size: 15px;">⚡ Model Performance Setup</h3>
        
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

      <!-- Live Speedometer / Metrics -->
      <div class="benchmark-card">
        <div class="meter-grid">
          <div class="meter-card">
            <div class="meter-val" id="meterTPS">0.0</div>
            <div class="meter-lbl">Tokens / Sec (TPS)</div>
          </div>
          <div class="meter-card">
            <div class="meter-val" id="meterTTFT">0 ms</div>
            <div class="meter-lbl">Time to 1st Token</div>
          </div>
          <div class="meter-card">
            <div class="meter-val" id="meterTokens">0</div>
            <div class="meter-lbl">Tokens Generated</div>
          </div>
          <div class="meter-card">
            <div class="meter-val" id="meterDuration">0.0s</div>
            <div class="meter-lbl">Total Time</div>
          </div>
        </div>

        <div style="font-size: 11px; color: var(--muted-text); margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">
          Live Stream Output Preview
        </div>
        <div class="live-stream-box" id="streamOutput">Waiting to run performance test...</div>
      </div>
    </div>

    <!-- Leaderboard -->
    <div class="table-container">
      <div style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--card-border);">
        <h3 style="margin: 0; font-size: 14px; color: var(--neon-accent);">🏆 Model Performance Leaderboard</h3>
        <button class="card-btn" id="btnClearHistory">Clear History</button>
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

      let benchmarkStartTime = 0;
      let benchmarkTimer = null;

      function post(cmd, data) {
        if (vscode) {
          vscode.postMessage(Object.assign({ command: cmd }, data || {}));
        }
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

        const tpsEl = document.getElementById('meterTPS');
        if (tpsEl) tpsEl.innerText = '0.0';

        const ttftEl = document.getElementById('meterTTFT');
        if (ttftEl) ttftEl.innerText = '...';

        const tokEl = document.getElementById('meterTokens');
        if (tokEl) tokEl.innerText = '0';

        const durEl = document.getElementById('meterDuration');
        if (durEl) durEl.innerText = '0.0s';

        benchmarkStartTime = Date.now();
        clearInterval(benchmarkTimer);
        benchmarkTimer = setInterval(function() {
          const sec = ((Date.now() - benchmarkStartTime) / 1000).toFixed(1);
          if (durEl) durEl.innerText = sec + 's';
        }, 100);

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

          if (msg.type === 'benchmarkChunk') {
            const outBox = document.getElementById('streamOutput');
            if (outBox) {
              outBox.innerText += (msg.chunk || '');
              outBox.scrollTop = outBox.scrollHeight;
            }
            const tokEl = document.getElementById('meterTokens');
            if (tokEl) tokEl.innerText = msg.currentTokens || 0;

            const tpsEl = document.getElementById('meterTPS');
            if (tpsEl) tpsEl.innerText = (msg.currentTPS || 0).toFixed(1);
          } else if (msg.type === 'benchmarkDone') {
            clearInterval(benchmarkTimer);
            const r = msg.result;
            if (r) {
              const tpsEl = document.getElementById('meterTPS');
              if (tpsEl) tpsEl.innerText = (r.tokensPerSec || 0).toFixed(1);

              const ttftEl = document.getElementById('meterTTFT');
              if (ttftEl) ttftEl.innerText = (r.ttftMs || 0) + ' ms';

              const tokEl = document.getElementById('meterTokens');
              if (tokEl) tokEl.innerText = r.tokensGenerated || 0;

              const durEl = document.getElementById('meterDuration');
              if (durEl) durEl.innerText = ((r.totalDurationMs || 0) / 1000).toFixed(2) + 's';
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
