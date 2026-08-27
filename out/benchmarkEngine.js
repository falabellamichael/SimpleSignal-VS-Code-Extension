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
exports.BenchmarkEngine = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
class BenchmarkEngine {
    static PRESETS = [
        {
            id: 'quick_speed',
            name: '🚀 Quick Speed Test (64 Tokens)',
            description: 'Standard prompt to measure raw Time-To-First-Token and peak generation speed.',
            prompt: 'Explain what an event-driven architecture is in 3 concise bullet points.',
            maxTokens: 64,
        },
        {
            id: 'code_gen',
            name: '💻 Luau & Code Synthesis (200 Tokens)',
            description: 'Algorithm and coding prompt to benchmark code completion latency.',
            prompt: 'Write a performant Luau spatial hashing grid class for Roblox with Insert, Remove, and QueryRange methods with type annotations.',
            maxTokens: 200,
        },
        {
            id: 'reasoning_stress',
            name: '🧠 Deep Reasoning & Logic (350 Tokens)',
            description: 'Complex multi-step logic problem to stress test reasoning throughput.',
            prompt: 'Solve step-by-step: If 5 machines take 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets? Then explain the mathematical principle involved.',
            maxTokens: 350,
        },
    ];
    static history = [];
    static getHistory() {
        return [...this.history];
    }
    static addResult(res) {
        this.history.unshift(res);
        if (this.history.length > 50) {
            this.history.pop();
        }
    }
    static clearHistory() {
        this.history = [];
    }
    /**
     * Run benchmark on a specific model against an endpoint.
     */
    static async runBenchmark(endpoint, modelId, presetId = 'quick_speed', customPrompt, customMaxTokens, onProgress) {
        const preset = this.PRESETS.find((p) => p.id === presetId) || this.PRESETS[0];
        const prompt = customPrompt || preset.prompt;
        const maxTokens = customMaxTokens || preset.maxTokens;
        const protocol = endpoint.protocol || 'openai';
        if (protocol === 'ollama') {
            return this.runOllamaBenchmark(endpoint, modelId, preset.name, prompt, maxTokens, onProgress);
        }
        else {
            return this.runOpenAIBenchmark(endpoint, modelId, preset.name, prompt, maxTokens, onProgress);
        }
    }
    /**
     * OpenAI-compatible streaming benchmark.
     */
    static async runOpenAIBenchmark(endpoint, modelId, presetName, prompt, maxTokens, onProgress) {
        const urlStr = `${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        const targetUrl = new URL(urlStr);
        const isHttps = targetUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const payload = JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            temperature: 0.1,
            stream: true,
        });
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload).toString(),
            ...(endpoint.customHeaders || {}),
        };
        if (endpoint.apiKey) {
            headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
        }
        const startTime = Date.now();
        let firstTokenTime = 0;
        let tokensGenerated = 0;
        let outputText = '';
        let promptTokens = 0;
        return new Promise((resolve) => {
            const req = client.request(targetUrl, {
                method: 'POST',
                headers,
                timeout: 45000,
            }, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    let errBody = '';
                    res.on('data', (c) => (errBody += c));
                    res.on('end', () => {
                        const resObj = {
                            modelId,
                            endpointName: endpoint.name,
                            protocol: endpoint.protocol || 'openai',
                            presetName,
                            prompt,
                            outputPreview: '',
                            tokensGenerated: 0,
                            ttftMs: 0,
                            generationDurationMs: 0,
                            totalDurationMs: Date.now() - startTime,
                            tokensPerSec: 0,
                            status: 'error',
                            errorMessage: `HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`,
                            timestamp: Date.now(),
                        };
                        this.addResult(resObj);
                        resolve(resObj);
                    });
                    return;
                }
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString('utf-8');
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data:'))
                            continue;
                        const data = trimmed.slice(5).trim();
                        if (data === '[DONE]')
                            continue;
                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta;
                            const content = delta?.content || delta?.reasoning_content || '';
                            if (parsed.usage) {
                                if (parsed.usage.completion_tokens)
                                    tokensGenerated = parsed.usage.completion_tokens;
                                if (parsed.usage.prompt_tokens)
                                    promptTokens = parsed.usage.prompt_tokens;
                            }
                            if (content) {
                                if (!firstTokenTime) {
                                    firstTokenTime = Date.now();
                                }
                                outputText += content;
                                // Approximate token count if usage wasn't emitted per chunk
                                const estimatedChunkTokens = Math.max(1, Math.ceil(content.length / 3.8));
                                tokensGenerated += estimatedChunkTokens;
                                const now = Date.now();
                                const elapsedGenSec = Math.max(0.001, (now - firstTokenTime) / 1000);
                                const currentTPS = parseFloat((tokensGenerated / elapsedGenSec).toFixed(1));
                                if (onProgress) {
                                    onProgress(content, tokensGenerated, currentTPS);
                                }
                            }
                        }
                        catch {
                            // Ignore parse errors on individual stream chunks
                        }
                    }
                });
                res.on('end', () => {
                    const endTime = Date.now();
                    const ttftMs = firstTokenTime ? firstTokenTime - startTime : endTime - startTime;
                    const generationDurationMs = firstTokenTime ? endTime - firstTokenTime : endTime - startTime;
                    const genSeconds = Math.max(0.001, generationDurationMs / 1000);
                    // Refine token count based on final text if usage was absent
                    if (tokensGenerated === 0 && outputText) {
                        tokensGenerated = Math.max(1, Math.ceil(outputText.length / 3.8));
                    }
                    const tokensPerSec = parseFloat((tokensGenerated / genSeconds).toFixed(1));
                    const result = {
                        modelId,
                        endpointName: endpoint.name,
                        protocol: endpoint.protocol || 'openai',
                        presetName,
                        prompt,
                        outputPreview: outputText.trim().slice(0, 300),
                        tokensGenerated,
                        promptTokens: promptTokens || Math.ceil(prompt.length / 4),
                        ttftMs,
                        generationDurationMs,
                        totalDurationMs: endTime - startTime,
                        tokensPerSec,
                        status: 'success',
                        timestamp: Date.now(),
                    };
                    this.addResult(result);
                    resolve(result);
                });
            });
            req.on('error', (err) => {
                const result = {
                    modelId,
                    endpointName: endpoint.name,
                    protocol: endpoint.protocol || 'openai',
                    presetName,
                    prompt,
                    outputPreview: '',
                    tokensGenerated: 0,
                    ttftMs: 0,
                    generationDurationMs: 0,
                    totalDurationMs: Date.now() - startTime,
                    tokensPerSec: 0,
                    status: 'error',
                    errorMessage: err.message || 'Network request failed',
                    timestamp: Date.now(),
                };
                this.addResult(result);
                resolve(result);
            });
            req.on('timeout', () => {
                req.destroy();
                const result = {
                    modelId,
                    endpointName: endpoint.name,
                    protocol: endpoint.protocol || 'openai',
                    presetName,
                    prompt,
                    outputPreview: outputText.slice(0, 200),
                    tokensGenerated,
                    ttftMs: firstTokenTime ? firstTokenTime - startTime : 45000,
                    generationDurationMs: firstTokenTime ? Date.now() - firstTokenTime : 0,
                    totalDurationMs: 45000,
                    tokensPerSec: 0,
                    status: 'error',
                    errorMessage: 'Request timed out after 45s',
                    timestamp: Date.now(),
                };
                this.addResult(result);
                resolve(result);
            });
            req.write(payload);
            req.end();
        });
    }
    /**
     * Ollama native streaming benchmark (/api/generate).
     */
    static async runOllamaBenchmark(endpoint, modelId, presetName, prompt, maxTokens, onProgress) {
        const urlStr = `${endpoint.baseUrl.replace(/\/+$/, '')}/api/generate`;
        const targetUrl = new URL(urlStr);
        const client = targetUrl.protocol === 'https:' ? https : http;
        const payload = JSON.stringify({
            model: modelId,
            prompt,
            options: {
                num_predict: maxTokens,
                temperature: 0.1,
            },
            stream: true,
        });
        const startTime = Date.now();
        let firstTokenTime = 0;
        let tokensGenerated = 0;
        let outputText = '';
        let ollamaEvalCount = 0;
        let ollamaEvalDurationNs = 0;
        return new Promise((resolve) => {
            const req = client.request(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload).toString(),
                },
                timeout: 45000,
            }, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString('utf-8');
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed)
                            continue;
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (parsed.response) {
                                if (!firstTokenTime)
                                    firstTokenTime = Date.now();
                                outputText += parsed.response;
                                tokensGenerated++;
                                const now = Date.now();
                                const elapsedGenSec = Math.max(0.001, (now - firstTokenTime) / 1000);
                                const currentTPS = parseFloat((tokensGenerated / elapsedGenSec).toFixed(1));
                                if (onProgress) {
                                    onProgress(parsed.response, tokensGenerated, currentTPS);
                                }
                            }
                            if (parsed.done) {
                                if (parsed.eval_count)
                                    ollamaEvalCount = parsed.eval_count;
                                if (parsed.eval_duration)
                                    ollamaEvalDurationNs = parsed.eval_duration;
                            }
                        }
                        catch { }
                    }
                });
                res.on('end', () => {
                    const endTime = Date.now();
                    const ttftMs = firstTokenTime ? firstTokenTime - startTime : endTime - startTime;
                    const generationDurationMs = firstTokenTime ? endTime - firstTokenTime : endTime - startTime;
                    let tokensPerSec = 0;
                    if (ollamaEvalCount && ollamaEvalDurationNs) {
                        tokensGenerated = ollamaEvalCount;
                        tokensPerSec = parseFloat((ollamaEvalCount / (ollamaEvalDurationNs / 1e9)).toFixed(1));
                    }
                    else {
                        const genSeconds = Math.max(0.001, generationDurationMs / 1000);
                        tokensPerSec = parseFloat((tokensGenerated / genSeconds).toFixed(1));
                    }
                    const result = {
                        modelId,
                        endpointName: endpoint.name,
                        protocol: 'ollama',
                        presetName,
                        prompt,
                        outputPreview: outputText.trim().slice(0, 300),
                        tokensGenerated,
                        ttftMs,
                        generationDurationMs,
                        totalDurationMs: endTime - startTime,
                        tokensPerSec,
                        status: 'success',
                        timestamp: Date.now(),
                    };
                    this.addResult(result);
                    resolve(result);
                });
            });
            req.on('error', (err) => {
                const result = {
                    modelId,
                    endpointName: endpoint.name,
                    protocol: 'ollama',
                    presetName,
                    prompt,
                    outputPreview: '',
                    tokensGenerated: 0,
                    ttftMs: 0,
                    generationDurationMs: 0,
                    totalDurationMs: Date.now() - startTime,
                    tokensPerSec: 0,
                    status: 'error',
                    errorMessage: err.message || 'Ollama connection failed',
                    timestamp: Date.now(),
                };
                this.addResult(result);
                resolve(result);
            });
            req.write(payload);
            req.end();
        });
    }
}
exports.BenchmarkEngine = BenchmarkEngine;
//# sourceMappingURL=benchmarkEngine.js.map