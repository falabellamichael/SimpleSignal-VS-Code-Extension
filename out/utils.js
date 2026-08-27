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
exports.convertMessagesToOpenAI = convertMessagesToOpenAI;
exports.convertToolsToOpenAI = convertToolsToOpenAI;
exports.resolveEndpointApiKey = resolveEndpointApiKey;
exports.getApiKeyCandidates = getApiKeyCandidates;
const vscode = __importStar(require("vscode"));
/**
 * Converts VS Code chat messages to OpenAI-compatible messages format.
 */
function convertMessagesToOpenAI(messages) {
    const out = [];
    for (const m of messages) {
        const role = mapRole(m.role);
        const textParts = [];
        const toolCalls = [];
        const toolResults = [];
        for (const part of m.content ?? []) {
            if (part instanceof vscode.LanguageModelTextPart) {
                textParts.push(part.value);
            }
            else if (part instanceof vscode.LanguageModelToolCallPart) {
                const id = part.callId || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                let args = '{}';
                try {
                    args = typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {});
                }
                catch {
                    args = '{}';
                }
                toolCalls.push({
                    id,
                    type: 'function',
                    function: {
                        name: part.name,
                        arguments: args,
                    },
                });
            }
            else if (isToolResultPart(part)) {
                const callId = part.callId ?? '';
                const content = collectToolResultText(part);
                toolResults.push({ callId, content });
            }
        }
        let emittedAssistantToolCall = false;
        if (toolCalls.length > 0) {
            out.push({
                role: 'assistant',
                content: textParts.join('') || null,
                tool_calls: toolCalls,
            });
            emittedAssistantToolCall = true;
        }
        for (const tr of toolResults) {
            out.push({
                role: 'tool',
                tool_call_id: tr.callId,
                content: tr.content || '',
            });
        }
        const text = textParts.join('');
        if (text && (role === 'system' || role === 'user' || (role === 'assistant' && !emittedAssistantToolCall))) {
            out.push({ role, content: text });
        }
    }
    return out;
}
function convertToolsToOpenAI(options) {
    const tools = (options.tools ?? []);
    if (!tools || tools.length === 0) {
        return {};
    }
    const toolDefs = tools.map((t) => {
        return {
            type: 'function',
            function: {
                name: t.name,
                description: t.description || '',
                parameters: t.inputSchema || { type: 'object', properties: {} },
            },
        };
    });
    let tool_choice = 'auto';
    if (options.toolMode === vscode.LanguageModelChatToolMode.Required && tools.length === 1) {
        tool_choice = { type: 'function', function: { name: tools[0].name } };
    }
    return { tools: toolDefs, tool_choice };
}
function mapRole(role) {
    if (role === vscode.LanguageModelChatMessageRole.User) {
        return 'user';
    }
    if (role === vscode.LanguageModelChatMessageRole.Assistant) {
        return 'assistant';
    }
    return 'system';
}
function isToolResultPart(part) {
    return part && typeof part === 'object' && 'callId' in part && 'content' in part;
}
function collectToolResultText(part) {
    let text = '';
    for (const c of part.content ?? []) {
        if (c instanceof vscode.LanguageModelTextPart) {
            text += c.value;
        }
        else if (typeof c === 'string') {
            text += c;
        }
        else {
            try {
                text += JSON.stringify(c);
            }
            catch {
                // ignore
            }
        }
    }
    return text;
}
/**
 * Automatically grabs and resolves active API keys from configuration,
 * environment variables, and known server credentials.
 */
function resolveEndpointApiKey(endpoint) {
    const candidates = getApiKeyCandidates(endpoint);
    return candidates[0] || '';
}
/**
 * Returns prioritized list of candidate API keys for an endpoint.
 */
function getApiKeyCandidates(endpoint) {
    const candidates = [];
    const configKey = (endpoint.apiKey || '').trim();
    const urlLower = (endpoint.baseUrl || '').toLowerCase();
    const nameLower = (endpoint.name || '').toLowerCase();
    const add = (k) => {
        if (k && typeof k === 'string' && k.trim() && !candidates.includes(k.trim())) {
            candidates.push(k.trim());
        }
    };
    // 1. Check Lemonade Server
    if (urlLower.includes(':9000') || urlLower.includes(':13305') || nameLower.includes('lemonade')) {
        add(process.env.LEMONADE_API_KEY);
        add(process.env.LEMONADE_ADMIN_API_KEY);
        if (configKey && configKey !== 'lemonade' && !configKey.startsWith('${')) {
            add(configKey);
        }
        add('local-lemonade');
        add('sk-local-lemonade');
        if (configKey)
            add(configKey);
        add('lemonade');
        return candidates;
    }
    // 2. Check DashScope / Qwen / Alibaba
    if (urlLower.includes('aliyuncs.com') ||
        urlLower.includes('dashscope') ||
        nameLower.includes('dashscope') ||
        nameLower.includes('qwen') ||
        nameLower.includes('alibaba')) {
        if (configKey && !configKey.startsWith('${') && configKey !== 'dummy')
            add(configKey);
        add(process.env.DASHSCOPE_API_KEY);
        add(process.env.QWEN_API_KEY);
        add(process.env.ALIBABA_API_KEY);
        add(process.env.CUSTOM_OAI_API_KEY);
        add(process.env.OPENAI_API_KEY);
        return candidates;
    }
    // 3. Check DeepSeek
    if (urlLower.includes('deepseek') || nameLower.includes('deepseek')) {
        if (configKey && !configKey.startsWith('${') && configKey !== 'dummy')
            add(configKey);
        add(process.env.DEEPSEEK_API_KEY);
        add(process.env.OPENAI_API_KEY);
        return candidates;
    }
    // 4. Check LM Studio
    if (urlLower.includes(':1234') || nameLower.includes('lm studio')) {
        add(process.env.LM_STUDIO_API_KEY);
        if (configKey && !configKey.startsWith('${'))
            add(configKey);
        add('lm-studio');
        return candidates;
    }
    // 5. Check Ollama
    if (urlLower.includes(':11434') || nameLower.includes('ollama')) {
        if (configKey)
            add(configKey);
        add('ollama');
        return candidates;
    }
    // 6. Check OpenAI
    if (urlLower.includes('openai.com') || nameLower.includes('openai')) {
        if (configKey && !configKey.startsWith('${'))
            add(configKey);
        add(process.env.OPENAI_API_KEY);
        add(process.env.CUSTOM_OAI_API_KEY);
        return candidates;
    }
    // 7. General Fallback
    if (configKey && !configKey.startsWith('${'))
        add(configKey);
    add(process.env.OPENAI_API_KEY);
    add(process.env.DASHSCOPE_API_KEY);
    add(process.env.QWEN_API_KEY);
    add(process.env.DEEPSEEK_API_KEY);
    return candidates;
}
//# sourceMappingURL=utils.js.map