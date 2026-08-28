import * as vscode from 'vscode';
import { EndpointConfig } from './types';
import { SimpleSignalDashboard } from './dashboard';
import { SimpleSignalTreeDataProvider } from './treeProvider';
import { SimpleSignalChatProvider } from './provider';
import { normalizeBaseUrl, resolveEndpointApiKey, getApiKeyCandidates } from './utils';
import { ModelTelemetryTracker } from './telemetryTracker';

export class SimpleSignalChatParticipant {
  public static register(
    context: vscode.ExtensionContext,
    provider: SimpleSignalChatProvider,
    treeDataProvider: SimpleSignalTreeDataProvider,
    statusBarItem: vscode.StatusBarItem,
    outputChannel: vscode.OutputChannel
  ): vscode.ChatParticipant {
    const handler: vscode.ChatRequestHandler = async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const config = vscode.workspace.getConfiguration('simplesignal');
      const endpoints = config.get<EndpointConfig[]>('endpoints', []);
      const defaultModelSetting = config.get<string>('defaultModel', '');

      // 1. Handle "/models" command
      if (request.command === 'models') {
        stream.markdown('## 📡 SimpleSignal Model Directory\n\n');
        let total = 0;

        for (const ep of endpoints) {
          if (ep.enabled === false) continue;
          const models = ep.models || [];
          if (models.length === 0) continue;
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

        let matchedEp: EndpointConfig | undefined;
        let matchedModel: string | undefined;

        for (const ep of endpoints) {
          if (ep.enabled === false) continue;
          for (const m of ep.models || []) {
            if (m.id.toLowerCase() === query || m.id.toLowerCase().includes(query)) {
              matchedEp = ep;
              matchedModel = m.id;
              break;
            }
          }
          if (matchedModel) break;
        }

        if (!matchedModel && query) {
          for (const ep of endpoints) {
            if (ep.enabled === false) continue;
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
          } catch {}

          SimpleSignalDashboard.selectedModel = { endpointName: matchedEp.name, modelId: matchedModel };
          SimpleSignalDashboard.onModelSelectionChanged?.(matchedEp.name, matchedModel);
          treeDataProvider.setSelectedModel(matchedEp.name, matchedModel);
          provider.refresh();
          if (statusBarItem) {
            statusBarItem.text = `$(radio-tower) SimpleSignal: ${matchedModel}`;
            statusBarItem.show();
          }

          stream.markdown(`> ### ⚡ SimpleSignal Route Updated\n>\n> - **Active Model:** \`${matchedModel}\`\n> - **Provider Engine:** \`${matchedEp.name}\`\n> - **Status:** 🟢 Connected & Ready\n>\n> _All prompt requests will now execute against this model._\n`);
        } else {
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
        } else if (SimpleSignalDashboard.selectedModel) {
          activeEpName = SimpleSignalDashboard.selectedModel.endpointName;
          activeModelId = SimpleSignalDashboard.selectedModel.modelId;
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
      let targetEndpoint: EndpointConfig | undefined;
      let actualModelId = '';

      if (defaultModelSetting && defaultModelSetting.includes(':::')) {
        const parts = defaultModelSetting.split(':::');
        targetEndpoint = endpoints.find((e) => e.name.toLowerCase() === parts[0].toLowerCase());
        actualModelId = parts.slice(1).join(':::');
      } else if (SimpleSignalDashboard.selectedModel) {
        targetEndpoint = endpoints.find((e) => e.name.toLowerCase() === SimpleSignalDashboard.selectedModel!.endpointName.toLowerCase());
        actualModelId = SimpleSignalDashboard.selectedModel.modelId;
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
      const stats = ModelTelemetryTracker.startMessage({
        modelId: actualModelId,
        modelName: actualModelId,
        endpointName: targetEndpoint.name,
        protocol: targetEndpoint.protocol || 'openai',
        source: 'vscode-chat',
        promptPreview: request.prompt.slice(0, 1500),
        promptTokens: estimatedPromptTokens,
      });

      const baseUrl = normalizeBaseUrl(targetEndpoint.baseUrl);
      let chatUrl = baseUrl;
      if (!chatUrl.endsWith('/chat/completions')) {
        chatUrl = `${baseUrl}/chat/completions`;
      }

      // Build conversation history from chat context
      const messages: { role: string; content: string }[] = [];
      for (const turn of chatContext.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
          messages.push({ role: 'user', content: turn.prompt });
        } else if (turn instanceof vscode.ChatResponseTurn) {
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

      const candidateKeys = getApiKeyCandidates(targetEndpoint);
      if (candidateKeys.length === 0) candidateKeys.push('');

      let fullCompletion = '';
      let completionTokens = 0;
      let isSuccess = false;
      let inThinkingBlock = false;

      for (const apiKey of candidateKeys) {
        try {
          const headers: Record<string, string> = {
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

          const reader = (res.body as any).getReader();
          const decoder = new TextDecoder();
          const openThinkingTag = '<details open>\n<summary>🧠 <b>Thought Process</b></summary>\n\n> ';
          const closeThinkingTag = '\n\n</details>\n\n';
          let buffer = '';

          while (true) {
            if (token.isCancellationRequested) {
              reader.cancel();
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(dataStr);
                const choice = parsed.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;
                if (!delta) continue;

                if (delta.reasoning_content) {
                  if (!inThinkingBlock) {
                    stream.markdown(openThinkingTag);
                    inThinkingBlock = true;
                  }
                  const formatted = delta.reasoning_content.replace(/\n/g, '\n> ');
                  stream.markdown(formatted);
                  ModelTelemetryTracker.updateChunk(stats.id, delta.reasoning_content, true);
                }

                let content = delta.content || choice.text || '';
                if (content) {
                  if (inThinkingBlock && !delta.reasoning_content) {
                    stream.markdown(closeThinkingTag);
                    inThinkingBlock = false;
                  }

                  if (content.includes('<think>')) {
                    inThinkingBlock = true;
                    content = content.replace(/<think>/g, openThinkingTag);
                  }
                  if (content.includes('</think>')) {
                    inThinkingBlock = false;
                    content = content.replace(/<\/think>/g, closeThinkingTag);
                  } else if (inThinkingBlock) {
                    content = content.replace(/\n/g, '\n> ');
                  }

                  fullCompletion += content;
                  completionTokens += Math.max(1, Math.ceil(content.length / 3.8));
                  stream.markdown(content);
                  ModelTelemetryTracker.updateChunk(stats.id, content, false);
                }
              } catch {}
            }
          }

          if (inThinkingBlock) {
            stream.markdown(closeThinkingTag);
            inThinkingBlock = false;
          }

          isSuccess = true;
          break;
        } catch (err: any) {
          if (apiKey === candidateKeys[candidateKeys.length - 1]) {
            stream.markdown(`\n\n> ❌ **Error from ${targetEndpoint.name}:** ${err.message || err}\n`);
            ModelTelemetryTracker.failMessage(stats.id, err.message || String(err));
            return;
          }
        }
      }

      if (isSuccess) {
        const finalStats = ModelTelemetryTracker.completeMessage(stats.id);
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
