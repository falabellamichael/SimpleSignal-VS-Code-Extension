import * as vscode from 'vscode';
import { EndpointConfig, BenchmarkResult, RAMDiagnostics, VRAMDiagnostics, LoadedAIModel, LiveModelStats } from './types';
import { ModelFetcher } from './modelFetcher';
import { BenchmarkEngine } from './benchmarkEngine';
import { SystemDiagnostics } from './systemDiagnostics';
import { ModelTelemetryTracker } from './telemetryTracker';

export class SimpleSignalDashboard {
  public static currentPanel: SimpleSignalDashboard | undefined;
  public static selectedModel?: { endpointName: string; modelId: string };
  public static loadedModelKeys = new Set<string>();
  public static onModelSelectionChanged?: (endpointName: string, modelId: string) => void;
  public static onLoadedModelsChanged?: (keys: string[]) => void;

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
        retainContextWhenHidden: false,
      }
    );

    SimpleSignalDashboard.currentPanel = new SimpleSignalDashboard(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri) {
    this._panel = panel;

    // Load initial selected model from settings
    const config = vscode.workspace.getConfiguration('simplesignal');
    const defaultModel = config.get<string>('defaultModel');
    if (defaultModel && defaultModel.includes(':::')) {
      const parts = defaultModel.split(':::');
      SimpleSignalDashboard.selectedModel = { endpointName: parts[0], modelId: parts.slice(1).join(':::') };
    }

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Subscribe to live telemetry events from any model used in VS Code
    this._disposables.push(
      ModelTelemetryTracker.onTelemetryEvent((event) => {
        this._panel.webview.postMessage({
          type: 'liveModelTelemetry',
          event,
          activeStats: ModelTelemetryTracker.getActiveStats(),
          lastStats: ModelTelemetryTracker.getLastStats(),
          history: ModelTelemetryTracker.getHistory(),
        });
      })
    );

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
            case 'loadModel':
              await this.handleLoadModel(message);
              break;
            case 'unloadModelAction':
              await this.handleUnloadModelAction(message);
              break;
            case 'selectModel':
              await this.handleSelectModel(message);
              break;
            case 'testModelConnection':
              await this.handleTestModelConnection(message);
              break;
            case 'copyModelId':
              await this.handleCopyModelId(message);
              break;
            case 'clearBenchmarkHistory':
              BenchmarkEngine.clearHistory();
              await this.sendTelemetryData();
              break;
            case 'clearMessageHistory':
              ModelTelemetryTracker.clearHistory();
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
      const lastMessage = ModelTelemetryTracker.getLastStats();
      const activeMessage = ModelTelemetryTracker.getActiveStats();
      const messageHistory = ModelTelemetryTracker.getHistory();

      // Automatically register any models currently detected in GPU VRAM / RAM
      for (const m of loadedModels) {
        if (m.name) {
          SimpleSignalDashboard.loadedModelKeys.add(m.name);
          SimpleSignalDashboard.loadedModelKeys.add(m.name.toLowerCase());
        }
      }

      this._panel.webview.postMessage({
        type: 'telemetryUpdate',
        ram,
        vram,
        loadedModels,
        history,
        lastMessage,
        activeMessage,
        messageHistory,
        selectedModel: SimpleSignalDashboard.selectedModel,
        loadedKeys: Array.from(SimpleSignalDashboard.loadedModelKeys),
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

  private async handleLoadModel(message: { endpointName: string; modelId: string }) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const target = endpoints.find((e) => e.name === message.endpointName);
    if (!target) {
      vscode.window.showErrorMessage(`Endpoint "${message.endpointName}" not found.`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `⚡ SimpleSignal: Loading "${message.modelId}" into memory...`,
        cancellable: false,
      },
      async () => {
        const res = await SystemDiagnostics.loadModel(target, message.modelId);
        if (res.success) {
          SimpleSignalDashboard.loadedModelKeys.add(`${message.endpointName}:::${message.modelId}`);
          SimpleSignalDashboard.loadedModelKeys.add(message.modelId);
          SimpleSignalDashboard.loadedModelKeys.add(message.modelId.toLowerCase());

          SimpleSignalDashboard.onLoadedModelsChanged?.(Array.from(SimpleSignalDashboard.loadedModelKeys));

          this._panel.webview.postMessage({
            type: 'modelStateUpdate',
            selectedModel: SimpleSignalDashboard.selectedModel,
            loadedKeys: Array.from(SimpleSignalDashboard.loadedModelKeys),
          });

          vscode.window.showInformationMessage(`⚡ ${res.message}`);
        } else {
          vscode.window.showErrorMessage(`Failed to load "${message.modelId}": ${res.message}`);
        }
        await this.sendTelemetryData();
      }
    );
  }

  private async handleUnloadModelAction(message: { endpointName: string; modelId: string }) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const target = endpoints.find((e) => e.name === message.endpointName);
    if (!target) {
      vscode.window.showErrorMessage(`Endpoint "${message.endpointName}" not found.`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `🛑 SimpleSignal: Unloading "${message.modelId}" from memory...`,
        cancellable: false,
      },
      async () => {
        const res = await SystemDiagnostics.unloadModel(target, message.modelId);
        if (res.success) {
          SimpleSignalDashboard.loadedModelKeys.delete(`${message.endpointName}:::${message.modelId}`);
          SimpleSignalDashboard.loadedModelKeys.delete(message.modelId);
          SimpleSignalDashboard.loadedModelKeys.delete(message.modelId.toLowerCase());

          SimpleSignalDashboard.onLoadedModelsChanged?.(Array.from(SimpleSignalDashboard.loadedModelKeys));

          this._panel.webview.postMessage({
            type: 'modelStateUpdate',
            selectedModel: SimpleSignalDashboard.selectedModel,
            loadedKeys: Array.from(SimpleSignalDashboard.loadedModelKeys),
          });

          vscode.window.showInformationMessage(`🛑 ${res.message}`);
        } else {
          vscode.window.showErrorMessage(`Failed to unload "${message.modelId}": ${res.message}`);
        }
        await this.sendTelemetryData();
      }
    );
  }

  private async handleSelectModel(message: { endpointName: string; modelId: string }) {
    SimpleSignalDashboard.selectedModel = { endpointName: message.endpointName, modelId: message.modelId };

    try {
      const config = vscode.workspace.getConfiguration('simplesignal');
      await config.update('defaultModel', `${message.endpointName}:::${message.modelId}`, vscode.ConfigurationTarget.Global);
    } catch {}

    try {
      await vscode.env.clipboard.writeText(message.modelId);
    } catch {}

    // Notify TreeDataProvider and StatusBar
    SimpleSignalDashboard.onModelSelectionChanged?.(message.endpointName, message.modelId);

    // Post to webview to instantly light up icon
    this._panel.webview.postMessage({
      type: 'modelStateUpdate',
      selectedModel: SimpleSignalDashboard.selectedModel,
      loadedKeys: Array.from(SimpleSignalDashboard.loadedModelKeys),
    });

    const action = await vscode.window.showInformationMessage(
      `✨ Selected "${message.modelId}" [${message.endpointName}] as active Chat Model! (Copied ID to clipboard)`,
      'Open Chat'
    );
    if (action === 'Open Chat') {
      await vscode.commands.executeCommand('workbench.action.chat.open');
    }
  }

  private async handleTestModelConnection(message: { endpointName: string; modelId: string }) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const target = endpoints.find((e) => e.name === message.endpointName);
    if (!target) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `🧪 Testing connection for "${message.modelId}"...`,
        cancellable: false,
      },
      async () => {
        const start = Date.now();
        const res = await SystemDiagnostics.loadModel(target, message.modelId);
        const latency = Date.now() - start;
        if (res.success) {
          vscode.window.showInformationMessage(`🟢 [${message.endpointName}] "${message.modelId}" connection active! (${latency} ms)`);
        } else {
          vscode.window.showErrorMessage(`🔴 [${message.endpointName}] "${message.modelId}" test error: ${res.message}`);
        }
      }
    );
  }

  private async handleCopyModelId(message: { modelId: string }) {
    await vscode.env.clipboard.writeText(message.modelId);
    vscode.window.showInformationMessage(`📋 Copied "${message.modelId}" to clipboard!`);
  }

  public dispose() {
    SimpleSignalDashboard.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private isLocalEndpoint(baseUrl: string, name: string): boolean {
    const b = (baseUrl || '').toLowerCase();
    const n = (name || '').toLowerCase();
    return (
      b.includes('localhost') ||
      b.includes('127.0.0.1') ||
      b.includes(':9000') ||
      b.includes(':1234') ||
      b.includes(':11434') ||
      b.includes(':8000') ||
      b.includes(':11211') ||
      n.includes('local') ||
      n.includes('lemonade') ||
      n.includes('ollama') ||
      n.includes('lm studio') ||
      n.includes('simplerag')
    );
  }

  private _update() {
    this._panel.title = '⚡ SimpleSignal Hub';

    // Always fetch fresh selected model from configuration
    const config = vscode.workspace.getConfiguration('simplesignal');
    const defaultModel = config.get<string>('defaultModel');
    if (defaultModel && defaultModel.includes(':::')) {
      const parts = defaultModel.split(':::');
      SimpleSignalDashboard.selectedModel = { endpointName: parts[0], modelId: parts.slice(1).join(':::') };
    }

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

    .accordion-toggle {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      cursor: pointer;
      margin-top: 8px;
      user-select: none;
      transition: all 0.2s ease;
    }

    .accordion-toggle:hover {
      background: rgba(255, 230, 0, 0.08);
      border-color: var(--neon-accent);
    }

    .accordion-arrow {
      display: inline-block;
      transition: transform 0.2s ease;
      font-size: 10px;
      color: var(--neon-accent);
    }

    .accordion-toggle.collapsed .accordion-arrow {
      transform: rotate(-90deg);
    }

    .model-list-wrapper {
      transition: max-height 0.3s ease, opacity 0.2s ease;
      max-height: 500px;
      overflow: hidden;
    }

    .model-list-wrapper.collapsed {
      max-height: 0 !important;
      opacity: 0;
      pointer-events: none;
      margin: 0 !important;
      padding: 0 !important;
    }

    .model-list {
      max-height: 200px;
      overflow-y: auto;
      border-top: 1px solid var(--card-border);
      padding-top: 8px;
      margin-top: 6px;
    }

    .model-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      margin-bottom: 4px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      cursor: pointer;
      user-select: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .model-item:hover {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(255, 255, 255, 0.22);
    }

    .model-item .signal-icon {
      width: 15px;
      height: 15px;
      color: rgba(255, 255, 255, 0.35);
      flex-shrink: 0;
      transition: all 0.25s ease;
    }

    /* When Loaded into Memory / VRAM: Signal Icon Lights Up Glowing Neon Green */
    .model-item.is-loaded {
      background: linear-gradient(90deg, rgba(0, 255, 136, 0.16) 0%, rgba(0, 255, 136, 0.04) 100%) !important;
      border: 1.5px solid #00ff88 !important;
      box-shadow: 0 0 14px rgba(0, 255, 136, 0.25) !important;
    }

    .model-item.is-loaded .signal-icon {
      color: #00ff88 !important;
      filter: drop-shadow(0 0 6px #00ff88) drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) !important;
      transform: scale(1.2);
      animation: signalPulseGreen 1.8s infinite alternate ease-in-out;
    }

    .model-item.is-loaded .signal-icon path {
      stroke: #00ff88 !important;
    }

    .model-item.is-loaded .signal-icon circle {
      fill: #00ff88 !important;
    }

    @keyframes signalPulseGreen {
      0% { filter: drop-shadow(0 0 4px #00ff88); opacity: 0.85; }
      100% { filter: drop-shadow(0 0 10px #00ff88) drop-shadow(0 0 16px #00ff88); opacity: 1; }
    }

    /* When Selected for Chat / Active: Signal Icon Lights Up Vivid Gold */
    .model-item.is-selected {
      background: linear-gradient(90deg, rgba(255, 230, 0, 0.22) 0%, rgba(255, 230, 0, 0.08) 100%) !important;
      border: 1.5px solid var(--neon-accent) !important;
      box-shadow: 0 0 16px var(--neon-glow), inset 0 0 10px rgba(255, 230, 0, 0.1) !important;
    }

    .model-item.is-selected .signal-icon {
      color: var(--neon-accent) !important;
      filter: drop-shadow(0 0 8px var(--neon-accent)) drop-shadow(0 0 16px var(--neon-glow)) !important;
      transform: scale(1.25);
      animation: signalPulseGold 1.5s infinite alternate ease-in-out;
    }

    .model-item.is-selected .signal-icon path {
      stroke: var(--neon-accent) !important;
    }

    .model-item.is-selected .signal-icon circle {
      fill: var(--neon-accent) !important;
    }

    @keyframes signalPulseGold {
      0% { filter: drop-shadow(0 0 4px var(--neon-accent)); opacity: 0.9; }
      100% { filter: drop-shadow(0 0 12px var(--neon-accent)) drop-shadow(0 0 18px var(--neon-accent)); opacity: 1; }
    }

    .model-item.is-loaded.is-selected {
      background: linear-gradient(90deg, rgba(0, 255, 136, 0.16) 0%, rgba(255, 230, 0, 0.16) 100%) !important;
      border: 1.5px solid var(--neon-accent) !important;
      box-shadow: 0 0 18px var(--neon-glow), 0 0 12px rgba(0, 255, 136, 0.4) !important;
    }

    .status-badge-container {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
    }

    .badge-state-sel {
      background: var(--neon-accent) !important;
      color: #000 !important;
      font-weight: 800 !important;
      font-size: 9px !important;
      padding: 1px 6px !important;
      border-radius: 4px !important;
      letter-spacing: 0.5px !important;
      box-shadow: 0 0 8px var(--neon-glow) !important;
    }

    .badge-state-load {
      background: #00ff88 !important;
      color: #000 !important;
      font-weight: 800 !important;
      font-size: 9px !important;
      padding: 1px 6px !important;
      border-radius: 4px !important;
      letter-spacing: 0.5px !important;
      box-shadow: 0 0 8px rgba(0, 255, 136, 0.6) !important;
    }

    .btn-dots {
      padding: 2px 7px;
      font-size: 11px;
      letter-spacing: 1px;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
      line-height: 1;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--card-border);
      color: var(--text-color);
      transition: all 0.15s ease;
    }

    .btn-dots:hover {
      background: var(--neon-accent);
      color: #000;
      border-color: var(--neon-accent);
      box-shadow: 0 0 8px var(--neon-glow);
    }

    .model-action-menu {
      position: fixed;
      display: none;
      background: rgba(18, 18, 22, 0.97);
      backdrop-filter: blur(16px);
      border: 1px solid var(--neon-accent);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.75);
      border-radius: 8px;
      padding: 4px 0;
      z-index: 99999;
      min-width: 195px;
      font-size: 12px;
      color: var(--text-color);
      animation: menuFadeIn 0.12s ease-out;
    }

    @keyframes menuFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .model-menu-title {
      padding: 6px 14px;
      font-size: 10px;
      font-weight: 700;
      color: var(--muted-text);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--card-border);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .model-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      cursor: pointer;
      transition: all 0.12s ease;
      user-select: none;
      font-size: 11px;
      font-weight: 500;
    }

    .model-menu-item:hover {
      background: rgba(255, 230, 0, 0.15);
      color: var(--neon-accent);
      padding-left: 17px;
    }

    .model-menu-item.danger:hover {
      background: rgba(255, 82, 82, 0.18);
      color: #ff5252;
    }

    .model-menu-divider {
      height: 1px;
      background: var(--card-border);
      margin: 4px 0;
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
      <h1>
        <svg style="width: 24px; height: 24px; color: var(--neon-accent); vertical-align: -4px; margin-right: 6px; display: inline-block;" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <path d="M 86.29 202.29 A 240 240 0 0 1 425.71 202.29" stroke-width="36" />
          <path d="M 142.86 258.86 A 160 160 0 0 1 369.14 258.86" stroke-width="36" />
          <path d="M 199.43 315.43 A 80 80 0 0 1 312.57 315.43" stroke-width="36" />
          <circle cx="256" cy="372" r="26" fill="currentColor" stroke="none" />
        </svg>
        SimpleSignal Hub
      </h1>
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
      
      <div style="display: flex; align-items: center; gap: 6px;">
        <label style="font-size: 11px; font-weight: 700; color: var(--neon-accent); text-transform: uppercase;">Provider:</label>
        <select class="select-box" id="providerFilterSelect" style="font-weight: 600;">
          <option value="all">⚡ All Providers (${endpoints.length})</option>
          ${endpoints.map((ep) => `<option value="${ep.name.toLowerCase()}">${ep.name} (${ep.models?.length || 0})</option>`).join('')}
        </select>
      </div>

      <button class="btn btn-secondary" id="btnExpandAllModels" title="Expand all provider model dropdowns">📂 Expand All</button>
      <button class="btn btn-secondary" id="btnCollapseAllModels" title="Collapse all provider model dropdowns">📁 Collapse All</button>
      <input type="text" class="search-box" id="searchInput" placeholder="🔍 Search models..." style="flex: 1; min-width: 180px;" />
    </div>

    <div class="grid" id="endpointsGrid">
      ${endpoints
        .map((ep) => {
          const isEnabled = ep.enabled !== false;
          const isLocal = this.isLocalEndpoint(ep.baseUrl, ep.name);
          const models = ep.models || [];
          return `
        <div class="card" data-name="${ep.name.toLowerCase()}" data-endpoint-name="${ep.name.toLowerCase()}">
          <div class="card-header">
            <h3 class="card-title">
              <span class="status-dot ${isEnabled ? '' : 'disabled'}"></span>
              <svg style="width: 14px; height: 14px; color: ${isEnabled ? 'var(--neon-accent)' : '#888'}; vertical-align: -2px; margin-right: 2px;" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <path d="M 86.29 202.29 A 240 240 0 0 1 425.71 202.29" stroke-width="40" />
                <path d="M 142.86 258.86 A 160 160 0 0 1 369.14 258.86" stroke-width="40" />
                <path d="M 199.43 315.43 A 80 80 0 0 1 312.57 315.43" stroke-width="40" />
                <circle cx="256" cy="372" r="30" fill="currentColor" stroke="none" />
              </svg>
              ${ep.name}
            </h3>
            <span class="badge ${ep.protocol === 'lemonade' ? 'badge-neon' : ep.protocol === 'ollama' ? 'badge-cyan' : ''}">${ep.protocol || 'openai'}</span>
          </div>
          <div class="card-url">${ep.baseUrl}</div>
          
          <div class="accordion-toggle" title="Click to expand/collapse models dropdown">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="accordion-arrow">▼</span>
              <span style="font-weight: 600; font-size: 12px;">Models Dropdown</span>
            </div>
            <span class="badge ${isEnabled && models.length > 0 ? 'badge-neon' : ''}" style="font-size: 10px;">${models.length} loaded</span>
          </div>

          <div class="model-list-wrapper">
            <div class="model-list">
              ${
                models.length > 0
                  ? models
                      .map((m) => {
                        const isSel = SimpleSignalDashboard.selectedModel &&
                          (SimpleSignalDashboard.selectedModel.modelId.toLowerCase() === m.id.toLowerCase()) &&
                          (!SimpleSignalDashboard.selectedModel.endpointName || SimpleSignalDashboard.selectedModel.endpointName.toLowerCase() === ep.name.toLowerCase());
                        const key = `${ep.name}:::${m.id}`;
                        const isLoaded = SimpleSignalDashboard.loadedModelKeys.has(key) ||
                          SimpleSignalDashboard.loadedModelKeys.has(m.id) ||
                          SimpleSignalDashboard.loadedModelKeys.has(m.id.toLowerCase());

                        return `
                <div class="model-item ${isSel ? 'is-selected' : ''} ${isLoaded ? 'is-loaded' : ''}" data-model="${m.id.toLowerCase()}" data-model-id="${m.id}" data-endpoint="${ep.name}">
                  <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 6px;">
                    <svg class="signal-icon" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M 86.29 202.29 A 240 240 0 0 1 425.71 202.29" stroke-width="42" />
                      <path d="M 142.86 258.86 A 160 160 0 0 1 369.14 258.86" stroke-width="42" />
                      <path d="M 199.43 315.43 A 80 80 0 0 1 312.57 315.43" stroke-width="42" />
                      <circle cx="256" cy="372" r="32" fill="currentColor" stroke="none" />
                    </svg>
                    <span style="font-family: monospace; font-size: 11px; font-weight: 600;">${m.id}</span>
                    <span class="status-badge-container">
                      ${isSel ? '<span class="badge badge-neon badge-state-sel">✨ ACTIVE</span>' : ''}
                      ${isLoaded ? '<span class="badge badge-green badge-state-load">⚡ LOADED</span>' : ''}
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                    ${m.supportsVision ? '<span class="badge" title="Vision Capable">👁️</span>' : ''}
                    ${m.supportsTools ? '<span class="badge" title="Function Calling / Tools">🛠️</span>' : ''}
                    <button class="card-btn" style="padding: 2px 6px; font-size: 9px;" onclick="window.selectModelForBench('${ep.name}', '${m.id}')" title="Test this model">⚡ Test</button>
                    <button class="card-btn btn-dots" data-endpoint="${ep.name}" data-model="${m.id}" data-type="${isLocal ? 'local' : 'api'}" title="Actions">•••</button>
                  </div>
                </div>`;
                      })
                      .join('')
                  : '<div style="color: var(--muted-text); font-size: 12px; padding: 6px;">No models fetched yet. Click "Auto-Fetch".</div>'
              }
            </div>
          </div>


          <div class="card-footer">
            <button class="card-btn" data-action="test" data-endpoint="${ep.name}">🧪 Test Signal</button>
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
          <label>1. Filter by Provider</label>
          <select id="benchProviderSelect" class="select-box" style="width: 100%;">
            <option value="all">⚡ All Providers (${endpoints.length})</option>
            ${endpoints.map((ep) => `<option value="${ep.name}">${ep.name} (${ep.models?.length || 0} models)</option>`).join('')}
          </select>
        </div>

        <div class="benchmark-form-group">
          <label>2. Select Target Model</label>
          <select id="benchModelSelect" class="select-box" style="width: 100%;">
            ${endpoints
              .filter((ep) => ep.enabled !== false && (ep.models?.length || 0) > 0)
              .map(
                (ep) => `
              <optgroup label="${ep.name} (${ep.models?.length || 0} models)" data-provider="${ep.name}">
                ${(ep.models || []).map((m) => `<option value="${ep.name}|${m.id}">${m.id} [${ep.name}]</option>`).join('')}
              </optgroup>`
              )
              .join('')}
          </select>
        </div>

        <div class="benchmark-form-group">
          <label>3. Performance Preset</label>
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

  <div id="modelActionMenu" class="model-action-menu">
    <div id="modelMenuTitle" class="model-menu-title">Model Actions</div>
    <div id="modelMenuItems"></div>
  </div>

  <script>
    (function() {
      let vscode;
      try {
        vscode = acquireVsCodeApi();
      } catch (e) {
        console.error('VsCode API acquire error:', e);
      }

      window.__lastSelectedModel = ${JSON.stringify(SimpleSignalDashboard.selectedModel || null)};
      window.__lastLoadedKeys = ${JSON.stringify(Array.from(SimpleSignalDashboard.loadedModelKeys))};

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

        // Provider dropdown filter in Tab 1
        const providerFilterSelect = document.getElementById('providerFilterSelect');
        if (providerFilterSelect) {
          providerFilterSelect.addEventListener('change', function() {
            const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
            filterModels(query);
          });
        }

        // Expand All / Collapse All buttons
        const btnExpandAll = document.getElementById('btnExpandAllModels');
        if (btnExpandAll) {
          btnExpandAll.addEventListener('click', function() {
            document.querySelectorAll('.accordion-toggle').forEach(function(t) {
              t.classList.remove('collapsed');
            });
            document.querySelectorAll('.model-list-wrapper').forEach(function(w) {
              w.classList.remove('collapsed');
            });
          });
        }

        const btnCollapseAll = document.getElementById('btnCollapseAllModels');
        if (btnCollapseAll) {
          btnCollapseAll.addEventListener('click', function() {
            document.querySelectorAll('.accordion-toggle').forEach(function(t) {
              t.classList.add('collapsed');
            });
            document.querySelectorAll('.model-list-wrapper').forEach(function(w) {
              w.classList.add('collapsed');
            });
          });
        }

        // Accordion toggle click handlers
        document.querySelectorAll('.accordion-toggle').forEach(function(toggle) {
          toggle.addEventListener('click', function() {
            const card = this.closest('.card');
            const wrapper = card?.querySelector('.model-list-wrapper');
            this.classList.toggle('collapsed');
            if (wrapper) wrapper.classList.toggle('collapsed');
          });
        });

        // Provider dropdown in Tab 2 (Performance Benchmark)
        const benchProviderSelect = document.getElementById('benchProviderSelect');
        const benchModelSelect = document.getElementById('benchModelSelect');
        if (benchProviderSelect && benchModelSelect) {
          benchProviderSelect.addEventListener('change', function() {
            const selectedProvider = this.value;
            const optgroups = benchModelSelect.querySelectorAll('optgroup');
            let firstVisibleOption = null;
            optgroups.forEach(function(group) {
              const prov = group.getAttribute('data-provider');
              if (selectedProvider === 'all' || prov === selectedProvider) {
                group.style.display = '';
                if (!firstVisibleOption) {
                  const firstOpt = group.querySelector('option');
                  if (firstOpt) firstVisibleOption = firstOpt;
                }
              } else {
                group.style.display = 'none';
              }
            });
            if (firstVisibleOption) {
              benchModelSelect.value = firstVisibleOption.value;
            }
          });
        }

        // Global function to quick-select model for benchmark
        window.selectModelForBench = function(epName, modelId) {
          switchTab('tab-benchmarks');
          if (benchProviderSelect) {
            benchProviderSelect.value = epName;
            benchProviderSelect.dispatchEvent(new Event('change'));
          }
          if (benchModelSelect) {
            benchModelSelect.value = epName + '|' + modelId;
          }
          const benchCard = document.querySelector('.benchmark-card');
          if (benchCard) benchCard.scrollIntoView({ behavior: 'smooth' });
        };

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

        // Setup "..." Model Action Dropdown Menu
        const menuEl = document.getElementById('modelActionMenu');
        const menuTitleEl = document.getElementById('modelMenuTitle');
        const menuItemsEl = document.getElementById('modelMenuItems');

        function closeModelMenu() {
          if (menuEl) menuEl.style.display = 'none';
        }

        document.addEventListener('click', function(e) {
          if (menuEl && !menuEl.contains(e.target) && !e.target.classList.contains('btn-dots')) {
            closeModelMenu();
          }
        });

        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') closeModelMenu();
        });

        document.querySelectorAll('.btn-dots').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const ep = this.getAttribute('data-endpoint') || '';
            const modelId = this.getAttribute('data-model') || '';
            const type = this.getAttribute('data-type') || 'local';

            if (!menuEl || !menuTitleEl || !menuItemsEl) return;

            menuTitleEl.innerText = ep + ' • ' + modelId;
            menuItemsEl.innerHTML = '';

            // 1. Select for VS Code Chat (Available for BOTH Local and Cloud models)
            const selectItem = document.createElement('div');
            selectItem.className = 'model-menu-item';
            selectItem.innerHTML = '<span>✨</span> <span><strong>Select</strong> for VS Code Chat</span>';
            selectItem.addEventListener('click', function() {
              window.__lastSelectedModel = { endpointName: ep, modelId: modelId };
              applyModelStates(window.__lastSelectedModel, window.__lastLoadedKeys || []);
              post('selectModel', { endpointName: ep, modelId: modelId });
              closeModelMenu();
            });
            menuItemsEl.appendChild(selectItem);

            if (type === 'local') {
              // Local Model Options: Load into Memory, Unload, Benchmark, Copy ID
              const loadItem = document.createElement('div');
              loadItem.className = 'model-menu-item';
              loadItem.innerHTML = '<span>⚡</span> <span><strong>Load</strong> into VRAM / Memory</span>';
              loadItem.addEventListener('click', function() {
                const curLoaded = (window.__lastLoadedKeys || []).concat([ep + ':::' + modelId, modelId, modelId.toLowerCase()]);
                window.__lastLoadedKeys = curLoaded;
                applyModelStates(window.__lastSelectedModel, curLoaded);
                post('loadModel', { endpointName: ep, modelId: modelId });
                closeModelMenu();
              });

              const unloadItem = document.createElement('div');
              unloadItem.className = 'model-menu-item danger';
              unloadItem.innerHTML = '<span>🛑</span> <span><strong>Unload</strong> from VRAM</span>';
              unloadItem.addEventListener('click', function() {
                const curLoaded = (window.__lastLoadedKeys || []).filter(function(k) {
                  return k !== modelId && k !== ep + ':::' + modelId && k.toLowerCase() !== modelId.toLowerCase();
                });
                window.__lastLoadedKeys = curLoaded;
                applyModelStates(window.__lastSelectedModel, curLoaded);
                post('unloadModelAction', { endpointName: ep, modelId: modelId });
                closeModelMenu();
              });

              const divider = document.createElement('div');
              divider.className = 'model-menu-divider';

              const benchItem = document.createElement('div');
              benchItem.className = 'model-menu-item';
              benchItem.innerHTML = '<span>🚀</span> <span>Run Speed Benchmark</span>';
              benchItem.addEventListener('click', function() {
                window.selectModelForBench(ep, modelId);
                closeModelMenu();
              });

              const copyItem = document.createElement('div');
              copyItem.className = 'model-menu-item';
              copyItem.innerHTML = '<span>📋</span> <span>Copy Model ID</span>';
              copyItem.addEventListener('click', function() {
                post('copyModelId', { modelId: modelId });
                closeModelMenu();
              });

              menuItemsEl.appendChild(loadItem);
              menuItemsEl.appendChild(unloadItem);
              menuItemsEl.appendChild(divider);
              menuItemsEl.appendChild(benchItem);
              menuItemsEl.appendChild(copyItem);
            } else {
              // API Model Options: Test Connection, Benchmark, Copy ID
              const testItem = document.createElement('div');
              testItem.className = 'model-menu-item';
              testItem.innerHTML = '<span>🧪</span> <span>Test API Connection</span>';
              testItem.addEventListener('click', function() {
                post('testModelConnection', { endpointName: ep, modelId: modelId });
                closeModelMenu();
              });

              const divider = document.createElement('div');
              divider.className = 'model-menu-divider';

              const benchItem = document.createElement('div');
              benchItem.className = 'model-menu-item';
              benchItem.innerHTML = '<span>🚀</span> <span>Run Speed Benchmark</span>';
              benchItem.addEventListener('click', function() {
                window.selectModelForBench(ep, modelId);
                closeModelMenu();
              });

              const copyItem = document.createElement('div');
              copyItem.className = 'model-menu-item';
              copyItem.innerHTML = '<span>📋</span> <span>Copy Model ID</span>';
              copyItem.addEventListener('click', function() {
                post('copyModelId', { modelId: modelId });
                closeModelMenu();
              });

              menuItemsEl.appendChild(testItem);
              menuItemsEl.appendChild(divider);
              menuItemsEl.appendChild(benchItem);
              menuItemsEl.appendChild(copyItem);
            }

            // Position menu near button
            const rect = btn.getBoundingClientRect();
            menuEl.style.display = 'block';
            let left = rect.right - 200;
            if (left < 10) left = 10;
            let top = rect.bottom + 6;
            if (top + 190 > window.innerHeight) {
              top = rect.top - 180;
            }
            menuEl.style.left = left + 'px';
            menuEl.style.top = top + 'px';
          });
        });

        // Direct click on model item row to select it instantly
        document.querySelectorAll('.model-item').forEach(function(item) {
          item.addEventListener('click', function(e) {
            if (e.target.closest('.card-btn') || e.target.closest('.btn-dots') || e.target.closest('.model-action-menu')) {
              return;
            }
            const ep = this.getAttribute('data-endpoint') || '';
            const modelId = this.getAttribute('data-model-id') || this.getAttribute('data-model') || '';
            if (ep && modelId) {
              window.__lastSelectedModel = { endpointName: ep, modelId: modelId };
              applyModelStates(window.__lastSelectedModel, window.__lastLoadedKeys || []);
              post('selectModel', { endpointName: ep, modelId: modelId });
            }
          });
        });

        // Apply initial model states on page load
        applyModelStates(window.__lastSelectedModel, window.__lastLoadedKeys);
      }

      function applyModelStates(selectedModel, loadedKeys) {
        if (selectedModel !== undefined && selectedModel !== null) window.__lastSelectedModel = selectedModel;
        if (loadedKeys !== undefined && loadedKeys !== null) window.__lastLoadedKeys = loadedKeys;

        const sel = window.__lastSelectedModel;
        const selEp = sel ? String(sel.endpointName || '').trim().toLowerCase() : '';
        const selModel = sel ? String(sel.modelId || '').trim().toLowerCase() : '';

        document.querySelectorAll('.model-item').forEach(function(item) {
          const ep = String(item.getAttribute('data-endpoint') || '').trim().toLowerCase();
          const model = String(item.getAttribute('data-model') || '').trim().toLowerCase();
          const modelRaw = String(item.getAttribute('data-model-id') || item.getAttribute('data-model') || '').trim().toLowerCase();
          const key = ep + ':::' + modelRaw;

          const isSel = Boolean(
            sel &&
            selModel &&
            (model === selModel || modelRaw === selModel || (model.length > 3 && selModel.includes(model)) || (selModel.length > 3 && model.includes(selModel))) &&
            (!selEp || ep === selEp || ep.includes(selEp) || selEp.includes(ep))
          );

          let isLoaded = false;
          if (window.__lastLoadedKeys && Array.isArray(window.__lastLoadedKeys)) {
            const lkLower = window.__lastLoadedKeys.map(function(k) { return String(k).trim().toLowerCase(); });
            isLoaded = lkLower.includes(key) ||
              lkLower.includes(model) ||
              lkLower.includes(modelRaw) ||
              lkLower.some(function(k) {
                return (k.length > 3 && (k.includes(model) || model.includes(k)));
              });
          }

          if (isSel) {
            item.classList.add('is-selected');
          } else {
            item.classList.remove('is-selected');
          }

          if (isLoaded) {
            item.classList.add('is-loaded');
          } else {
            item.classList.remove('is-loaded');
          }

          const badgeContainer = item.querySelector('.status-badge-container');
          if (badgeContainer) {
            let html = '';
            if (isSel) html += '<span class="badge badge-neon badge-state-sel">✨ ACTIVE</span> ';
            if (isLoaded) html += '<span class="badge badge-green badge-state-load">⚡ LOADED</span>';
            badgeContainer.innerHTML = html;
          }
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
        const providerFilter = (document.getElementById('providerFilterSelect')?.value || 'all').toLowerCase();

        document.querySelectorAll('.card').forEach(function(card) {
          const cardName = (card.getAttribute('data-endpoint-name') || card.getAttribute('data-name') || '').toLowerCase();
          const matchesProvider = providerFilter === 'all' || cardName === providerFilter;

          if (!matchesProvider) {
            card.style.display = 'none';
            return;
          }

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

          if (!q || anyVisible || cardName.indexOf(q) !== -1) {
            card.style.display = 'block';
            // Auto-expand card if user searched specifically
            if (q && anyVisible) {
              const toggle = card.querySelector('.accordion-toggle');
              const wrapper = card.querySelector('.model-list-wrapper');
              if (toggle) toggle.classList.remove('collapsed');
              if (wrapper) wrapper.classList.remove('collapsed');
            }
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

          if (msg.type === 'modelStateUpdate') {
            applyModelStates(msg.selectedModel, msg.loadedKeys);
          } else if (msg.type === 'liveModelTelemetry') {
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
            if (msg.selectedModel !== undefined || msg.loadedKeys !== undefined) {
              applyModelStates(msg.selectedModel, msg.loadedKeys);
            }
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
