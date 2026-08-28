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
exports.SimpleSignalChatParticipant = void 0;
const vscode = __importStar(require("vscode"));
const dashboard_1 = require("./dashboard");
const utils_1 = require("./utils");
const telemetryTracker_1 = require("./telemetryTracker");
class SimpleSignalChatParticipant {
    static register(context, provider, treeDataProvider, statusBarItem, outputChannel) {
        const handler = async (request, chatContext, stream, token) => {
            const config = vscode.workspace.getConfiguration('simplesignal');
            const endpoints = config.get('endpoints', []);
            const defaultModelSetting = config.get('defaultModel', '');
            // 1. Handle "/models" command
            if (request.command === 'models') {
                stream.markdown('## 📡 SimpleSignal Model Directory\n\n');
                let total = 0;
                for (const ep of endpoints) {
                    if (ep.enabled === false)
                        continue;
                    const models = ep.models || [];
                    if (models.length === 0)
                        continue;
                    total += models.length;
                    stream.markdown(`### 🔹 ${ep.name} (\`${ep.baseUrl}\`)\n\n`);
                    stream.markdown('| Model Identifier | Context | Status | Quick Action |\n');
                    stream.markdown('| :--- | :--- | :--- | :--- |\n');
                    for (const m of models) {
                        const isSel = defaultModelSetting && defaultModelSetting.toLowerCase() === `${ep.name}:::${m.id}`.toLowerCase();
                        const statusBadge = isSel ? '`✨ Active`' : '`🟢 Available`';
                        const ctxLen = m.contextLength ? `${Math.round(m.contextLength / 1024)}k` : '128k';
                        const switchUrl = `command:simplesignal.selectModel?${encodeURIComponent(JSON.stringify({ endpointName: ep.name, model: { id: m.id } }))}`;
                        stream.markdown(`| **\`${m.id}\`** | ${ctxLen} | ${statusBadge} | [⚡ Switch to Model](${switchUrl}) |\n`);
                    }
                    stream.markdown('\n');
                }
                if (total === 0) {
                    stream.markdown('> ⚠️ _No models discovered yet. Open the Visual Hub to auto-fetch models._\n');
                }
                return;
            }
            // 2. Handle "/switch" command
            if (request.command === 'switch') {
                const query = request.prompt.trim().toLowerCase();
                if (!query) {
                    stream.markdown('> ℹ️ **Usage:** `@simplesignal /switch <model_name_or_keyword>`\n>\n> *Examples: `/switch deepseek` or `/switch qwen`*\n');
                    return;
                }
                let matchedEp;
                let matchedModel;
                for (const ep of endpoints) {
                    if (ep.enabled === false)
                        continue;
                    for (const m of ep.models || []) {
                        if (m.id.toLowerCase() === query || m.id.toLowerCase().includes(query)) {
                            matchedEp = ep;
                            matchedModel = m.id;
                            break;
                        }
                    }
                    if (matchedModel)
                        break;
                }
                if (!matchedModel && query) {
                    for (const ep of endpoints) {
                        if (ep.enabled === false)
                            continue;
                        if (ep.name.toLowerCase().includes(query) && ep.models && ep.models.length > 0) {
                            matchedEp = ep;
                            matchedModel = ep.models[0].id;
                            break;
                        }
                    }
                }
                if (matchedEp && matchedModel) {
                    const compKey = `${matchedEp.name}:::${matchedModel}`;
                    try {
                        await config.update('defaultModel', compKey, vscode.ConfigurationTarget.Global);
                    }
                    catch { }
                    dashboard_1.SimpleSignalDashboard.selectedModel = { endpointName: matchedEp.name, modelId: matchedModel };
                    dashboard_1.SimpleSignalDashboard.onModelSelectionChanged?.(matchedEp.name, matchedModel);
                    treeDataProvider.setSelectedModel(matchedEp.name, matchedModel);
                    provider.refresh();
                    if (statusBarItem) {
                        statusBarItem.text = `$(radio-tower) SimpleSignal: ${matchedModel}`;
                        statusBarItem.show();
                    }
                    stream.markdown(`> ### ⚡ SimpleSignal Route Updated\n>\n> - **Active Model:** \`${matchedModel}\`\n> - **Provider Engine:** \`${matchedEp.name}\`\n> - **Status:** 🟢 Connected & Ready\n>\n> _All prompt requests will now execute against this model._\n`);
                }
                else {
                    stream.markdown(`> ❌ **No match for** \`${query}\`\n>\n> Type \`@simplesignal /models\` to view all registered engines and identifiers.\n`);
                }
                return;
            }
            // 3. Handle "/status" command
            if (request.command === 'status') {
                let activeEpName = 'None';
                let activeModelId = 'None';
                if (defaultModelSetting && defaultModelSetting.includes(':::')) {
                    const parts = defaultModelSetting.split(':::');
                    activeEpName = parts[0];
                    activeModelId = parts.slice(1).join(':::');
                }
                else if (dashboard_1.SimpleSignalDashboard.selectedModel) {
                    activeEpName = dashboard_1.SimpleSignalDashboard.selectedModel.endpointName;
                    activeModelId = dashboard_1.SimpleSignalDashboard.selectedModel.modelId;
                }
                const totalModels = endpoints.reduce((sum, ep) => sum + (ep.models?.length || 0), 0);
                stream.markdown(`## ⚡ SimpleSignal System Status\n\n`);
                stream.markdown('| Property | Current State |\n');
                stream.markdown('| :--- | :--- |\n');
                stream.markdown(`| **Active Model** | \`${activeModelId}\` |\n`);
                stream.markdown(`| **Active Provider** | \`${activeEpName}\` |\n`);
                stream.markdown(`| **Configured Endpoints** | \`${endpoints.length}\` engines |\n`);
                stream.markdown(`| **Total Models** | \`${totalModels}\` available |\n`);
                stream.markdown(`| **Telemetry & Metrics** | 🟢 Real-time Tracker Active |\n`);
                return;
            }
            // 4. Default Chat Execution: Stream response from actively selected model
            let targetEndpoint;
            let actualModelId = '';
            if (defaultModelSetting && defaultModelSetting.includes(':::')) {
                const parts = defaultModelSetting.split(':::');
                targetEndpoint = endpoints.find((e) => e.name.toLowerCase() === parts[0].toLowerCase());
                actualModelId = parts.slice(1).join(':::');
            }
            else if (dashboard_1.SimpleSignalDashboard.selectedModel) {
                targetEndpoint = endpoints.find((e) => e.name.toLowerCase() === dashboard_1.SimpleSignalDashboard.selectedModel.endpointName.toLowerCase());
                actualModelId = dashboard_1.SimpleSignalDashboard.selectedModel.modelId;
            }
            if (!targetEndpoint && endpoints.length > 0) {
                for (const ep of endpoints) {
                    if (ep.enabled !== false && ep.models && ep.models.length > 0) {
                        targetEndpoint = ep;
                        actualModelId = ep.models[0].id;
                        break;
                    }
                }
            }
            if (!targetEndpoint || !actualModelId) {
                stream.markdown('> ⚠️ **No active model selected.** Please open the Visual Hub or type `@simplesignal /models` to pick a model.\n');
                return;
            }
            outputChannel.appendLine(`[SimpleSignal Chat] Dispatching query to "${targetEndpoint.name}" for model "${actualModelId}"`);
            const estimatedPromptTokens = Math.max(1, Math.ceil(request.prompt.length / 3.8));
            const stats = telemetryTracker_1.ModelTelemetryTracker.startMessage({
                modelId: actualModelId,
                modelName: actualModelId,
                endpointName: targetEndpoint.name,
                protocol: targetEndpoint.protocol || 'openai',
                source: 'vscode-chat',
                promptPreview: request.prompt.slice(0, 1500),
                promptTokens: estimatedPromptTokens,
            });
            const baseUrl = (0, utils_1.normalizeBaseUrl)(targetEndpoint.baseUrl);
            let chatUrl = baseUrl;
            if (!chatUrl.endsWith('/chat/completions')) {
                chatUrl = `${baseUrl}/chat/completions`;
            }
            // Build conversation history from chat context
            const messages = [];
            for (const turn of chatContext.history) {
                if (turn instanceof vscode.ChatRequestTurn) {
                    messages.push({ role: 'user', content: turn.prompt });
                }
                else if (turn instanceof vscode.ChatResponseTurn) {
                    let responseText = '';
                    for (const part of turn.response) {
                        if (part instanceof vscode.ChatResponseMarkdownPart) {
                            responseText += part.value.value;
                        }
                    }
                    if (responseText) {
                        messages.push({ role: 'assistant', content: responseText });
                    }
                }
            }
            messages.push({ role: 'user', content: request.prompt });
            const candidateKeys = (0, utils_1.getApiKeyCandidates)(targetEndpoint);
            if (candidateKeys.length === 0)
                candidateKeys.push('');
            let fullCompletion = '';
            let completionTokens = 0;
            let isSuccess = false;
            let inThinkingBlock = false;
            for (const apiKey of candidateKeys) {
                try {
                    const headers = {
                        'Content-Type': 'application/json',
                        'User-Agent': 'VSCode-SimpleSignal/1.0',
                        ...(targetEndpoint.customHeaders || {}),
                    };
                    if (apiKey) {
                        headers['Authorization'] = `Bearer ${apiKey}`;
                    }
                    const payload = {
                        model: actualModelId,
                        messages,
                        stream: true,
                        temperature: 0.7,
                    };
                    const res = await fetch(chatUrl, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok) {
                        const errText = await res.text().catch(() => '');
                        if (res.status === 401 && candidateKeys.length > 1 && apiKey !== candidateKeys[candidateKeys.length - 1]) {
                            continue;
                        }
                        throw new Error(`HTTP ${res.status}: ${res.statusText} - ${errText}`);
                    }
                    if (!res.body) {
                        throw new Error('Response body is empty.');
                    }
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    const openThinkingTag = '🧠 **Thought Process**\n```thinking\n';
                    const closeThinkingTag = '\n```\n\n';
                    let buffer = '';
                    let reasoningLineLen = 0;
                    const wrapReasoning = (chunk, maxLen = 78) => {
                        let res = '';
                        for (let i = 0; i < chunk.length; i++) {
                            const ch = chunk[i];
                            if (ch === '\n') {
                                res += '\n';
                                reasoningLineLen = 0;
                            }
                            else {
                                if (reasoningLineLen >= maxLen && (ch === ' ' || ch === '\t')) {
                                    res += '\n';
                                    reasoningLineLen = 0;
                                }
                                else {
                                    res += ch;
                                    reasoningLineLen++;
                                }
                            }
                        }
                        return res;
                    };
                    while (true) {
                        if (token.isCancellationRequested) {
                            reader.cancel();
                            break;
                        }
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data:'))
                                continue;
                            const dataStr = trimmed.slice(5).trim();
                            if (dataStr === '[DONE]')
                                continue;
                            try {
                                const parsed = JSON.parse(dataStr);
                                const choice = parsed.choices?.[0];
                                if (!choice)
                                    continue;
                                const delta = choice.delta;
                                if (!delta)
                                    continue;
                                if (delta.reasoning_content) {
                                    if (!inThinkingBlock) {
                                        stream.markdown(openThinkingTag);
                                        inThinkingBlock = true;
                                        reasoningLineLen = 0;
                                    }
                                    const wrapped = wrapReasoning(delta.reasoning_content);
                                    stream.markdown(wrapped);
                                    telemetryTracker_1.ModelTelemetryTracker.updateChunk(stats.id, delta.reasoning_content, true);
                                }
                                let content = delta.content || choice.text || '';
                                if (content) {
                                    if (inThinkingBlock && !delta.reasoning_content) {
                                        stream.markdown(closeThinkingTag);
                                        inThinkingBlock = false;
                                        reasoningLineLen = 0;
                                    }
                                    if (content.includes('<think>')) {
                                        inThinkingBlock = true;
                                        reasoningLineLen = 0;
                                        content = content.replace(/<think>/g, openThinkingTag);
                                    }
                                    if (content.includes('</think>')) {
                                        inThinkingBlock = false;
                                        reasoningLineLen = 0;
                                        content = content.replace(/<\/think>/g, closeThinkingTag);
                                    }
                                    else if (inThinkingBlock) {
                                        content = wrapReasoning(content);
                                    }
                                    fullCompletion += content;
                                    completionTokens += Math.max(1, Math.ceil(content.length / 3.8));
                                    stream.markdown(content);
                                    telemetryTracker_1.ModelTelemetryTracker.updateChunk(stats.id, content, false);
                                }
                            }
                            catch { }
                        }
                    }
                    if (inThinkingBlock) {
                        stream.markdown(closeThinkingTag);
                        inThinkingBlock = false;
                    }
                    isSuccess = true;
                    break;
                }
                catch (err) {
                    if (apiKey === candidateKeys[candidateKeys.length - 1]) {
                        stream.markdown(`\n\n> ❌ **Error from ${targetEndpoint.name}:** ${err.message || err}\n`);
                        telemetryTracker_1.ModelTelemetryTracker.failMessage(stats.id, err.message || String(err));
                        return;
                    }
                }
            }
            if (isSuccess) {
                const finalStats = telemetryTracker_1.ModelTelemetryTracker.completeMessage(stats.id);
                if (finalStats) {
                    outputChannel.appendLine(`[SimpleSignal Chat] Completed ${actualModelId} in ${finalStats.totalDurationMs}ms (${finalStats.tokensPerSec.toFixed(1)} tok/s)`);
                    // Subtle, discrete telemetry footer matching VS Code aesthetics
                    stream.markdown(`\n\n---\n<sub>⚡ <b>SimpleSignal</b> &bull; <code>${actualModelId}</code> &bull; ⚡ <b>${finalStats.tokensPerSec.toFixed(1)} tok/s</b> &bull; ⏱️ <b>${finalStats.totalDurationMs}ms</b></sub>`);
                }
            }
        };
        const participant = vscode.chat.createChatParticipant('simplesignal.participant', handler);
        participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.svg');
        return participant;
    }
}
exports.SimpleSignalChatParticipant = SimpleSignalChatParticipant;
//# sourceMappingURL=chatParticipant.js.map