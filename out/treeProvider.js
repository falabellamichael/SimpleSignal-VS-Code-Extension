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
exports.TreeItemNode = exports.SimpleSignalTreeDataProvider = void 0;
const vscode = __importStar(require("vscode"));
class SimpleSignalTreeDataProvider {
    extensionUri;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    selectedModel;
    loadedModels = new Set();
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        const config = vscode.workspace.getConfiguration('simplesignal');
        const defaultModel = config.get('defaultModel');
        if (defaultModel && defaultModel.includes(':::')) {
            const parts = defaultModel.split(':::');
            this.selectedModel = { endpointName: parts[0], modelId: parts.slice(1).join(':::') };
        }
    }
    setSelectedModel(endpointName, modelId) {
        this.selectedModel = { endpointName, modelId };
        this.refresh();
    }
    setLoadedModels(keys) {
        this.loadedModels = new Set(keys.map((k) => k.toLowerCase()));
        this.refresh();
    }
    getSignalLogoIcon() {
        if (this.extensionUri) {
            return vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.svg');
        }
        return new vscode.ThemeIcon('radio-tower', new vscode.ThemeColor('charts.yellow'));
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        if (!element) {
            const totalModels = endpoints.reduce((acc, e) => acc + (e.models?.length || 0), 0);
            const endpointsCategory = new TreeItemNode(`Signal Endpoints (${endpoints.length})`, vscode.TreeItemCollapsibleState.Expanded, 'category_endpoints', new vscode.ThemeIcon('radio-tower'));
            const modelsCategory = new TreeItemNode(`Available Models (${totalModels})`, vscode.TreeItemCollapsibleState.Expanded, 'category_models', this.getSignalLogoIcon());
            const actionsCategory = new TreeItemNode('Quick Actions', vscode.TreeItemCollapsibleState.Expanded, 'category_actions', new vscode.ThemeIcon('zap'));
            return [endpointsCategory, modelsCategory, actionsCategory];
        }
        if (element.contextValue === 'category_endpoints') {
            if (endpoints.length === 0) {
                return [
                    new TreeItemNode('No endpoints configured yet', vscode.TreeItemCollapsibleState.None, 'empty', new vscode.ThemeIcon('info')),
                ];
            }
            return endpoints.map((ep) => {
                const isOnline = ep.enabled !== false;
                const icon = isOnline ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')) : new vscode.ThemeIcon('circle-slash');
                const node = new TreeItemNode(ep.name, vscode.TreeItemCollapsibleState.Collapsed, 'endpoint_item', icon);
                node.description = `${ep.models?.length || 0} models • ${ep.baseUrl}`;
                node.tooltip = `Base URL: ${ep.baseUrl}\nProtocol: ${ep.protocol || 'openai'}\nStatus: ${isOnline ? 'Active' : 'Disabled'}`;
                node.endpoint = ep;
                return node;
            });
        }
        if (element.contextValue === 'endpoint_item') {
            const ep = element.endpoint;
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
                const node = new TreeItemNode(`${ep.name} (${ep.models?.length || 0})`, vscode.TreeItemCollapsibleState.Collapsed, 'provider_models_group', new vscode.ThemeIcon('server-process', new vscode.ThemeColor('charts.blue')));
                node.description = `${ep.models?.length || 0} models`;
                node.endpoint = ep;
                return node;
            });
        }
        if (element.contextValue === 'provider_models_group') {
            const ep = element.endpoint;
            const models = ep.models || [];
            return models.map((m) => this.createModelNode(m, ep.name));
        }
        if (element.contextValue === 'category_actions') {
            const autoFetchAction = new TreeItemNode('Auto-Fetch All Models & Fill JSON', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.purple')));
            autoFetchAction.command = { command: 'simplesignal.autoFetchModels', title: 'Auto-Fetch Models' };
            const addAction = new TreeItemNode('Add New Endpoint', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.blue')));
            addAction.command = { command: 'simplesignal.manageEndpoints', title: 'Add Endpoint' };
            const openDashboardAction = new TreeItemNode('Open SimpleSignal Visual Hub', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('dashboard', new vscode.ThemeColor('charts.red')));
            openDashboardAction.command = { command: 'simplesignal.openDashboard', title: 'Open Dashboard' };
            const runBenchmarkAction = new TreeItemNode('Performance Benchmark', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('zap', new vscode.ThemeColor('charts.yellow')));
            runBenchmarkAction.command = { command: 'simplesignal.runBenchmark', title: 'Performance Benchmark' };
            const testAction = new TreeItemNode('Test Signal Connections', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('pulse'));
            testAction.command = { command: 'simplesignal.testEndpoints', title: 'Test Connections' };
            const openJsonAction = new TreeItemNode('Edit settings.json', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('json'));
            openJsonAction.command = { command: 'simplesignal.openConfigFile', title: 'Open Settings JSON' };
            const checkVramAction = new TreeItemNode('Check VRAM (GPU Memory & Models)', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('circuit-board', new vscode.ThemeColor('charts.yellow')));
            checkVramAction.command = { command: 'simplesignal.checkVRAM', title: 'Check VRAM' };
            const checkRamAction = new TreeItemNode('Check RAM (System Memory & Processes)', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.green')));
            checkRamAction.command = { command: 'simplesignal.checkRAM', title: 'Check RAM' };
            const checkModelsAction = new TreeItemNode('Inspect Loaded / Stray Models', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('hubot', new vscode.ThemeColor('charts.orange')));
            checkModelsAction.command = { command: 'simplesignal.checkLoadedModels', title: 'Inspect Models' };
            const githubAction = new TreeItemNode('GitHub Repository', vscode.TreeItemCollapsibleState.None, 'action', new vscode.ThemeIcon('github'));
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
    isLocalEndpoint(epName) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        const ep = endpoints.find((e) => e.name === epName);
        if (!ep)
            return false;
        const b = (ep.baseUrl || '').toLowerCase();
        const n = (ep.name || '').toLowerCase();
        return (b.includes('localhost') ||
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
            n.includes('simplerag'));
    }
    createModelNode(model, endpointName) {
        const badges = [];
        if (model.supportsVision)
            badges.push('👁️');
        if (model.supportsTools)
            badges.push('🛠️');
        const isLocal = this.isLocalEndpoint(endpointName);
        const contextVal = isLocal ? 'model_item_local' : 'model_item_api';
        const isSelected = this.selectedModel &&
            this.selectedModel.modelId.toLowerCase() === model.id.toLowerCase() &&
            (!this.selectedModel.endpointName || this.selectedModel.endpointName.toLowerCase() === endpointName.toLowerCase());
        const key = `${endpointName}:::${model.id}`.toLowerCase();
        const isLoaded = this.loadedModels.has(key) ||
            this.loadedModels.has(model.id.toLowerCase()) ||
            Array.from(this.loadedModels).some((k) => k.length > 3 && (k.includes(model.id.toLowerCase()) || model.id.toLowerCase().includes(k)));
        let icon;
        if (isSelected) {
            icon = new vscode.ThemeIcon('radio-tower', new vscode.ThemeColor('charts.yellow'));
            badges.unshift('✨ [ACTIVE]');
        }
        else if (isLoaded) {
            icon = new vscode.ThemeIcon('zap', new vscode.ThemeColor('charts.green'));
            badges.unshift('⚡ [LOADED]');
        }
        else {
            icon = this.getSignalLogoIcon();
        }
        const node = new TreeItemNode(model.id, vscode.TreeItemCollapsibleState.None, contextVal, icon);
        node.description = `${badges.join(' ')} [${endpointName}]`;
        node.tooltip = `Model: ${model.id}\nEndpoint: ${endpointName}\nStatus: ${isSelected ? 'Selected Active Model' : isLoaded ? 'Loaded in Memory' : 'Available'}\nType: ${isLocal ? 'Local Server' : 'Cloud API'}\nContext Window: ${model.contextLength || 131072} tokens\nVision: ${model.supportsVision ? 'Yes' : 'No'}\nTools: ${model.supportsTools ? 'Yes' : 'No'}`;
        node.model = model;
        node.endpointName = endpointName;
        return node;
    }
}
exports.SimpleSignalTreeDataProvider = SimpleSignalTreeDataProvider;
class TreeItemNode extends vscode.TreeItem {
    label;
    collapsibleState;
    contextValue;
    iconPath;
    constructor(label, collapsibleState, contextValue, iconPath) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.contextValue = contextValue;
        this.iconPath = iconPath;
    }
}
exports.TreeItemNode = TreeItemNode;
//# sourceMappingURL=treeProvider.js.map