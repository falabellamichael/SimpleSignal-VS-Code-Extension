import * as vscode from 'vscode';
import { SimpleSignalChatProvider } from './provider';
import { ModelFetcher } from './modelFetcher';
import { SimpleSignalTreeDataProvider } from './treeProvider';
import { SimpleSignalDashboard } from './dashboard';
import { SystemDiagnostics } from './systemDiagnostics';
import { EndpointConfig, ProcessMemoryInfo } from './types';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('SimpleSignal');
  outputChannel.appendLine('[SimpleSignal] SimpleSignal Universal Model Provider activating...');

  const provider = new SimpleSignalChatProvider(context, outputChannel);

  // Register provider under vendor "simplesignal"
  const registration = vscode.lm.registerLanguageModelChatProvider('simplesignal', provider);
  context.subscriptions.push(registration);

  // Register TreeDataProvider for Sidebar
  const treeDataProvider = new SimpleSignalTreeDataProvider();
  const treeView = vscode.window.createTreeView('simplesignalExplorer', {
    treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Register StatusBar Item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'simplesignal.manageEndpoints';
  statusBarItem.tooltip = 'SimpleSignal: Click to manage AI models & endpoints';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(statusBarItem);

  // Auto-fetch command
  const autoFetchCmd = vscode.commands.registerCommand('simplesignal.autoFetchModels', async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'SimpleSignal: Auto-fetching models from endpoints...',
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: 'Connecting to endpoints...' });
          const result = await ModelFetcher.autoFetchAllAndUpdateJSON(outputChannel);
          provider.refresh();
          treeDataProvider.refresh();
          updateStatusBar(statusBarItem);
          vscode.window.showInformationMessage(
            `⚡ SimpleSignal: Successfully fetched ${result.totalModels} model(s) across ${result.totalEndpoints} endpoint(s)! Models are active in VS Code Chat.`
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`SimpleSignal Auto-Fetch failed: ${err.message || err}`);
        }
      }
    );
  });
  context.subscriptions.push(autoFetchCmd);

  // Dashboard command
  const dashboardCmd = vscode.commands.registerCommand('simplesignal.openDashboard', () => {
    SimpleSignalDashboard.createOrShow(context.extensionUri);
  });
  context.subscriptions.push(dashboardCmd);

  // ==================== VRAM DIAGNOSTICS COMMAND ====================
  const checkVramCmd = vscode.commands.registerCommand('simplesignal.checkVRAM', async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '⚡ SimpleSignal: Querying GPU VRAM & model memory...',
        cancellable: false,
      },
      async () => {
        try {
          const vram = await SystemDiagnostics.getVRAMDiagnostics();
          outputChannel.show(true);
          outputChannel.appendLine(`\n==================================================`);
          outputChannel.appendLine(`⚡ SimpleSignal VRAM & GPU Diagnostics`);
          outputChannel.appendLine(`GPU: ${vram.gpuName}`);
          outputChannel.appendLine(`Dedicated VRAM Used: ${vram.usedVRAM_MB.toLocaleString()} MB`);
          outputChannel.appendLine(`--------------------------------------------------`);
          if (vram.aiProcesses.length > 0) {
            outputChannel.appendLine(`🤖 Active AI Model Runtimes (${vram.aiProcesses.length}):`);
            for (const ap of vram.aiProcesses) {
              outputChannel.appendLine(`  • PID ${ap.pid.toString().padEnd(6)} [${ap.name.padEnd(16)}]: ${ap.vramMB} MB VRAM ${ap.modelDetails ? `(${ap.modelDetails})` : ''}`);
              if (ap.commandLine) outputChannel.appendLine(`    Command: ${ap.commandLine}`);
            }
            outputChannel.appendLine(`--------------------------------------------------`);
          }
          outputChannel.appendLine(`Top GPU Memory Consumers:`);
          for (const p of vram.processes.slice(0, 20)) {
            outputChannel.appendLine(`  • PID ${p.pid.toString().padEnd(6)} | ${p.name.padEnd(24)} | ${(p.vramMB || 0).toFixed(1).padStart(7)} MB VRAM ${p.isAIModel ? '🤖 [AI MODEL]' : ''}`);
          }
          outputChannel.appendLine(`==================================================\n`);

          const items: (vscode.QuickPickItem & { proc?: ProcessMemoryInfo; action?: string })[] = [];

          items.push({
            label: `$(circuit-board) ${vram.gpuName}`,
            description: `${vram.usedVRAM_MB.toLocaleString()} MB Dedicated VRAM Used`,
            detail: `${vram.aiProcesses.length} AI model runtime(s) detected`,
            action: 'header',
          });

          if (vram.aiProcesses.length > 0) {
            items.push({
              label: '--- 🤖 Loaded AI / LLM Models in VRAM ---',
              kind: vscode.QuickPickItemKind.Separator,
            } as any);

            for (const ap of vram.aiProcesses) {
              items.push({
                label: `$(hubot) ${ap.modelDetails || ap.name} (PID: ${ap.pid})`,
                description: `${ap.vramMB} MB VRAM`,
                detail: ap.commandLine ? ap.commandLine.slice(0, 160) : ap.path,
                proc: ap,
                action: 'process',
              });
            }
          }

          items.push({
            label: '--- All Top GPU Processes ---',
            kind: vscode.QuickPickItemKind.Separator,
          } as any);

          for (const p of vram.processes.slice(0, 20)) {
            items.push({
              label: `${p.isAIModel ? '$(hubot)' : '$(server-process)'} ${p.name} (PID: ${p.pid})`,
              description: `${p.vramMB} MB VRAM ${p.isAIModel ? '• 🤖 AI RUNTIME' : ''}`,
              detail: p.commandLine ? p.commandLine.slice(0, 120) : p.path,
              proc: p,
              action: 'process',
            });
          }

          const picked = await vscode.window.showQuickPick(items, {
            title: `SimpleSignal: GPU VRAM Report (${vram.usedVRAM_MB} MB Used)`,
            placeHolder: 'Select a process to inspect details or terminate stray model',
          });

          if (picked && picked.proc) {
            await handleProcessAction(picked.proc, outputChannel);
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`SimpleSignal VRAM check failed: ${err.message || err}`);
        }
      }
    );
  });
  context.subscriptions.push(checkVramCmd);

  // ==================== RAM DIAGNOSTICS COMMAND ====================
  const checkRamCmd = vscode.commands.registerCommand('simplesignal.checkRAM', async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '⚡ SimpleSignal: Querying System RAM & processes...',
        cancellable: false,
      },
      async () => {
        try {
          const ram = await SystemDiagnostics.getRAMDiagnostics();
          outputChannel.show(true);
          outputChannel.appendLine(`\n==================================================`);
          outputChannel.appendLine(`⚡ SimpleSignal System RAM Diagnostics`);
          outputChannel.appendLine(`Total RAM: ${ram.totalGB} GB | Used: ${ram.usedGB} GB (${ram.usedPercent}%) | Free: ${ram.freeGB} GB`);
          outputChannel.appendLine(`--------------------------------------------------`);
          if (ram.aiProcesses.length > 0) {
            outputChannel.appendLine(`🤖 Active AI Model Runtimes (${ram.aiProcesses.length}):`);
            for (const ap of ram.aiProcesses) {
              outputChannel.appendLine(`  • PID ${ap.pid.toString().padEnd(6)} [${ap.name.padEnd(16)}]: ${ap.ramMB} MB RAM ${ap.modelDetails ? `(${ap.modelDetails})` : ''}`);
              if (ap.commandLine) outputChannel.appendLine(`    Command: ${ap.commandLine}`);
            }
            outputChannel.appendLine(`--------------------------------------------------`);
          }
          outputChannel.appendLine(`Top Memory Consuming Processes:`);
          for (const p of ram.processes.slice(0, 25)) {
            outputChannel.appendLine(`  • PID ${p.pid.toString().padEnd(6)} | ${p.name.padEnd(24)} | ${p.ramMB.toFixed(1).padStart(7)} MB RAM ${p.isAIModel ? '🤖 [AI MODEL]' : ''}`);
          }
          outputChannel.appendLine(`==================================================\n`);

          const items: (vscode.QuickPickItem & { proc?: ProcessMemoryInfo; action?: string })[] = [];

          items.push({
            label: `$(database) System RAM: ${ram.usedGB} GB / ${ram.totalGB} GB (${ram.usedPercent}% Used)`,
            description: `${ram.freeGB} GB Free`,
            detail: `${ram.aiProcesses.length} AI model runtime(s) detected`,
            action: 'header',
          });

          if (ram.aiProcesses.length > 0) {
            items.push({
              label: '--- 🤖 Loaded AI / LLM Models in RAM ---',
              kind: vscode.QuickPickItemKind.Separator,
            } as any);

            for (const ap of ram.aiProcesses) {
              items.push({
                label: `$(hubot) ${ap.modelDetails || ap.name} (PID: ${ap.pid})`,
                description: `${(ap.ramMB / 1024).toFixed(2)} GB RAM (${ap.ramMB} MB)`,
                detail: ap.commandLine ? ap.commandLine.slice(0, 160) : ap.path,
                proc: ap,
                action: 'process',
              });
            }
          }

          items.push({
            label: '--- Top Memory Processes ---',
            kind: vscode.QuickPickItemKind.Separator,
          } as any);

          for (const p of ram.processes.slice(0, 25)) {
            items.push({
              label: `${p.isAIModel ? '$(hubot)' : '$(server-process)'} ${p.name} (PID: ${p.pid})`,
              description: `${p.ramMB >= 1024 ? (p.ramMB / 1024).toFixed(2) + ' GB' : p.ramMB + ' MB'} RAM ${p.isAIModel ? '• 🤖 AI RUNTIME' : ''}`,
              detail: p.path || p.commandLine?.slice(0, 120),
              proc: p,
              action: 'process',
            });
          }

          const picked = await vscode.window.showQuickPick(items, {
            title: `SimpleSignal: System RAM (${ram.usedPercent}% - ${ram.usedGB} GB Used)`,
            placeHolder: 'Select a process to inspect details or terminate stray model',
          });

          if (picked && picked.proc) {
            await handleProcessAction(picked.proc, outputChannel);
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`SimpleSignal RAM check failed: ${err.message || err}`);
        }
      }
    );
  });
  context.subscriptions.push(checkRamCmd);

  // ==================== STRAY / LOADED MODELS COMMAND ====================
  const checkLoadedModelsCmd = vscode.commands.registerCommand('simplesignal.checkLoadedModels', async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '⚡ SimpleSignal: Scanning for loaded / stray AI models...',
        cancellable: false,
      },
      async () => {
        try {
          const loaded = await SystemDiagnostics.getLoadedModels();
          if (loaded.length === 0) {
            vscode.window.showInformationMessage('⚡ SimpleSignal: No stray or active AI models detected in RAM or VRAM.');
            return;
          }

          const items = loaded.map((m) => {
            const vramStr = m.vramMB ? `${m.vramMB} MB VRAM` : '';
            const ramStr = m.ramMB ? `${(m.ramMB / 1024).toFixed(1)} GB RAM` : '';
            const mem = [vramStr, ramStr].filter(Boolean).join(' • ');

            return {
              label: `$(hubot) ${m.name}`,
              description: `${mem || m.sizeFormatted || ''} [${m.source.toUpperCase()}]`,
              detail: `${m.pid ? `PID: ${m.pid} • ` : ''}${m.details || ''}`,
              model: m,
            };
          });

          const picked = await vscode.window.showQuickPick(items, {
            title: `SimpleSignal: ${loaded.length} Active Model(s) in Memory`,
            placeHolder: 'Select a model to view details or unload/free memory',
          });

          if (picked && picked.model) {
            const m = picked.model;
            const actions = [
              {
                label: '$(trash) Unload / Terminate Model',
                description: 'Immediately free model weights and memory',
              },
              {
                label: '$(copy) Copy Model Details',
                description: 'Copy JSON details to clipboard',
              },
            ];

            const act = await vscode.window.showQuickPick(actions, {
              title: `Model: ${m.name}`,
            });

            if (act?.label.includes('Unload')) {
              if (m.source === 'ollama') {
                const ok = await SystemDiagnostics.unloadOllamaModel(m.name);
                if (ok) vscode.window.showInformationMessage(`⚡ Unloaded Ollama model: ${m.name}`);
                else vscode.window.showErrorMessage(`Failed to unload Ollama model: ${m.name}`);
              } else if (m.pid) {
                const ok = await SystemDiagnostics.killProcess(m.pid);
                if (ok) vscode.window.showInformationMessage(`⚡ Terminated process (PID ${m.pid}) for model ${m.name}`);
                else vscode.window.showErrorMessage(`Failed to terminate PID ${m.pid}`);
              }
            } else if (act?.label.includes('Copy')) {
              await vscode.env.clipboard.writeText(JSON.stringify(m, null, 2));
              vscode.window.showInformationMessage('Model details copied to clipboard.');
            }
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`SimpleSignal Model check failed: ${err.message || err}`);
        }
      }
    );
  });
  context.subscriptions.push(checkLoadedModelsCmd);

  // Manage Endpoints QuickPick
  const manageCmd = vscode.commands.registerCommand('simplesignal.manageEndpoints', async () => {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);

    const choices: (vscode.QuickPickItem & { action: string; endpoint?: EndpointConfig })[] = [
      {
        label: '$(sparkle) Open SimpleSignal Visual Hub',
        description: 'Interactive dashboard for models, endpoints & hardware',
        action: 'dashboard',
      },
      {
        label: '$(circuit-board) Check VRAM & GPU Model Memory',
        description: 'Inspect GPU VRAM allocation & active AI model runtimes',
        action: 'vram',
      },
      {
        label: '$(database) Check RAM & System Processes',
        description: 'Inspect system RAM usage & top memory consumers',
        action: 'ram',
      },
      {
        label: '$(hubot) Inspect Loaded / Stray AI Models',
        description: 'Find & unload stray models loaded in background',
        action: 'stray',
      },
      {
        label: '$(sync) Auto-Fetch & Fill JSON',
        description: 'Query all active endpoints & write to settings.json',
        action: 'autofetch',
      },
      {
        label: '$(add) Add New API Endpoint',
        description: 'Configure OpenAI, Lemonade, Ollama, DashScope, DeepSeek, etc.',
        action: 'add',
      },
      {
        label: '$(gear) Open Settings JSON',
        description: 'Edit simplesignal.endpoints directly in settings.json',
        action: 'settings',
      },
      {
        label: '$(pulse) Test Endpoint Connections',
        description: 'Verify connectivity for each configured endpoint',
        action: 'test',
      },
    ];

    if (endpoints.length > 0) {
      choices.push({
        label: '--- Configured Endpoints ---',
        kind: vscode.QuickPickItemKind.Separator,
        action: 'none',
      } as any);

      for (const ep of endpoints) {
        const modelCount = (ep.models || []).length;
        choices.push({
          label: `$(server) ${ep.name}`,
          description: `${ep.baseUrl} (${modelCount} models, ${ep.enabled === false ? 'Disabled' : 'Enabled'})`,
          action: 'edit',
          endpoint: ep,
        });
      }
    }

    const selected = await vscode.window.showQuickPick(choices, {
      title: 'SimpleSignal - Universal Models & Memory Hub',
      placeHolder: 'Select an action, diagnostics tool, or endpoint',
    });

    if (!selected) return;

    if (selected.action === 'dashboard') {
      vscode.commands.executeCommand('simplesignal.openDashboard');
    } else if (selected.action === 'vram') {
      vscode.commands.executeCommand('simplesignal.checkVRAM');
    } else if (selected.action === 'ram') {
      vscode.commands.executeCommand('simplesignal.checkRAM');
    } else if (selected.action === 'stray') {
      vscode.commands.executeCommand('simplesignal.checkLoadedModels');
    } else if (selected.action === 'autofetch') {
      vscode.commands.executeCommand('simplesignal.autoFetchModels');
    } else if (selected.action === 'add') {
      await promptAddNewEndpoint();
    } else if (selected.action === 'settings') {
      vscode.commands.executeCommand('workbench.action.openSettingsJson');
    } else if (selected.action === 'test') {
      vscode.commands.executeCommand('simplesignal.testEndpoints');
    } else if (selected.action === 'edit' && selected.endpoint) {
      await promptEditEndpoint(selected.endpoint);
    }
  });
  context.subscriptions.push(manageCmd);

  // Open config file command
  const openConfigCmd = vscode.commands.registerCommand('simplesignal.openConfigFile', () => {
    vscode.commands.executeCommand('workbench.action.openSettingsJson');
  });
  context.subscriptions.push(openConfigCmd);

  // Test endpoints command
  const testCmd = vscode.commands.registerCommand('simplesignal.testEndpoints', async () => {
    const config = vscode.workspace.getConfiguration('simplesignal');
    const endpoints = config.get<EndpointConfig[]>('endpoints', []);

    if (endpoints.length === 0) {
      vscode.window.showInformationMessage('SimpleSignal: No endpoints configured yet.');
      return;
    }

    const results: string[] = [];
    for (const ep of endpoints) {
      try {
        const models = await ModelFetcher.fetchModelsForEndpoint(ep);
        results.push(`✅ ${ep.name}: Connected (${models.length} models)`);
      } catch (err: any) {
        results.push(`❌ ${ep.name}: ${err.message || 'Connection failed'}`);
      }
    }

    outputChannel.show();
    outputChannel.appendLine('[SimpleSignal] Endpoint Connection Test Results:');
    for (const r of results) {
      outputChannel.appendLine(r);
    }
    vscode.window.showInformationMessage(`SimpleSignal Test: ${results.filter((r) => r.startsWith('✅')).length}/${endpoints.length} endpoints online.`);
  });
  context.subscriptions.push(testCmd);

  // Watch configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('simplesignal.endpoints')) {
        outputChannel.appendLine('[SimpleSignal] Endpoints configuration changed, refreshing model list...');
        provider.refresh();
        treeDataProvider.refresh();
        updateStatusBar(statusBarItem);
      }
    })
  );

  // Auto-fetch on startup if enabled
  const autoFetchOnStart = vscode.workspace.getConfiguration('simplesignal').get<boolean>('autoFetchOnStartup', true);
  if (autoFetchOnStart) {
    ModelFetcher.autoFetchAllAndUpdateJSON(outputChannel)
      .then((res) => {
        provider.refresh();
        treeDataProvider.refresh();
        updateStatusBar(statusBarItem);
        outputChannel.appendLine(`[SimpleSignal] Startup auto-fetch complete: ${res.totalModels} models active.`);
      })
      .catch((err) => {
        outputChannel.appendLine(`[SimpleSignal] Startup notice: ${err.message || err}`);
      });
  }
}

async function handleProcessAction(proc: ProcessMemoryInfo, outputChannel: vscode.OutputChannel) {
  const actions: vscode.QuickPickItem[] = [
    {
      label: `$(trash) Terminate / Kill Process (PID ${proc.pid})`,
      description: `Free ${proc.vramMB ? `${proc.vramMB} MB VRAM, ` : ''}${proc.ramMB ? `${proc.ramMB} MB RAM` : ''}`,
    },
    {
      label: '$(copy) Copy Full Command Line & Path',
      description: proc.path || proc.commandLine,
    },
    {
      label: '$(output) View Full SimpleSignal Output Log',
    },
  ];

  const selected = await vscode.window.showQuickPick(actions, {
    title: `Process: ${proc.name} (PID: ${proc.pid})`,
    placeHolder: 'Select an action',
  });

  if (!selected) return;

  if (selected.label.includes('Terminate')) {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to terminate "${proc.name}" (PID: ${proc.pid})? This will immediately free its allocated memory.`,
      { modal: true },
      'Yes, Terminate Process'
    );
    if (confirm === 'Yes, Terminate Process') {
      const ok = await SystemDiagnostics.killProcess(proc.pid);
      if (ok) {
        vscode.window.showInformationMessage(`⚡ Successfully terminated ${proc.name} (PID ${proc.pid})! Memory freed.`);
        outputChannel.appendLine(`[SimpleSignal] Terminated process ${proc.name} (PID ${proc.pid})`);
      } else {
        vscode.window.showErrorMessage(`Failed to terminate PID ${proc.pid}. You may need elevated permissions.`);
      }
    }
  } else if (selected.label.includes('Copy')) {
    const text = `PID: ${proc.pid}\nProcess: ${proc.name}\nRAM: ${proc.ramMB} MB\nVRAM: ${proc.vramMB || 0} MB\nPath: ${proc.path || ''}\nCommandLine: ${proc.commandLine || ''}`;
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`Copied process details to clipboard.`);
  } else if (selected.label.includes('View Full')) {
    outputChannel.show(true);
  }
}

function updateStatusBar(statusBarItem: vscode.StatusBarItem) {
  const config = vscode.workspace.getConfiguration('simplesignal');
  const endpoints = config.get<EndpointConfig[]>('endpoints', []);
  const totalModels = endpoints.reduce((sum, ep) => sum + (ep.models?.length || 0), 0);

  if (totalModels > 0) {
    statusBarItem.text = `$(sparkle) SimpleSignal: ${totalModels} Models`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(warning) SimpleSignal: 0 Models`;
  }
  statusBarItem.show();
}

async function promptAddNewEndpoint() {
  const name = await vscode.window.showInputBox({
    title: 'New Endpoint Name',
    prompt: 'Enter a display name (e.g. "Lemonade Server" or "DeepSeek API")',
    placeHolder: 'Custom Server',
    ignoreFocusOut: true,
  });
  if (!name) return;

  const baseUrl = await vscode.window.showInputBox({
    title: 'Endpoint Base URL',
    prompt: 'Enter the base URL (e.g. http://127.0.0.1:9000/api/v1 or https://api.deepseek.com/v1)',
    placeHolder: 'http://127.0.0.1:9000/api/v1',
    ignoreFocusOut: true,
  });
  if (!baseUrl) return;

  const apiKey = await vscode.window.showInputBox({
    title: 'API Key (Optional)',
    prompt: 'Enter API Key or token (leave empty if not required)',
    password: true,
    ignoreFocusOut: true,
  });

  const protocolPick = await vscode.window.showQuickPick(['openai', 'ollama', 'lemonade', 'anthropic', 'gemini'], {
    title: 'API Protocol',
    placeHolder: 'Select protocol type (Default: openai)',
  });

  const config = vscode.workspace.getConfiguration('simplesignal');
  const endpoints: EndpointConfig[] = JSON.parse(JSON.stringify(config.get<EndpointConfig[]>('endpoints', [])));

  const newEp: EndpointConfig = {
    name,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey || '',
    protocol: (protocolPick as any) || 'openai',
    enabled: true,
    models: [],
  };

  endpoints.push(newEp);
  await config.update('endpoints', endpoints, vscode.ConfigurationTarget.Global);

  vscode.commands.executeCommand('simplesignal.autoFetchModels');
}

async function promptEditEndpoint(endpoint: EndpointConfig) {
  const choice = await vscode.window.showQuickPick(
    [
      { label: endpoint.enabled === false ? '$(pass) Enable Endpoint' : '$(stop) Disable Endpoint', action: 'toggle' },
      { label: '$(sync) Fetch Models for this Endpoint', action: 'fetch' },
      { label: '$(trash) Delete Endpoint', action: 'delete' },
    ],
    {
      title: `Manage: ${endpoint.name}`,
    }
  );

  if (!choice) return;

  const config = vscode.workspace.getConfiguration('simplesignal');
  let endpoints: EndpointConfig[] = JSON.parse(JSON.stringify(config.get<EndpointConfig[]>('endpoints', [])));
  const index = endpoints.findIndex((e) => e.name === endpoint.name && e.baseUrl === endpoint.baseUrl);

  if (index === -1) return;

  if (choice.action === 'toggle') {
    endpoints[index].enabled = !(endpoints[index].enabled !== false);
    await config.update('endpoints', endpoints, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`SimpleSignal: ${endpoints[index].name} is now ${endpoints[index].enabled ? 'Enabled' : 'Disabled'}.`);
  } else if (choice.action === 'delete') {
    endpoints.splice(index, 1);
    await config.update('endpoints', endpoints, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`SimpleSignal: Removed endpoint "${endpoint.name}".`);
  } else if (choice.action === 'fetch') {
    vscode.commands.executeCommand('simplesignal.autoFetchModels');
  }
}

export function deactivate() {}
