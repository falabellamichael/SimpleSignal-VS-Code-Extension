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
exports.SimpleSignalChatProvider = void 0;
const vscode = __importStar(require("vscode"));
const utils_1 = require("./utils");
const telemetryTracker_1 = require("./telemetryTracker");
class SimpleSignalChatProvider {
    context;
    outputChannel;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeLanguageModelChatInformation = this._onDidChange.event;
    constructor(context, outputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
        context.subscriptions.push(this._onDidChange);
    }
    refresh() {
        this._onDidChange.fire();
    }
    async provideLanguageModelChatInformation(_options, _token) {
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        const defaultModel = config.get('defaultModel', '');
        const result = [];
        let activeEndpointName = '';
        let activeModelId = '';
        if (defaultModel && defaultModel.includes(':::')) {
            const parts = defaultModel.split(':::');
            activeEndpointName = parts[0];
            activeModelId = parts.slice(1).join(':::');
        }
        // 1. Dynamic Active Model entry (routes automatically to currently selected model with full tool calling)
        result.push({
            id: 'simplesignal-active',
            name: '⚡ SimpleSignal: (Active)',
            family: activeModelId ? this.deduceFamily(activeModelId) : 'custom',
            version: '1.0',
            maxInputTokens: 131072,
            maxOutputTokens: 8192,
            capabilities: {
                vision: true,
                toolCalling: true,
            },
        });
        // 2. Add all configured models with clean names
        for (const ep of endpoints) {
            if (ep.enabled === false) {
                continue;
            }
            const models = ep.models || [];
            for (const m of models) {
                if (m.enabled === false) {
                    continue;
                }
                const compositeId = `${ep.name}:::${m.id}`;
                const displayName = m.id;
                const family = this.deduceFamily(m.id);
                const info = {
                    id: compositeId,
                    name: displayName,
                    family: family,
                    version: '1.0',
                    maxInputTokens: m.contextLength || 131072,
                    maxOutputTokens: m.maxOutputTokens || 8192,
                    capabilities: {
                        vision: m.supportsVision ?? false,
                        toolCalling: m.supportsTools ?? true,
                    },
                };
                result.push(info);
            }
        }
        return result;
    }
    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const modelId = model.id;
        const config = vscode.workspace.getConfiguration('simplesignal');
        const endpoints = config.get('endpoints', []);
        const defaultModel = config.get('defaultModel', '');
        let targetEndpoint;
        let actualModelId = modelId;
        // Prioritize the actively selected model from SimpleSignal Hub
        if (defaultModel && defaultModel.includes(':::')) {
            const parts = defaultModel.split(':::');
            const activeEp = endpoints.find((e) => e.name.toLowerCase() === parts[0].toLowerCase());
            if (activeEp) {
                targetEndpoint = activeEp;
                actualModelId = parts.slice(1).join(':::');
            }
        }
        // Fallback: If no active model was selected in Hub, resolve from the model requested by VS Code
        if (!targetEndpoint) {
            if (modelId.includes(':::')) {
                const parts = modelId.split(':::');
                const epName = parts[0];
                actualModelId = parts.slice(1).join(':::');
                targetEndpoint = endpoints.find((e) => e.name === epName);
            }
            if (!targetEndpoint) {
                for (const ep of endpoints) {
                    const match = (ep.models || []).find((m) => m.id === modelId || m.id.toLowerCase() === modelId.toLowerCase());
                    if (match) {
                        targetEndpoint = ep;
                        actualModelId = match.id;
                        break;
                    }
                }
            }
        }
        if (!targetEndpoint && endpoints.length > 0) {
            targetEndpoint = endpoints[0];
            if (targetEndpoint.models && targetEndpoint.models.length > 0) {
                actualModelId = targetEndpoint.models[0].id;
            }
        }
        if (!targetEndpoint) {
            throw new Error(`[SimpleSignal] No active endpoint configured for model "${modelId}".`);
        }
        this.outputChannel.appendLine(`[SimpleSignal] Sending request to "${targetEndpoint.name}" for model "${actualModelId}"`);
        // Extract prompt snippet and prompt token count
        let promptSnippet = '';
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === vscode.LanguageModelChatMessageRole.User) {
                for (const part of m.content ?? []) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        promptSnippet += part.value;
                    }
                }
                if (promptSnippet)
                    break;
            }
        }
        if (!promptSnippet && messages.length > 0) {
            for (const part of messages[messages.length - 1].content ?? []) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    promptSnippet += part.value;
                }
            }
        }
        const estimatedPromptTokens = Math.max(1, Math.ceil(promptSnippet.length / 3.8));
        // Initialize telemetry tracking session
        const telemetrySession = telemetryTracker_1.ModelTelemetryTracker.startMessage({
            modelId: actualModelId,
            modelName: model.name || actualModelId,
            endpointName: targetEndpoint.name,
            protocol: targetEndpoint.protocol || 'openai',
            source: 'vscode-chat',
            promptPreview: promptSnippet.slice(0, 1500),
            promptTokens: estimatedPromptTokens,
        });
        const baseUrl = (0, utils_1.normalizeBaseUrl)(targetEndpoint.baseUrl);
        let chatUrl = baseUrl;
        if (!chatUrl.endsWith('/chat/completions')) {
            chatUrl = `${baseUrl}/chat/completions`;
        }
        const openAIMessages = (0, utils_1.convertMessagesToOpenAI)(messages);
        const { tools, tool_choice } = (0, utils_1.convertToolsToOpenAI)(options);
        const body = {
            model: actualModelId,
            messages: openAIMessages,
            stream: true,
        };
        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = tool_choice;
        }
        const abortController = new AbortController();
        token.onCancellationRequested(() => {
            abortController.abort();
            this.outputChannel.appendLine(`[SimpleSignal] Request cancelled.`);
            telemetryTracker_1.ModelTelemetryTracker.failMessage(telemetrySession.id, 'Request cancelled by user or VS Code');
        });
        // Auto-grab candidate API keys (from config, environment, or known defaults)
        const candidateKeys = (0, utils_1.getApiKeyCandidates)(targetEndpoint);
        if (candidateKeys.length === 0) {
            candidateKeys.push('');
        }
        try {
            let response;
            let lastErrText = '';
            for (const apiKey of candidateKeys) {
                if (token.isCancellationRequested)
                    break;
                const headers = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'VSCode-SimpleSignal/1.0',
                    ...(targetEndpoint.customHeaders || {}),
                };
                if (apiKey) {
                    headers['Authorization'] = `Bearer ${apiKey}`;
                }
                const res = await fetch(chatUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: abortController.signal,
                });
                if (res.status === 401 && candidateKeys.length > 1 && apiKey !== candidateKeys[candidateKeys.length - 1]) {
                    lastErrText = await res.text().catch(() => '');
                    this.outputChannel.appendLine(`[SimpleSignal] Key "${apiKey.slice(0, 6)}..." received 401, trying next candidate key...`);
                    continue;
                }
                response = res;
                break;
            }
            if (!response || !response.ok) {
                const errText = response ? await response.text().catch(() => '') : lastErrText;
                this.outputChannel.appendLine(`[SimpleSignal] HTTP Error ${response?.status || 401}: ${errText}`);
                const errMsg = `SimpleSignal request failed: ${response?.status || 401} ${response?.statusText || 'Unauthorized'} - ${errText}`;
                telemetryTracker_1.ModelTelemetryTracker.failMessage(telemetrySession.id, errMsg);
                throw new Error(errMsg);
            }
            if (!response.body) {
                const errMsg = '[SimpleSignal] Response body is empty.';
                telemetryTracker_1.ModelTelemetryTracker.failMessage(telemetrySession.id, errMsg);
                throw new Error(errMsg);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            const pendingToolCalls = new Map();
            let inThinkingBlock = false;
            while (!token.isCancellationRequested) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line || line.startsWith(':'))
                        continue;
                    if (line === 'data: [DONE]')
                        break;
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        try {
                            const data = JSON.parse(jsonStr);
                            const choice = data.choices?.[0];
                            if (!choice)
                                continue;
                            const delta = choice.delta;
                            if (!delta)
                                continue;
                            const openThinkingTag = '<details open>\n<summary>🧠 <b>Thought Process</b> <sub><i>(click to toggle)</i></sub></summary>\n\n> <sub><i>💭 Reasoning:</i></sub>\n> ';
                            const closeThinkingTag = '\n> \n> <sub><i>— end of thought —</i></sub>\n\n</details>\n\n';
                            if (delta.reasoning_content) {
                                if (!inThinkingBlock) {
                                    progress.report(new vscode.LanguageModelTextPart(openThinkingTag));
                                    inThinkingBlock = true;
                                }
                                const formatted = delta.reasoning_content.replace(/\n/g, '\n> ');
                                progress.report(new vscode.LanguageModelTextPart(formatted));
                                telemetryTracker_1.ModelTelemetryTracker.updateChunk(telemetrySession.id, delta.reasoning_content, true);
                            }
                            if (delta.content) {
                                if (inThinkingBlock && !delta.reasoning_content) {
                                    progress.report(new vscode.LanguageModelTextPart(closeThinkingTag));
                                    inThinkingBlock = false;
                                }
                                let text = delta.content;
                                if (text.includes('<think>')) {
                                    inThinkingBlock = true;
                                    text = text.replace(/<think>/g, openThinkingTag);
                                }
                                if (text.includes('</think>')) {
                                    inThinkingBlock = false;
                                    text = text.replace(/<\/think>/g, closeThinkingTag);
                                }
                                else if (inThinkingBlock) {
                                    text = text.replace(/\n/g, '\n> ');
                                }
                                progress.report(new vscode.LanguageModelTextPart(text));
                                telemetryTracker_1.ModelTelemetryTracker.updateChunk(telemetrySession.id, delta.content, false);
                            }
                            if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                                for (const tc of delta.tool_calls) {
                                    const idx = tc.index ?? 0;
                                    if (!pendingToolCalls.has(idx)) {
                                        pendingToolCalls.set(idx, {
                                            id: tc.id || `call_${Date.now()}_${idx}`,
                                            name: tc.function?.name || '',
                                            args: tc.function?.arguments || '',
                                        });
                                    }
                                    else {
                                        const existing = pendingToolCalls.get(idx);
                                        if (tc.id)
                                            existing.id = tc.id;
                                        if (tc.function?.name)
                                            existing.name += tc.function.name;
                                        if (tc.function?.arguments)
                                            existing.args += tc.function.arguments;
                                    }
                                }
                            }
                            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
                                for (const [, tc] of pendingToolCalls) {
                                    if (tc.name) {
                                        let parsedArgs = {};
                                        try {
                                            parsedArgs = JSON.parse(tc.args || '{}');
                                        }
                                        catch {
                                            parsedArgs = { raw: tc.args };
                                        }
                                        progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, parsedArgs));
                                    }
                                }
                                pendingToolCalls.clear();
                            }
                        }
                        catch {
                            // ignore
                        }
                    }
                }
            }
            for (const [, tc] of pendingToolCalls) {
                if (tc.name) {
                    let parsedArgs = {};
                    try {
                        parsedArgs = JSON.parse(tc.args || '{}');
                    }
                    catch {
                        parsedArgs = { raw: tc.args };
                    }
                    progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, parsedArgs));
                }
            }
            telemetryTracker_1.ModelTelemetryTracker.completeMessage(telemetrySession.id);
        }
        catch (err) {
            if (!token.isCancellationRequested) {
                telemetryTracker_1.ModelTelemetryTracker.failMessage(telemetrySession.id, err.message || String(err));
            }
            throw err;
        }
    }
    async provideTokenCount(_model, text, _token) {
        if (typeof text === 'string') {
            return Math.ceil(text.length / 4.0);
        }
        let totalLen = 0;
        for (const part of text.content ?? []) {
            if (part instanceof vscode.LanguageModelTextPart) {
                totalLen += part.value.length;
            }
        }
        return Math.max(1, Math.ceil(totalLen / 4.0));
    }
    deduceFamily(id) {
        const lower = id.toLowerCase();
        if (lower.includes('qwen'))
            return 'qwen';
        if (lower.includes('deepseek'))
            return 'deepseek';
        if (lower.includes('gemma'))
            return 'gemma';
        if (lower.includes('llama'))
            return 'llama';
        if (lower.includes('claude'))
            return 'claude';
        if (lower.includes('gpt'))
            return 'gpt';
        if (lower.includes('mistral'))
            return 'mistral';
        if (lower.includes('lemon'))
            return 'lemonade';
        return 'custom';
    }
}
exports.SimpleSignalChatProvider = SimpleSignalChatProvider;
//# sourceMappingURL=provider.js.map