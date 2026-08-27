import * as vscode from 'vscode';
import { EndpointConfig, ModelConfig } from './types';

export class SimpleSignalTreeDataProvider implements vscode.TreeDataProvider<TreeItemNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

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
        new vscode.ThemeIcon('hubot')
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
      const allModels: { model: ModelConfig; epName: string }[] = [];
      for (const ep of endpoints) {
        if (ep.enabled === false) continue;
        for (const m of ep.models || []) {
          allModels.push({ model: m, epName: ep.name });
        }
      }

      if (allModels.length === 0) {
        return [
          new TreeItemNode('No models available. Click "Auto-Fetch Models" below.', vscode.TreeItemCollapsibleState.None, 'empty', new vscode.ThemeIcon('info')),
        ];
      }

      return allModels.map(({ model, epName }) => this.createModelNode(model, epName));
    }

    if (element.contextValue === 'category_actions') {
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

      return [
        checkVramAction,
        checkRamAction,
        checkModelsAction,
        autoFetchAction,
        addAction,
        openDashboardAction,
        testAction,
        openJsonAction,
      ];
    }

    return [];
  }

  private createModelNode(model: ModelConfig, endpointName: string): TreeItemNode {
    const badges: string[] = [];
    if (model.supportsVision) badges.push('👁️');
    if (model.supportsTools) badges.push('🛠️');

    const node = new TreeItemNode(
      model.id,
      vscode.TreeItemCollapsibleState.None,
      'model_item',
      new vscode.ThemeIcon('sparkle', new vscode.ThemeColor('charts.yellow'))
    );
    node.description = `${badges.join(' ')} [${endpointName}]`;
    node.tooltip = `Model: ${model.id}\nEndpoint: ${endpointName}\nContext Window: ${model.contextLength || 131072} tokens\nVision: ${model.supportsVision ? 'Yes' : 'No'}\nTools: ${model.supportsTools ? 'Yes' : 'No'}`;
    return node;
  }
}

export class TreeItemNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly iconPath?: vscode.ThemeIcon | vscode.Uri
  ) {
    super(label, collapsibleState);
  }
}
