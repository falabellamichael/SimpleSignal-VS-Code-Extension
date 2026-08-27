import * as vscode from 'vscode';
import { EndpointConfig } from './types';
import { convertMessagesToOpenAI, convertToolsToOpenAI } from './utils';

export class SimpleSignalChatProvider implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation> {
  private _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  constructor(private context: vscode.ExtensionContext, private outputChannel: vscode.OutputChannel) {
    context.subscriptions.push(this._onDidChange);
  }

  public refresh(): void {
    this._onDidChange.fire();
  }

  public async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);
    const result: vscode.LanguageModelChatInformation[] = [];

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
        const displayName = m.name || `${m.id} (${ep.name})`;
        const family = this.deduceFamily(m.id);

        result.push({
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
        } as any);
      }
    }

    return result;
  }

  public async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const modelId = model.id;
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);

    let targetEndpoint: EndpointConfig | undefined;
    let actualModelId = modelId;

    if (modelId.includes(':::')) {
      const parts = modelId.split(':::');
      const epName = parts[0];
      actualModelId = parts.slice(1).join(':::');
      targetEndpoint = endpoints.find((e) => e.name === epName);
    }

    if (!targetEndpoint) {
      for (const ep of endpoints) {
        const match = (ep.models || []).find((m) => m.id === modelId);
        if (match) {
          targetEndpoint = ep;
          actualModelId = match.id;
          break;
        }
      }
    }

    if (!targetEndpoint && endpoints.length > 0) {
      targetEndpoint = endpoints[0];
    }

    if (!targetEndpoint) {
      throw new Error(`[SimpleSignal] No active endpoint configured for model "${modelId}".`);
    }

    this.outputChannel.appendLine(`[SimpleSignal] Sending request to "${targetEndpoint.name}" for model "${actualModelId}"`);

    const baseUrl = targetEndpoint.baseUrl.replace(/\/$/, '');
    let chatUrl = baseUrl;
    if (!chatUrl.endsWith('/chat/completions')) {
      chatUrl = `${baseUrl}/chat/completions`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'VSCode-SimpleSignal/1.0',
      ...(targetEndpoint.customHeaders || {}),
    };

    if (targetEndpoint.apiKey) {
      headers['Authorization'] = `Bearer ${targetEndpoint.apiKey}`;
    }

    const openAIMessages = convertMessagesToOpenAI(messages);
    const { tools, tool_choice } = convertToolsToOpenAI(options);

    const body: any = {
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
    });

    const response = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.outputChannel.appendLine(`[SimpleSignal] HTTP Error ${response.status}: ${errText}`);
      throw new Error(`SimpleSignal request failed: ${response.status} ${response.statusText} - ${errText}`);
    }

    if (!response.body) {
      throw new Error('[SimpleSignal] Response body is empty.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();
    let inThinkingBlock = false;

    while (!token.isCancellationRequested) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;
        if (line === 'data: [DONE]') break;

        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            const choice = data.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (!delta) continue;

            if (delta.reasoning_content) {
              if (!inThinkingBlock) {
                progress.report(new vscode.LanguageModelTextPart('💭 *Thinking:*\n'));
                inThinkingBlock = true;
              }
              progress.report(new vscode.LanguageModelTextPart(delta.reasoning_content));
            }

            if (delta.content) {
              if (inThinkingBlock && !delta.reasoning_content) {
                progress.report(new vscode.LanguageModelTextPart('\n\n---\n\n'));
                inThinkingBlock = false;
              }
              progress.report(new vscode.LanguageModelTextPart(delta.content));
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
                } else {
                  const existing = pendingToolCalls.get(idx)!;
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                }
              }
            }

            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
              for (const [, tc] of pendingToolCalls) {
                if (tc.name) {
                  let parsedArgs: any = {};
                  try {
                    parsedArgs = JSON.parse(tc.args || '{}');
                  } catch {
                    parsedArgs = { raw: tc.args };
                  }
                  progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, parsedArgs));
                }
              }
              pendingToolCalls.clear();
            }
          } catch {
            // ignore
          }
        }
      }
    }

    for (const [, tc] of pendingToolCalls) {
      if (tc.name) {
        let parsedArgs: any = {};
        try {
          parsedArgs = JSON.parse(tc.args || '{}');
        } catch {
          parsedArgs = { raw: tc.args };
        }
        progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, parsedArgs));
      }
    }
  }

  public async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
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

  private deduceFamily(id: string): string {
    const lower = id.toLowerCase();
    if (lower.includes('qwen')) return 'qwen';
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('gemma')) return 'gemma';
    if (lower.includes('llama')) return 'llama';
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gpt')) return 'gpt';
    if (lower.includes('mistral')) return 'mistral';
    if (lower.includes('lemon')) return 'lemonade';
    return 'custom';
  }
}
