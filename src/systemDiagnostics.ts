import * as os from 'os';
import * as http from 'http';
import { exec } from 'child_process';
import { RAMDiagnostics, VRAMDiagnostics, ProcessMemoryInfo, LoadedAIModel, EndpointConfig } from './types';
import { resolveEndpointApiKey, normalizeBaseUrl } from './utils';

export class SystemDiagnostics {
  /**
   * Run PowerShell script on Windows using Base64 EncodedCommand to prevent escaping issues.
   */
  private static runPowerShell(script: string): Promise<string> {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve) => {
      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}`,
        { maxBuffer: 15 * 1024 * 1024, timeout: 8000 },
        (err, stdout) => {
          if (err) resolve('');
          else resolve(stdout ? stdout.trim() : '');
        }
      );
    });
  }

  /**
   * Run bash/sh command on Unix/macOS.
   */
  private static runCommand(cmd: string): Promise<string> {
    return new Promise((resolve) => {
      exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
        if (err) resolve('');
        else resolve(stdout ? stdout.trim() : '');
      });
    });
  }

  /**
   * Checks if a process or command line is an AI model runner / runtime.
   */
  public static isAIProcess(name: string, cmdLine: string = '', path: string = ''): { isAI: boolean; details?: string } {
    const lowerName = name.toLowerCase();
    const lowerCmd = cmdLine.toLowerCase();
    const lowerPath = path.toLowerCase();

    // Specific known model runners
    if (lowerName.includes('llama-server') || lowerName.includes('llama.cpp') || lowerName.includes('koboldcpp')) {
      const modelMatch = cmdLine.match(/(?:-m|--model)\s+["']?([^"'\s]+)["']?/i) || cmdLine.match(/([^\s"'\\]+\.gguf)/i);
      const modelName = modelMatch ? modelMatch[1].split(/[\/\\]/).pop() : 'llama.cpp Server';
      return { isAI: true, details: `llama.cpp: ${modelName}` };
    }

    if (lowerName.includes('ollama') || lowerName.includes('ollama_llama_server')) {
      return { isAI: true, details: 'Ollama Model Runtime' };
    }

    if (lowerName.includes('lmstudio') || lowerName.includes('lms')) {
      return { isAI: true, details: 'LM Studio Engine' };
    }

    if (lowerName.includes('lemonade') || lowerPath.includes('lemonade')) {
      return { isAI: true, details: 'Lemonade Model Server' };
    }

    if (lowerName.includes('vllm') || lowerCmd.includes('vllm')) {
      return { isAI: true, details: 'vLLM Inference Engine' };
    }

    if (lowerName.includes('text-generation-webui')) {
      return { isAI: true, details: 'Text-Gen WebUI' };
    }

    if (lowerName.includes('simplerag')) {
      return { isAI: true, details: 'SimpleRAG Desktop' };
    }

    // Python scripts running models / training / inference
    if (lowerName.includes('python')) {
      if (lowerCmd.includes('.gguf') || lowerCmd.includes('.safetensors') || lowerCmd.includes('torch') || lowerCmd.includes('transformers') || lowerCmd.includes('train') || lowerCmd.includes('checkpoint') || lowerCmd.includes('inference')) {
        const modelMatch = cmdLine.match(/([^\s"'\\]+\.(?:gguf|safetensors|bin|pt|pth))/i) || cmdLine.match(/(?:--checkpoint|--model|--weights)\s+["']?([^"'\s]+)["']?/i);
        const modelName = modelMatch ? modelMatch[1].split(/[\/\\]/).pop() : 'Python ML/Inference';
        return { isAI: true, details: `Python ML: ${modelName}` };
      }
    }

    return { isAI: false };
  }

  /**
   * Collect comprehensive RAM diagnostics and top memory consumers.
   */
  public static async getRAMDiagnostics(): Promise<RAMDiagnostics> {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    const totalGB = parseFloat((totalBytes / 1024 ** 3).toFixed(2));
    const usedGB = parseFloat((usedBytes / 1024 ** 3).toFixed(2));
    const freeGB = parseFloat((freeBytes / 1024 ** 3).toFixed(2));
    const usedPercent = Math.round((usedBytes / totalBytes) * 100);

    const processes: ProcessMemoryInfo[] = [];
    const aiProcesses: ProcessMemoryInfo[] = [];

    if (process.platform === 'win32') {
      const psScript = `
        $procs = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 30 Id, ProcessName, @{Name='RAM_MB'; Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}}, Path
        $procs | ConvertTo-Json -Compress
      `;
      const out = await this.runPowerShell(psScript);
      let rawList: any[] = [];
      try {
        const parsed = JSON.parse(out);
        rawList = Array.isArray(parsed) ? parsed : [parsed];
      } catch {}

      // Get CommandLines for AI process identification
      const cmdScript = `
        Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress
      `;
      const cmdOut = await this.runPowerShell(cmdScript);
      const cmdMap = new Map<number, string>();
      try {
        const parsedCmds = JSON.parse(cmdOut);
        const cmdList = Array.isArray(parsedCmds) ? parsedCmds : [parsedCmds];
        for (const item of cmdList) {
          if (item && item.ProcessId) {
            cmdMap.set(item.ProcessId, item.CommandLine || '');
          }
        }
      } catch {}

      for (const p of rawList) {
        if (!p || !p.Id) continue;
        const pid = p.Id;
        const name = p.ProcessName || `PID ${pid}`;
        const ramMB = p.RAM_MB || 0;
        const path = p.Path || '';
        const commandLine = cmdMap.get(pid) || '';

        const aiCheck = this.isAIProcess(name, commandLine, path);
        const procInfo: ProcessMemoryInfo = {
          pid,
          name,
          ramMB,
          path,
          commandLine,
          isAIModel: aiCheck.isAI,
          modelDetails: aiCheck.details,
        };

        processes.push(procInfo);
        if (aiCheck.isAI) {
          aiProcesses.push(procInfo);
        }
      }
    } else {
      // Unix/macOS fallback
      const psOut = await this.runCommand('ps -eo pid,rss,comm,args --sort=-rss | head -n 30');
      const lines = psOut.split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const pid = parseInt(parts[0], 10);
          const rssKB = parseInt(parts[1], 10) || 0;
          const ramMB = parseFloat((rssKB / 1024).toFixed(1));
          const name = parts[2];
          const commandLine = parts.slice(3).join(' ');

          const aiCheck = this.isAIProcess(name, commandLine);
          const procInfo: ProcessMemoryInfo = {
            pid,
            name,
            ramMB,
            commandLine,
            isAIModel: aiCheck.isAI,
            modelDetails: aiCheck.details,
          };
          processes.push(procInfo);
          if (aiCheck.isAI) aiProcesses.push(procInfo);
        }
      }
    }

    return {
      totalGB,
      usedGB,
      freeGB,
      usedPercent,
      processes,
      aiProcesses,
    };
  }

  /**
   * Collect GPU VRAM diagnostics (AMD, NVIDIA, Intel, etc.).
   */
  public static async getVRAMDiagnostics(): Promise<VRAMDiagnostics> {
    let gpuName = 'Graphics Adapter';
    let usedVRAM_MB = 0;
    const processes: ProcessMemoryInfo[] = [];
    const aiProcesses: ProcessMemoryInfo[] = [];

    if (process.platform === 'win32') {
      const vramScript = `
        $gpu = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name
        $adapterMem = (Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum
        $usedMB = if ($adapterMem) { [math]::Round(($adapterMem.Sum / 1MB), 1) } else { 0 }
        
        $procSamples = (Get-Counter '\\GPU Process Memory(*)\\dedicated usage' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 15MB }
        $pList = @()
        if ($procSamples) {
          foreach ($s in $procSamples) {
            if ($s.Path -match 'pid_(\\d+)') {
              $pidNum = [int]$matches[1]
              $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
              $pName = if ($proc) { $proc.ProcessName } else { "PID $pidNum" }
              $pList += [PSCustomObject]@{
                PID = $pidNum
                Name = $pName
                VRAM_MB = [math]::Round(($s.CookedValue / 1MB), 1)
              }
            }
          }
        }
        
        $dedup = $pList | Sort-Object VRAM_MB -Descending | Group-Object PID | ForEach-Object { $_.Group | Select-Object -First 1 }
        
        [PSCustomObject]@{
          GPU = $gpu
          UsedVRAM_MB = $usedMB
          Processes = $dedup
        } | ConvertTo-Json -Depth 3 -Compress
      `;

      const out = await this.runPowerShell(vramScript);
      try {
        const parsed = JSON.parse(out);
        if (parsed.GPU) gpuName = parsed.GPU;
        if (parsed.UsedVRAM_MB) usedVRAM_MB = parsed.UsedVRAM_MB;

        // Get command lines for processes
        const cmdScript = `
          Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress
        `;
        const cmdOut = await this.runPowerShell(cmdScript);
        const cmdMap = new Map<number, string>();
        try {
          const parsedCmds = JSON.parse(cmdOut);
          const cmdList = Array.isArray(parsedCmds) ? parsedCmds : [parsedCmds];
          for (const item of cmdList) {
            if (item && item.ProcessId) {
              cmdMap.set(item.ProcessId, item.CommandLine || '');
            }
          }
        } catch {}

        const rawProcs = Array.isArray(parsed.Processes) ? parsed.Processes : parsed.Processes ? [parsed.Processes] : [];
        for (const p of rawProcs) {
          if (!p || !p.PID) continue;
          const pid = p.PID;
          const name = p.Name || `PID ${pid}`;
          const vramMB = p.VRAM_MB || 0;
          const cmdLine = cmdMap.get(pid) || '';

          const aiCheck = this.isAIProcess(name, cmdLine);
          const procInfo: ProcessMemoryInfo = {
            pid,
            name,
            ramMB: 0,
            vramMB,
            commandLine: cmdLine,
            isAIModel: aiCheck.isAI,
            modelDetails: aiCheck.details,
          };
          processes.push(procInfo);
          if (aiCheck.isAI) aiProcesses.push(procInfo);
        }
      } catch {}
    } else {
      // Check nvidia-smi on Linux
      const nvidiaOut = await this.runCommand('nvidia-smi --query-gpu=name,memory.used --format=csv,noheader,nounits');
      if (nvidiaOut) {
        const parts = nvidiaOut.split(',');
        gpuName = parts[0]?.trim() || gpuName;
        usedVRAM_MB = parseFloat(parts[1]?.trim()) || 0;
      } else {
        // Check rocm-smi for AMD GPUs on Linux
        const rocmOut = await this.runCommand('rocm-smi --showmeminfo vram --json');
        if (rocmOut) {
          try {
            const parsed = JSON.parse(rocmOut);
            const cardKey = Object.keys(parsed)[0];
            if (cardKey && parsed[cardKey]['VRAM Total Used Memory (B)']) {
              gpuName = 'AMD Radeon / ROCm GPU';
              usedVRAM_MB = parseFloat((parseInt(parsed[cardKey]['VRAM Total Used Memory (B)'], 10) / (1024 * 1024)).toFixed(1));
            }
          } catch {}
        }
      }
    }

    return {
      gpuName,
      usedVRAM_MB,
      processes,
      aiProcesses,
    };
  }

  /**
   * Check Ollama running loaded models (/api/ps).
   */
  public static checkOllamaLoadedModels(baseUrl: string = 'http://localhost:11434'): Promise<LoadedAIModel[]> {
    return new Promise((resolve) => {
      const url = `${baseUrl.replace(/\/+$/, '')}/api/ps`;
      try {
        const req = http.get(url, { timeout: 2000 }, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const models: LoadedAIModel[] = (parsed.models || []).map((m: any) => ({
                source: 'ollama' as const,
                name: m.name || m.model || 'Unknown Ollama Model',
                sizeFormatted: m.size ? `${(m.size / 1024 ** 3).toFixed(2)} GB` : undefined,
                vramMB: m.size_vram ? Math.round(m.size_vram / 1024 ** 2) : undefined,
                details: `Ollama • ${m.details?.parameter_size || ''} ${m.details?.quantization_level || ''}`.trim(),
                expiresAt: m.expires_at,
              }));
              resolve(models);
            } catch {
              resolve([]);
            }
          });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => {
          req.destroy();
          resolve([]);
        });
      } catch {
        resolve([]);
      }
    });
  }

  /**
   * Aggregates all loaded AI models from system processes and server APIs.
   */
  public static async getLoadedModels(): Promise<LoadedAIModel[]> {
    const models: LoadedAIModel[] = [];

    // 1. Check Ollama API
    const ollamaModels = await this.checkOllamaLoadedModels();
    models.push(...ollamaModels);

    // 2. Check RAM & VRAM processes
    const [ramDiag, vramDiag] = await Promise.all([this.getRAMDiagnostics(), this.getVRAMDiagnostics()]);

    const vramMap = new Map<number, number>();
    for (const vp of vramDiag.processes) {
      if (vp.vramMB) vramMap.set(vp.pid, vp.vramMB);
    }

    const seenPids = new Set<number>();

    for (const ap of [...ramDiag.aiProcesses, ...vramDiag.aiProcesses]) {
      if (seenPids.has(ap.pid)) continue;
      seenPids.add(ap.pid);

      const vramMB = vramMap.get(ap.pid) || ap.vramMB || 0;
      const modelTitle = ap.modelDetails || ap.name;

      models.push({
        source: ap.name.includes('llama') ? 'llamacpp' : ap.name.includes('python') ? 'python' : 'process',
        name: modelTitle,
        pid: ap.pid,
        ramMB: ap.ramMB,
        vramMB: vramMB > 0 ? vramMB : undefined,
        details: ap.commandLine ? ap.commandLine.slice(0, 180) + '...' : ap.path,
      });
    }

    return models;
  }

  /**
   * Terminate a stray process by PID.
   */
  public static killProcess(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
      exec(cmd, (err) => {
        resolve(!err);
      });
    });
  }

  /**
   * Load/Warm up a model into GPU memory for local servers.
   */
  public static async loadModel(endpoint: EndpointConfig, modelId: string): Promise<{ success: boolean; message: string }> {
    const urlLower = (endpoint.baseUrl || '').toLowerCase();
    const nameLower = (endpoint.name || '').toLowerCase();
    const apiKey = resolveEndpointApiKey(endpoint);
    const baseUrl = normalizeBaseUrl(endpoint.baseUrl);

    // 1. Ollama load (keep_alive: -1 loads model into memory indefinitely)
    if (urlLower.includes(':11434') || nameLower.includes('ollama') || endpoint.protocol === 'ollama') {
      try {
        const url = `${baseUrl.includes('/api') ? baseUrl.replace(/\/api.*$/, '') : baseUrl}/api/generate`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, keep_alive: -1 }),
        });
        if (res.ok) {
          return { success: true, message: `Loaded "${modelId}" into Ollama GPU memory.` };
        }
      } catch (e: any) {
        return { success: false, message: e.message || 'Failed to load Ollama model' };
      }
    }

    // 2. LM Studio load
    if (urlLower.includes(':1234') || nameLower.includes('lm studio')) {
      try {
        const root = baseUrl.replace(/\/+$/, '').replace(/\/v1.*$/, '').replace(/\/api.*$/, '');
        for (const path of ['/api/v0/models/load', '/v1/models/load']) {
          try {
            const res = await fetch(`${root}${path}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify({ model: modelId, model_name: modelId, instance_id: modelId }),
            });
            if (res.ok) {
              return { success: true, message: `Loaded "${modelId}" into LM Studio memory.` };
            }
          } catch {}
        }
      } catch {}
    }

    // 3. Lemonade Server load (POST /api/v1/load with {"model_name": modelId})
    if (urlLower.includes(':9000') || urlLower.includes(':13305') || nameLower.includes('lemonade')) {
      try {
        const root = baseUrl.replace(/\/+$/, '').replace(/\/api\/v1.*$/, '').replace(/\/v1.*$/, '');
        const loadUrl = `${root}/api/v1/load`;
        const res = await fetch(loadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model_name: modelId }),
        });
        if (res.ok) {
          return { success: true, message: `Loaded "${modelId}" into Lemonade memory.` };
        }
      } catch {}
    }

    // 4. General OpenAI compatible warm-up load (1 token completion)
    try {
      let chatUrl = baseUrl;
      if (!chatUrl.endsWith('/chat/completions')) {
        chatUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      }
      const res = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 1,
        }),
      });
      if (res.ok) {
        return { success: true, message: `Warmed up & loaded "${modelId}" into active memory.` };
      }
      const err = await res.text().catch(() => '');
      return { success: false, message: `HTTP ${res.status}: ${err}` };
    } catch (e: any) {
      return { success: false, message: e.message || 'Load failed' };
    }
  }

  /**
   * Unload/Eject a model from GPU/RAM for local servers.
   */
  public static async unloadModel(endpoint: EndpointConfig, modelId: string): Promise<{ success: boolean; message: string }> {
    const urlLower = (endpoint.baseUrl || '').toLowerCase();
    const nameLower = (endpoint.name || '').toLowerCase();
    const apiKey = resolveEndpointApiKey(endpoint);
    const baseUrl = normalizeBaseUrl(endpoint.baseUrl);

    // 1. Lemonade Server unload (POST /api/v1/unload with {"model_name": modelId})
    if (urlLower.includes(':9000') || urlLower.includes(':13305') || nameLower.includes('lemonade')) {
      try {
        const root = baseUrl.replace(/\/+$/, '').replace(/\/api\/v1.*$/, '').replace(/\/v1.*$/, '');
        const unloadUrl = `${root}/api/v1/unload`;
        const res = await fetch(unloadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model_name: modelId }),
        });
        if (res.ok) {
          return { success: true, message: `Unloaded "${modelId}" from Lemonade memory.` };
        }
        // Fallback to global unload
        const res2 = await fetch(unloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res2.ok) {
          return { success: true, message: `Unloaded model from Lemonade memory.` };
        }
      } catch (e: any) {
        return { success: false, message: e.message || 'Failed to unload from Lemonade server' };
      }
    }

    // 2. Ollama unload (keep_alive: 0 unloads model immediately)
    if (urlLower.includes(':11434') || nameLower.includes('ollama') || endpoint.protocol === 'ollama') {
      try {
        const root = baseUrl.replace(/\/+$/, '').replace(/\/api.*$/, '').replace(/\/v1.*$/, '');
        const url = `${root}/api/generate`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, keep_alive: 0 }),
        });
        if (res.ok) {
          return { success: true, message: `Unloaded "${modelId}" from Ollama GPU memory.` };
        }
      } catch (e: any) {
        return { success: false, message: e.message || 'Failed to unload Ollama model' };
      }
    }

    // 3. LM Studio unload
    if (urlLower.includes(':1234') || nameLower.includes('lm studio')) {
      try {
        const root = baseUrl.replace(/\/+$/, '').replace(/\/v1.*$/, '').replace(/\/api.*$/, '');
        for (const path of ['/api/v0/models/unload', '/v1/models/unload', '/models/unload']) {
          try {
            const res = await fetch(`${root}${path}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify({ model: modelId, model_name: modelId, instance_id: modelId }),
            });
            if (res.ok) {
              return { success: true, message: `Unloaded "${modelId}" from LM Studio.` };
            }
          } catch {}
        }
      } catch {}
    }

    // 4. Try generic endpoints
    const root = baseUrl.replace(/\/+$/, '').replace(/\/v1.*$/, '').replace(/\/api.*$/, '');
    for (const path of ['/api/v1/unload', '/models/unload', '/v1/models/unload', '/unload']) {
      try {
        const res = await fetch(`${root}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model: modelId, model_name: modelId }),
        });
        if (res.ok) {
          return { success: true, message: `Unloaded "${modelId}" from server memory.` };
        }
      } catch {}
    }

    return { success: false, message: 'Unload not natively supported by this endpoint.' };
  }

  /**
   * Unload an Ollama model by setting keep_alive: 0.
   */
  public static unloadOllamaModel(modelName: string, baseUrl: string = 'http://localhost:11434'): Promise<boolean> {
    return new Promise((resolve) => {
      const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/generate`);
      const body = JSON.stringify({ model: modelName, keep_alive: 0 });
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 4000,
        },
        (res) => {
          resolve(res.statusCode === 200);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.write(body);
      req.end();
    });
  }
}
