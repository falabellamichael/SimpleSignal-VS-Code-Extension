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
        stream.markdown('### 📡 SimpleSignal Available Models\n\n');
        let total = 0;
        for (const ep of endpoints) {
          if (ep.enabled === false) continue;
          const models = ep.models || [];
          if (models.length === 0) continue;
          total += models.length;

          stream.markdown(`**${ep.name}** (\`${ep.baseUrl}\`):\n`);
          for (const m of models) {
            const isSel = defaultModelSetting && defaultModelSetting.toLowerCase() === `${ep.name}:::${m.id}`.toLowerCase();
            const activeTag = isSel ? ' ✨ **[ACTIVE]**' : '';
            stream.markdown(`- \`${m.id}\`${activeTag} — [Switch to this model](command:simplesignal.selectModel?${encodeURIComponent(JSON.stringify({ endpointName: ep.name, model: { id: m.id } }))})\n`);
          }
          stream.markdown('\n');
        }

        if (total === 0) {
          stream.markdown('_No models configured yet. Run Auto-Fetch from the Visual Hub._\n');
        }
        return;
      }

      // 2. Handle "/switch" or "/use" command
      if (request.command === 'switch') {
        const query = request.prompt.trim().toLowerCase();
        if (!query) {
          stream.markdown('ℹ️ **Usage:** `@simplesignal /switch <model_name_or_keyword>` (e.g. `/switch deepseek` or `/switch qwen`)\n');
          return;
        }

        let matchedEp: EndpointConfig | undefined;
        let matchedModel: string | undefined;

        // Search through all endpoints and models
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
          // Check by endpoint name
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

          stream.markdown(`✨ **Active Model Switched!**\n\n- **Model:** \`${matchedModel}\`\n- **Provider:** \`${matchedEp.name}\`\n- **Route:** \`${compKey}\`\n\n_All subsequent queries will execute directly against this model._\n`);
        } else {
          stream.markdown(`❌ No model matching \`${query}\` found. Type \`@simplesignal /models\` to view all available options.\n`);
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
        stream.markdown(`### ⚡ SimpleSignal Status\n\n- **Active Model:** \`${activeModelId}\`\n- **Active Provider:** \`${activeEpName}\`\n- **Total Available Models:** ${totalModels} across ${endpoints.length} endpoints\n- **Memory Tracker:** Live telemetry tracking enabled\n`);
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
        stream.markdown('⚠️ **No active model selected.** Please open the Visual Hub (`SimpleSignal: Open Visual Hub Dashboard`) or type `@simplesignal /models` to pick a model.\n');
        return;
      }

      outputChannel.appendLine(`[SimpleSignal Chat] Dispatching query to "${targetEndpoint.name}" for model "${actualModelId}"`);

      // Header indicator in chat stream
      stream.markdown(`⚡ *[${targetEndpoint.name} • ${actualModelId}]*\n\n`);

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
                const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || '';
                if (delta) {
                  fullCompletion += delta;
                  completionTokens += Math.max(1, Math.ceil(delta.length / 3.8));
                  stream.markdown(delta);
                  ModelTelemetryTracker.updateChunk(stats.id, delta, false);
                }
              } catch {}
            }
          }

          isSuccess = true;
          break;
        } catch (err: any) {
          if (apiKey === candidateKeys[candidateKeys.length - 1]) {
            stream.markdown(`\n\n❌ **Error from ${targetEndpoint.name}:** ${err.message || err}\n`);
            ModelTelemetryTracker.failMessage(stats.id, err.message || String(err));
            return;
          }
        }
      }

      if (isSuccess) {
        const finalStats = ModelTelemetryTracker.completeMessage(stats.id);
        if (finalStats) {
          outputChannel.appendLine(`[SimpleSignal Chat] Completed ${actualModelId} in ${finalStats.totalDurationMs}ms (${finalStats.tokensPerSec.toFixed(1)} tok/s)`);
        }
      }
    };

    const participant = vscode.chat.createChatParticipant('simplesignal.participant', handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.svg');
    return participant;
  }
}
