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
