import * as http from 'http';
import * as https from 'https';
import { EndpointConfig, BenchmarkPreset, BenchmarkResult } from './types';
import { ModelTelemetryTracker } from './telemetryTracker';
import { resolveEndpointApiKey } from './utils';

export class BenchmarkEngine {
  public static readonly PRESETS: BenchmarkPreset[] = [
    {
      id: 'quick_speed',
      name: '🚀 Quick Speed Test (64 Tokens)',
      description: 'Standard prompt to measure raw Time-To-First-Token and peak generation speed.',
      prompt: 'Explain what an event-driven architecture is in 3 concise bullet points.',
      maxTokens: 64,
    },
    {
      id: 'code_gen',
      name: '🎮 Lua 200-Line Sudoku Game (900 Tokens)',
      description: 'Instructs the model to write a full ~200-line Sudoku game in Lua with generator, backtracking solver, validator, and game loop.',
      prompt: 'Write a complete, playable 200-line Sudoku game in pure Lua (or Luau). Output pure code immediately with no thinking or explanation. Include: 1. A 9x9 board representation with grid printing and ASCII formatting. 2. A recursive backtracking Sudoku solver to validate solutions and solve boards. 3. A puzzle generator with difficulty levels that removes numbers while ensuring a unique solution. 4. Input validation (check row, column, and 3x3 subgrid constraints). 5. An interactive game loop allowing the player to place numbers, check errors, and ask for hints. Include helpful comments and structure it cleanly so it reaches approximately 200 lines of robust code.',
      maxTokens: 900,
    },
    {
      id: 'reasoning_stress',
      name: '🧠 Complex Algorithm & Logic (400 Tokens)',
      description: 'Complex graph search and algorithm prompt measuring pure synthesis throughput without thinking overhead.',
      prompt: 'Implement a high-performance A* Pathfinding Algorithm with a Min-Heap Priority Queue in pure Lua. Include distance heuristics, neighbor traversal, and optimal path reconstruction. Output direct code immediately.',
      maxTokens: 400,
    },
  ];

  private static history: BenchmarkResult[] = [];

  public static getHistory(): BenchmarkResult[] {
    return [...this.history];
  }

  public static addResult(res: BenchmarkResult): void {
    this.history.unshift(res);
    if (this.history.length > 50) {
      this.history.pop();
    }
  }

  public static clearHistory(): void {
    this.history = [];
  }

  /**
   * Run benchmark on a specific model against an endpoint.
   */
  public static async runBenchmark(
    endpoint: EndpointConfig,
    modelId: string,
    presetId: string = 'quick_speed',
    customPrompt?: string,
    customMaxTokens?: number,
    onProgress?: (chunk: string, currentTokens: number, currentTPS: number) => void
  ): Promise<BenchmarkResult> {
    const preset = this.PRESETS.find((p) => p.id === presetId) || this.PRESETS[0];
    const prompt = customPrompt || preset.prompt;
    const maxTokens = customMaxTokens || preset.maxTokens;

    const protocol = endpoint.protocol || 'openai';

    const telemetrySession = ModelTelemetryTracker.startMessage({
      modelId,
      modelName: modelId,
      endpointName: endpoint.name,
      protocol: protocol,
      source: 'benchmark',
      promptPreview: prompt.slice(0, 1000),
      promptTokens: Math.max(1, Math.ceil(prompt.length / 3.8)),
    });

    const wrappedProgress = (chunk: string, currentTokens: number, currentTPS: number) => {
      ModelTelemetryTracker.updateChunk(telemetrySession.id, chunk, false);
      if (onProgress) {
        onProgress(chunk, currentTokens, currentTPS);
      }
    };

    try {
      let result: BenchmarkResult;
      if (protocol === 'ollama') {
        result = await this.runOllamaBenchmark(endpoint, modelId, preset.name, prompt, maxTokens, wrappedProgress);
      } else {
        result = await this.runOpenAIBenchmark(endpoint, modelId, preset.name, prompt, maxTokens, wrappedProgress);
      }

      if (result.status === 'success') {
        ModelTelemetryTracker.completeMessage(telemetrySession.id, {
          tokensGenerated: result.tokensGenerated,
          tokensPerSec: result.tokensPerSec,
          ttftMs: result.ttftMs,
          totalDurationMs: result.totalDurationMs,
          outputPreview: result.outputPreview,
        });
      } else {
        ModelTelemetryTracker.failMessage(telemetrySession.id, result.errorMessage || 'Benchmark failed');
      }

      return result;
    } catch (err: any) {
      ModelTelemetryTracker.failMessage(telemetrySession.id, err.message || String(err));
      throw err;
    }
  }

  /**
   * OpenAI-compatible streaming benchmark with reasoning/thinking disabled.
   */
  private static async runOpenAIBenchmark(
    endpoint: EndpointConfig,
    modelId: string,
    presetName: string,
    prompt: string,
    maxTokens: number,
    onProgress?: (chunk: string, currentTokens: number, currentTPS: number) => void
  ): Promise<BenchmarkResult> {
    const urlStr = `${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const targetUrl = new URL(urlStr);
    const isHttps = targetUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = JSON.stringify({
      model: modelId,
      messages: [
        {
          role: 'system',
          content: 'You are a fast benchmark test runner. Output direct code/answers immediately with ZERO internal thoughts, reasoning tokens, or <think> tags. Do not explain your thought process.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
      stream: true,
      enable_thinking: false, // DashScope Qwen / QwQ
      thinking: { type: 'disabled' }, // Anthropic / OpenRouter
      reasoning_effort: 'none', // OpenAI o-series / DeepSeek
      chat_template_kwargs: { enable_thinking: false },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
      ...(endpoint.customHeaders || {}),
    };

    const apiKey = resolveEndpointApiKey(endpoint);
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const startTime = Date.now();
    let firstTokenTime = 0;
    let tokensGenerated = 0;
    let outputText = '';
    let promptTokens = 0;
    let isInsideThinkTag = false;

    return new Promise<BenchmarkResult>((resolve) => {
      const req = client.request(
        targetUrl,
        {
          method: 'POST',
          headers,
          timeout: 45000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errBody = '';
            res.on('data', (c) => (errBody += c));
            res.on('end', () => {
              const resObj: BenchmarkResult = {
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

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                // Exclude reasoning_content completely
                let content = delta?.content || '';

                if (parsed.usage) {
                  if (parsed.usage.completion_tokens) tokensGenerated = parsed.usage.completion_tokens;
                  if (parsed.usage.prompt_tokens) promptTokens = parsed.usage.prompt_tokens;
                }

                // Filter out any raw <think> tags if emitted by model
                if (content.includes('<think>')) {
                  isInsideThinkTag = true;
                  content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
                  if (content.includes('<think>')) {
                    content = content.replace(/<think>[\s\S]*/g, '');
                  }
                } else if (isInsideThinkTag) {
                  if (content.includes('</think>')) {
                    isInsideThinkTag = false;
                    content = content.replace(/[\s\S]*?<\/think>/g, '');
                  } else {
                    content = ''; // Suppress thought chunks
                  }
                }

                if (content) {
                  if (!firstTokenTime) {
                    firstTokenTime = Date.now();
                  }
                  outputText += content;
                  const estimatedChunkTokens = Math.max(1, Math.ceil(content.length / 3.8));
                  tokensGenerated += estimatedChunkTokens;

                  const now = Date.now();
                  const elapsedGenSec = Math.max(0.001, (now - firstTokenTime) / 1000);
                  const currentTPS = parseFloat((tokensGenerated / elapsedGenSec).toFixed(1));

                  if (onProgress) {
                    onProgress(content, tokensGenerated, currentTPS);
                  }
                }
              } catch {
                // Ignore parse errors on individual stream chunks
              }
            }
          });

          res.on('end', () => {
            const endTime = Date.now();
            const ttftMs = firstTokenTime ? firstTokenTime - startTime : endTime - startTime;
            const generationDurationMs = firstTokenTime ? endTime - firstTokenTime : endTime - startTime;
            const genSeconds = Math.max(0.001, generationDurationMs / 1000);

            if (tokensGenerated === 0 && outputText) {
              tokensGenerated = Math.max(1, Math.ceil(outputText.length / 3.8));
            }

            const tokensPerSec = parseFloat((tokensGenerated / genSeconds).toFixed(1));

            const result: BenchmarkResult = {
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
        }
      );

      req.on('error', (err) => {
        const result: BenchmarkResult = {
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
        const result: BenchmarkResult = {
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
   * Ollama native streaming benchmark without thinking overhead.
   */
  private static async runOllamaBenchmark(
    endpoint: EndpointConfig,
    modelId: string,
    presetName: string,
    prompt: string,
    maxTokens: number,
    onProgress?: (chunk: string, currentTokens: number, currentTPS: number) => void
  ): Promise<BenchmarkResult> {
    const urlStr = `${endpoint.baseUrl.replace(/\/+$/, '')}/api/generate`;
    const targetUrl = new URL(urlStr);
    const client = targetUrl.protocol === 'https:' ? https : http;

    const payload = JSON.stringify({
      model: modelId,
      prompt,
      system: 'You are a fast benchmark test runner. Output direct code/response only. Do NOT output thinking, reasoning traces, or <think> tags.',
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
    let isInsideThinkTag = false;

    return new Promise<BenchmarkResult>((resolve) => {
      const req = client.request(
        targetUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload).toString(),
          },
          timeout: 45000,
        },
        (res) => {
          let buffer = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const parsed = JSON.parse(trimmed);
                let responseText = parsed.response || '';

                if (responseText) {
                  // Filter out think tags
                  if (responseText.includes('<think>')) {
                    isInsideThinkTag = true;
                    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '');
                    if (responseText.includes('<think>')) {
                      responseText = responseText.replace(/<think>[\s\S]*/g, '');
                    }
                  } else if (isInsideThinkTag) {
                    if (responseText.includes('</think>')) {
                      isInsideThinkTag = false;
                      responseText = responseText.replace(/[\s\S]*?<\/think>/g, '');
                    } else {
                      responseText = '';
                    }
                  }

                  if (responseText) {
                    if (!firstTokenTime) firstTokenTime = Date.now();
                    outputText += responseText;
                    tokensGenerated++;

                    const now = Date.now();
                    const elapsedGenSec = Math.max(0.001, (now - firstTokenTime) / 1000);
                    const currentTPS = parseFloat((tokensGenerated / elapsedGenSec).toFixed(1));

                    if (onProgress) {
                      onProgress(responseText, tokensGenerated, currentTPS);
                    }
                  }
                }

                if (parsed.done) {
                  if (parsed.eval_count) ollamaEvalCount = parsed.eval_count;
                  if (parsed.eval_duration) ollamaEvalDurationNs = parsed.eval_duration;
                }
              } catch {}
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
            } else {
              const genSeconds = Math.max(0.001, generationDurationMs / 1000);
              tokensPerSec = parseFloat((tokensGenerated / genSeconds).toFixed(1));
            }

            const result: BenchmarkResult = {
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
        }
      );

      req.on('error', (err) => {
        const result: BenchmarkResult = {
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
