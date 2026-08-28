import * as vscode from 'vscode';
import { EndpointConfig, ModelConfig } from './types';

export class SimpleSignalTreeDataProvider implements vscode.TreeDataProvider<TreeItemNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private selectedModel?: { endpointName: string; modelId: string };
  private loadedModels = new Set<string>();

  constructor(private extensionUri?: vscode.Uri) {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const defaultModel = config.get<string>('defaultModel');
    if (defaultModel && defaultModel.includes(':::')) {
      const parts = defaultModel.split(':::');
      this.selectedModel = { endpointName: parts[0], modelId: parts.slice(1).join(':::') };
    }
  }

  public setSelectedModel(endpointName: string, modelId: string): void {
    this.selectedModel = { endpointName, modelId };
    this.refresh();
  }

  public setLoadedModels(keys: string[]): void {
    this.loadedModels = new Set(keys.map((k) => k.toLowerCase()));
    this.refresh();
  }

  private getSignalLogoIcon(): vscode.Uri | vscode.ThemeIcon {
    if (this.extensionUri) {
      return vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.svg');
    }
    return new vscode.ThemeIcon('radio-tower', new vscode.ThemeColor('charts.yellow'));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItemNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItemNode): Promise<TreeItemNode[]> {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);

    if (!element) {
      const totalModels = endpoints.reduce((acc, e) => acc + (e.models?.length || 0), 0);

      const endpointsCategory = new TreeItemNode(
        `Signal Endpoints (${endpoints.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category_endpoints',
        new vscode.ThemeIcon('radio-tower')
      );

      const modelsCategory = new TreeItemNode(
        `Available Models (${totalModels})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'category_models',
        this.getSignalLogoIcon()
      );

      const actionsCategory = new TreeItemNode(
        'Quick Actions',
        vscode.TreeItemCollapsibleState.Expanded,
        'category_actions',
        new vscode.ThemeIcon('zap')
      );

      return [endpointsCategory, modelsCategory, actionsCategory];
    }

    if (element.contextValue === 'category_endpoints') {
      if (endpoints.length === 0) {
        return [
          new TreeItemNode(
            'No endpoints configured yet',
            vscode.TreeItemCollapsibleState.None,
            'empty',
            new vscode.ThemeIcon('info')
          ),
        ];
      }

      return endpoints.map((ep) => {
        const isOnline = ep.enabled !== false;
        const icon = isOnline ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')) : new vscode.ThemeIcon('circle-slash');
        const node = new TreeItemNode(
          ep.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          'endpoint_item',
          icon
        );
        node.description = `${ep.models?.length || 0} models • ${ep.baseUrl}`;
        node.tooltip = `Base URL: ${ep.baseUrl}\nProtocol: ${ep.protocol || 'openai'}\nStatus: ${isOnline ? 'Active' : 'Disabled'}`;
        (node as any).endpoint = ep;
        return node;
      });
    }

    if (element.contextValue === 'endpoint_item') {
      const ep: EndpointConfig = (element as any).endpoint;
      const models = ep.models || [];
      if (models.length === 0) {
        return [
          new TreeItemNode('No models found (Run Auto-Fetch)', vscode.TreeItemCollapsibleState.None, 'empty', new vscode.ThemeIcon('warning')),
        ];
      }
      return models.map((m) => this.createModelNode(m, ep.name));
    }

    if (element.contextValue === 'category_models') {
      const activeEndpoints = endpoints.filter((ep) => ep.enabled !== false && (ep.models?.length || 0) > 0);

      if (activeEndpoints.length === 0) {
        return [
          new TreeItemNode('No models available. Click "Auto-Fetch Models" below.', vscode.TreeItemCollapsibleState.None, 'empty', new vscode.ThemeIcon('info')),
        ];
      }

      return activeEndpoints.map((ep) => {
        const node = new TreeItemNode(
          `${ep.name} (${ep.models?.length || 0})`,
          vscode.TreeItemCollapsibleState.Collapsed,
          'provider_models_group',
          new vscode.ThemeIcon('server-process', new vscode.ThemeColor('charts.blue'))
        );
        node.description = `${ep.models?.length || 0} models`;
        (node as any).endpoint = ep;
        return node;
      });
    }

    if (element.contextValue === 'provider_models_group') {
      const ep: EndpointConfig = (element as any).endpoint;
      const models = ep.models || [];
      return models.map((m) => this.createModelNode(m, ep.name));
    }

    if (element.contextValue === 'category_actions') {
      const autoFetchAction = new TreeItemNode(
        'Auto-Fetch All Models & Fill JSON',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.purple'))
      );
      autoFetchAction.command = { command: 'simplesignal.autoFetchModels', title: 'Auto-Fetch Models' };

      const addAction = new TreeItemNode(
        'Add New Endpoint',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.blue'))
      );
      addAction.command = { command: 'simplesignal.manageEndpoints', title: 'Add Endpoint' };

      const openDashboardAction = new TreeItemNode(
        'Open SimpleSignal Visual Hub',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('dashboard', new vscode.ThemeColor('charts.red'))
      );
      openDashboardAction.command = { command: 'simplesignal.openDashboard', title: 'Open Dashboard' };

      const runBenchmarkAction = new TreeItemNode(
        'Performance Benchmark',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('zap', new vscode.ThemeColor('charts.yellow'))
      );
      runBenchmarkAction.command = { command: 'simplesignal.runBenchmark', title: 'Performance Benchmark' };

      const testAction = new TreeItemNode(
        'Test Signal Connections',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('pulse')
      );
      testAction.command = { command: 'simplesignal.testEndpoints', title: 'Test Connections' };

      const openJsonAction = new TreeItemNode(
        'Edit settings.json',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('json')
      );
      openJsonAction.command = { command: 'simplesignal.openConfigFile', title: 'Open Settings JSON' };

      const checkVramAction = new TreeItemNode(
        'Check VRAM (GPU Memory & Models)',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('circuit-board', new vscode.ThemeColor('charts.yellow'))
      );
      checkVramAction.command = { command: 'simplesignal.checkVRAM', title: 'Check VRAM' };

      const checkRamAction = new TreeItemNode(
        'Check RAM (System Memory & Processes)',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.green'))
      );
      checkRamAction.command = { command: 'simplesignal.checkRAM', title: 'Check RAM' };

      const checkModelsAction = new TreeItemNode(
        'Inspect Loaded / Stray Models',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('hubot', new vscode.ThemeColor('charts.orange'))
      );
      checkModelsAction.command = { command: 'simplesignal.checkLoadedModels', title: 'Inspect Models' };

      const githubAction = new TreeItemNode(
        'GitHub Repository',
        vscode.TreeItemCollapsibleState.None,
        'action',
        new vscode.ThemeIcon('github')
      );
      githubAction.command = {
        command: 'vscode.open',
        title: 'Open GitHub Repository',
        arguments: [vscode.Uri.parse('https://github.com/falabellamichael/SimpleSignal-VS-Code-Extension')],
      };

      return [
        autoFetchAction,
        addAction,
        openDashboardAction,
        runBenchmarkAction,
        testAction,
        openJsonAction,
        checkVramAction,
        checkRamAction,
        checkModelsAction,
        githubAction,
      ];
    }

    return [];
  }

  private isLocalEndpoint(epName: string): boolean {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const ep = endpoints.find((e) => e.name === epName);
    if (!ep) return false;
    const b = (ep.baseUrl || '').toLowerCase();
    const n = (ep.name || '').toLowerCase();
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

  private createModelNode(model: ModelConfig, endpointName: string): TreeItemNode {
    const badges: string[] = [];
    if (model.supportsVision) badges.push('👁️');
    if (model.supportsTools) badges.push('🛠️');

    const isLocal = this.isLocalEndpoint(endpointName);
    const contextVal = isLocal ? 'model_item_local' : 'model_item_api';

    const isSelected = this.selectedModel &&
      this.selectedModel.modelId.toLowerCase() === model.id.toLowerCase() &&
      (!this.selectedModel.endpointName || this.selectedModel.endpointName.toLowerCase() === endpointName.toLowerCase());

    const key = `${endpointName}:::${model.id}`.toLowerCase();
    const isLoaded = this.loadedModels.has(key) ||
      this.loadedModels.has(model.id.toLowerCase()) ||
      Array.from(this.loadedModels).some((k) => k.length > 3 && (k.includes(model.id.toLowerCase()) || model.id.toLowerCase().includes(k)));

    let icon: vscode.ThemeIcon | vscode.Uri;
    if (isSelected) {
      icon = new vscode.ThemeIcon('radio-tower', new vscode.ThemeColor('charts.yellow'));
      badges.unshift('✨ [ACTIVE]');
    } else if (isLoaded) {
      icon = new vscode.ThemeIcon('zap', new vscode.ThemeColor('charts.green'));
      badges.unshift('⚡ [LOADED]');
    } else {
      icon = this.getSignalLogoIcon();
    }

    const node = new TreeItemNode(
      model.id,
      vscode.TreeItemCollapsibleState.None,
      contextVal,
      icon
    );
    node.description = `${badges.join(' ')} [${endpointName}]`;
    node.tooltip = `Model: ${model.id}\nEndpoint: ${endpointName}\nStatus: ${isSelected ? 'Selected Active Model' : isLoaded ? 'Loaded in Memory' : 'Available'}\nType: ${isLocal ? 'Local Server' : 'Cloud API'}\nContext Window: ${model.contextLength || 131072} tokens\nVision: ${model.supportsVision ? 'Yes' : 'No'}\nTools: ${model.supportsTools ? 'Yes' : 'No'}`;
    (node as any).model = model;
    (node as any).endpointName = endpointName;
    return node;
  }
}

export class TreeItemNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }
  ) {
    super(label, collapsibleState);
  }
}
