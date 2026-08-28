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
exports.ModelFetcher = void 0;
const vscode = __importStar(require("vscode"));
const utils_1 = require("./utils");
const LOCAL_PROBE_TARGETS = [
    {
        name: 'SimpleRAG Local Server',
        baseUrl: 'http://127.0.0.1:11211/v1',
        apiKey: 'Maitland1,',
        protocol: 'openai',
        checkUrl: 'http://127.0.0.1:11211/v1/models',
    },
    {
        name: 'Lemonade Local Server',
        baseUrl: 'http://127.0.0.1:9000/api/v1',
        apiKey: 'local-lemonade',
        protocol: 'lemonade',
        checkUrl: 'http://127.0.0.1:9000/api/v1/models',
    },
    {
        name: 'LM Studio Local Server',
        baseUrl: 'http://127.0.0.1:1234/v1',
        apiKey: 'lm-studio',
        protocol: 'openai',
        checkUrl: 'http://127.0.0.1:1234/v1/models',
    },
    {
        name: 'Ollama Local Server',
        baseUrl: 'http://127.0.0.1:11434',
        apiKey: '',
        protocol: 'ollama',
        checkUrl: 'http://127.0.0.1:11434/api/tags',
    },
    {
        name: 'LocalAI / vLLM (Port 8000)',
        baseUrl: 'http://127.0.0.1:8000/v1',
        apiKey: '',
        protocol: 'openai',
        checkUrl: 'http://127.0.0.1:8000/v1/models',
    },
];
class ModelFetcher {
    static async autoFetchAllAndUpdateJSON(outputChannel) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const autoScan = config.get('autoScanLocalServers', true);
        let endpoints = JSON.parse(JSON.stringify(config.get('endpoints', [])));
        outputChannel?.appendLine('[SimpleSignal] Starting auto-fetch of models...');
        // 1. Auto-probe local servers if enabled
        if (autoScan) {
            for (const target of LOCAL_PROBE_TARGETS) {
                const alreadyExists = endpoints.some((e) => (0, utils_1.normalizeBaseUrl)(e.baseUrl) === (0, utils_1.normalizeBaseUrl)(target.baseUrl));
                if (!alreadyExists) {
                    try {
                        const candidateKeys = (0, utils_1.getApiKeyCandidates)(target);
                        let reachable = false;
                        let workingKey = target.apiKey;
                        for (const key of candidateKeys) {
                            reachable = await this.checkUrlReachable(target.checkUrl, key);
                            if (reachable) {
                                workingKey = key;
                                break;
                            }
                        }
                        if (reachable) {
                            outputChannel?.appendLine(`[SimpleSignal] Auto-detected active server: ${target.name}`);
                            endpoints.push({
                                name: target.name,
                                baseUrl: target.baseUrl,
                                apiKey: workingKey,
                                protocol: target.protocol,
                                enabled: true,
                                models: [],
                            });
                        }
                    }
                    catch {
                        // offline
                    }
                }
            }
        }
        if (endpoints.length === 0) {
            endpoints = [
                {
                    name: 'Lemonade Local Server',
                    baseUrl: 'http://127.0.0.1:9000/api/v1',
                    apiKey: 'local-lemonade',
                    protocol: 'lemonade',
                    enabled: true,
                    models: [],
                },
            ];
        }
        let totalFetchedModels = 0;
        // 2. Query models for every endpoint
        for (const endpoint of endpoints) {
            if (endpoint.enabled === false) {
                continue;
            }
            try {
                // Auto-fix URL formatting (e.g. localhost:11211/v1 -> http://localhost:11211/v1)
                endpoint.baseUrl = (0, utils_1.normalizeBaseUrl)(endpoint.baseUrl);
                // SimpleRAG uses OpenAI compatible format
                if (endpoint.baseUrl.includes(':11211') || endpoint.name.toLowerCase().includes('simplerag')) {
                    endpoint.protocol = 'openai';
                }
                // Automatically ensure active API key is resolved
                if (!endpoint.apiKey || endpoint.apiKey === 'lemonade') {
                    endpoint.apiKey = (0, utils_1.resolveEndpointApiKey)(endpoint);
                }
                outputChannel?.appendLine(`[SimpleSignal] Querying models from: ${endpoint.name} (${endpoint.baseUrl})...`);
                const models = await this.fetchModelsForEndpoint(endpoint);
                if (models.length > 0) {
                    endpoint.models = models;
                    totalFetchedModels += models.length;
                    outputChannel?.appendLine(`[SimpleSignal] -> Found ${models.length} model(s) for ${endpoint.name}`);
                }
                else {
                    outputChannel?.appendLine(`[SimpleSignal] -> No models returned for ${endpoint.name} (preserving existing).`);
                }
            }
            catch (err) {
                outputChannel?.appendLine(`[SimpleSignal] -> Notice for ${endpoint.name}: ${err.message || err}`);
            }
        }
        // 3. Write back to settings.json
        await config.update('endpoints', endpoints, vscode.ConfigurationTarget.Global);
        outputChannel?.appendLine(`[SimpleSignal] Configuration updated in settings.json (${totalFetchedModels} total models across ${endpoints.length} endpoints).`);
        return {
            totalEndpoints: endpoints.length,
            totalModels: totalFetchedModels,
            updatedEndpoints: endpoints,
        };
    }
    static async checkUrlReachable(url, apiKey) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        try {
            const headers = {};
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
            clearTimeout(timeout);
            return res.ok || res.status === 401;
        }
        catch {
            clearTimeout(timeout);
            return false;
        }
    }
    static async fetchModelsForEndpoint(endpoint) {
        const protocol = endpoint.protocol || 'openai';
        const baseUrl = endpoint.baseUrl.replace(/\/$/, '');
        const candidateKeys = (0, utils_1.getApiKeyCandidates)(endpoint);
        if (candidateKeys.length === 0)
            candidateKeys.push('');
        const isLocal = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost') || baseUrl.includes('0.0.0.0');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), isLocal ? 1500 : 7000);
        try {
            if (protocol === 'ollama') {
                const headers = {
                    'User-Agent': 'VSCode-SimpleSignal/1.0',
                    ...(endpoint.customHeaders || {}),
                };
                const url = baseUrl.includes('/api/tags') ? baseUrl : `${baseUrl}/api/tags`;
                const res = await fetch(url, { headers, signal: controller.signal });
                clearTimeout(timeout);
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }
                const data = await res.json();
                const modelsList = data.models || [];
                return modelsList.map((m) => {
                    const id = m.name || m.model;
                    return {
                        id,
                        name: `${id} [${endpoint.name}]`,
                        contextLength: 131072,
                        maxOutputTokens: 8192,
                        supportsVision: id.toLowerCase().includes('vision') || id.toLowerCase().includes('vl') || id.toLowerCase().includes('llava'),
                        supportsTools: true,
                        enabled: true,
                        endpointName: endpoint.name,
                    };
                });
            }
            if (protocol === 'gemini') {
                const key = candidateKeys[0] || endpoint.apiKey || '';
                const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(timeout);
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }
                const data = await res.json();
                const modelsList = (data.models || []).filter((m) => m.supportedGenerationMethods?.includes('generateContent'));
                return modelsList.map((m) => {
                    const id = m.name?.replace(/^models\//, '') || m.displayName;
                    return {
                        id,
                        name: `${m.displayName || id} [${endpoint.name}]`,
                        contextLength: m.inputTokenLimit || 1000000,
                        maxOutputTokens: m.outputTokenLimit || 8192,
                        supportsVision: true,
                        supportsTools: true,
                        enabled: true,
                        endpointName: endpoint.name,
                    };
                });
            }
            // OpenAI / Lemonade / LM Studio / DeepSeek / DashScope compatible
            let modelsUrl = baseUrl;
            if (baseUrl.endsWith('/chat/completions')) {
                modelsUrl = baseUrl.replace(/\/chat\/completions$/, '/models');
            }
            else if (!baseUrl.endsWith('/models')) {
                modelsUrl = `${baseUrl}/models`;
            }
            let res;
            let lastErrText = '';
            for (const apiKey of candidateKeys) {
                const headers = {
                    'User-Agent': 'VSCode-SimpleSignal/1.0',
                    ...(endpoint.customHeaders || {}),
                };
                if (apiKey) {
                    if (protocol === 'anthropic') {
                        headers['x-api-key'] = apiKey;
                        headers['anthropic-version'] = '2023-06-01';
                    }
                    else {
                        headers['Authorization'] = `Bearer ${apiKey}`;
                    }
                }
                const r = await fetch(modelsUrl, { headers, signal: controller.signal });
                if (r.status === 401 && candidateKeys.length > 1 && apiKey !== candidateKeys[candidateKeys.length - 1]) {
                    lastErrText = await r.text().catch(() => '');
                    continue;
                }
                res = r;
                break;
            }
            clearTimeout(timeout);
            if (!res || !res.ok) {
                const errText = res ? await res.text().catch(() => '') : lastErrText;
                throw new Error(`HTTP ${res?.status || 401}: ${res?.statusText || 'Unauthorized'} - ${errText}`);
            }
            const data = await res.json();
            const rawList = Array.isArray(data) ? data : data.data || data.models || [];
            return rawList.map((m) => {
                const id = typeof m === 'string' ? m : m.id || m.name || m.checkpoint;
                const labels = m.labels || [];
                const isVision = labels.includes('vision') ||
                    id.toLowerCase().includes('vision') ||
                    id.toLowerCase().includes('vl') ||
                    id.toLowerCase().includes('4o') ||
                    id.toLowerCase().includes('coyote') ||
                    id.toLowerCase().includes('snowfox');
                const isTools = !labels.includes('no-tools');
                const contextLen = m.max_context_window ||
                    m.context_length ||
                    m.recipe_options?.ctx_size ||
                    (id.toLowerCase().includes('deepseek') || id.toLowerCase().includes('qwen') ? 262144 : 131072);
                return {
                    id,
                    name: `${id} [${endpoint.name}]`,
                    contextLength: contextLen,
                    maxOutputTokens: 8192,
                    supportsVision: isVision,
                    supportsTools: isTools,
                    enabled: true,
                    endpointName: endpoint.name,
                };
            });
        }
        catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }
}
exports.ModelFetcher = ModelFetcher;
//# sourceMappingURL=modelFetcher.js.map