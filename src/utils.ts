import * as vscode from 'vscode';

/**
 * Converts VS Code chat messages to OpenAI-compatible messages format.
 */
export function convertMessagesToOpenAI(messages: readonly (vscode.LanguageModelChatRequestMessage | any)[]): any[] {
  const out: any[] = [];

  for (const m of messages) {
    const role = mapRole(m.role);
    const textParts: string[] = [];
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    for (const part of m.content ?? []) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        const id = part.callId || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let args = '{}';
        try {
          args = typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {});
        } catch {
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
      } else if (isToolResultPart(part)) {
        const callId = (part as any).callId ?? '';
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

export function convertToolsToOpenAI(options: vscode.ProvideLanguageModelChatResponseOptions | any): {
  tools?: any[];
  tool_choice?: any;
} {
  const tools = (options.tools ?? []) as vscode.LanguageModelChatTool[];
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

  let tool_choice: any = 'auto';
  if (options.toolMode === vscode.LanguageModelChatToolMode.Required && tools.length === 1) {
    tool_choice = { type: 'function', function: { name: tools[0].name } };
  }

  return { tools: toolDefs, tool_choice };
}

function mapRole(role: vscode.LanguageModelChatMessageRole | number): string {
  if (role === vscode.LanguageModelChatMessageRole.User) {
    return 'user';
  }
  if (role === vscode.LanguageModelChatMessageRole.Assistant) {
    return 'assistant';
  }
  return 'system';
}

function isToolResultPart(part: any): boolean {
  return part && typeof part === 'object' && 'callId' in part && 'content' in part;
}

function collectToolResultText(part: any): string {
  let text = '';
  for (const c of part.content ?? []) {
    if (c instanceof vscode.LanguageModelTextPart) {
      text += c.value;
    } else if (typeof c === 'string') {
      text += c;
    } else {
      try {
        text += JSON.stringify(c);
      } catch {
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
export function resolveEndpointApiKey(endpoint: any): string {
  const candidates = getApiKeyCandidates(endpoint);
  return candidates[0] || '';
}

/**
 * Returns prioritized list of candidate API keys for an endpoint.
 */
export function getApiKeyCandidates(endpoint: any): string[] {
  const candidates: string[] = [];
  const configKey = (endpoint.apiKey || '').trim();
  const urlLower = (endpoint.baseUrl || '').toLowerCase();
  const nameLower = (endpoint.name || '').toLowerCase();

  const add = (k?: string) => {
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
    if (configKey) add(configKey);
    add('lemonade');
    return candidates;
  }

  // 2. Check DashScope / Qwen / Alibaba
  if (
    urlLower.includes('aliyuncs.com') ||
    urlLower.includes('dashscope') ||
    nameLower.includes('dashscope') ||
    nameLower.includes('qwen') ||
    nameLower.includes('alibaba')
  ) {
    if (configKey && !configKey.startsWith('${') && configKey !== 'dummy') add(configKey);
    add(process.env.DASHSCOPE_API_KEY);
    add(process.env.QWEN_API_KEY);
    add(process.env.ALIBABA_API_KEY);
    add(process.env.CUSTOM_OAI_API_KEY);
    add(process.env.OPENAI_API_KEY);
    return candidates;
  }

  // 3. Check DeepSeek
  if (urlLower.includes('deepseek') || nameLower.includes('deepseek')) {
    if (configKey && !configKey.startsWith('${') && configKey !== 'dummy') add(configKey);
    add(process.env.DEEPSEEK_API_KEY);
    add(process.env.OPENAI_API_KEY);
    return candidates;
  }

  // 4. Check LM Studio
  if (urlLower.includes(':1234') || nameLower.includes('lm studio')) {
    add(process.env.LM_STUDIO_API_KEY);
    if (configKey && !configKey.startsWith('${')) add(configKey);
    add('lm-studio');
    return candidates;
  }

  // 5. Check Ollama
  if (urlLower.includes(':11434') || nameLower.includes('ollama')) {
    if (configKey) add(configKey);
    add('ollama');
    return candidates;
  }

  // 6. Check OpenAI
  if (urlLower.includes('openai.com') || nameLower.includes('openai')) {
    if (configKey && !configKey.startsWith('${')) add(configKey);
    add(process.env.OPENAI_API_KEY);
    add(process.env.CUSTOM_OAI_API_KEY);
    return candidates;
  }

  // 7. General Fallback
  if (configKey && !configKey.startsWith('${')) add(configKey);
  add(process.env.OPENAI_API_KEY);
  add(process.env.DASHSCOPE_API_KEY);
  add(process.env.QWEN_API_KEY);
  add(process.env.DEEPSEEK_API_KEY);

  return candidates;
}
