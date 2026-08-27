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
exports.SystemDiagnostics = void 0;
const os = __importStar(require("os"));
const http = __importStar(require("http"));
const child_process_1 = require("child_process");
class SystemDiagnostics {
    /**
     * Run PowerShell script on Windows using Base64 EncodedCommand to prevent escaping issues.
     */
    static runPowerShell(script) {
        const b64 = Buffer.from(script, 'utf16le').toString('base64');
        return new Promise((resolve) => {
            (0, child_process_1.exec)(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}`, { maxBuffer: 15 * 1024 * 1024, timeout: 8000 }, (err, stdout) => {
                if (err)
                    resolve('');
                else
                    resolve(stdout ? stdout.trim() : '');
            });
        });
    }
    /**
     * Run bash/sh command on Unix/macOS.
     */
    static runCommand(cmd) {
        return new Promise((resolve) => {
            (0, child_process_1.exec)(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
                if (err)
                    resolve('');
                else
                    resolve(stdout ? stdout.trim() : '');
            });
        });
    }
    /**
     * Checks if a process or command line is an AI model runner / runtime.
     */
    static isAIProcess(name, cmdLine = '', path = '') {
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
    static async getRAMDiagnostics() {
        const totalBytes = os.totalmem();
        const freeBytes = os.freemem();
        const usedBytes = totalBytes - freeBytes;
        const totalGB = parseFloat((totalBytes / 1024 ** 3).toFixed(2));
        const usedGB = parseFloat((usedBytes / 1024 ** 3).toFixed(2));
        const freeGB = parseFloat((freeBytes / 1024 ** 3).toFixed(2));
        const usedPercent = Math.round((usedBytes / totalBytes) * 100);
        const processes = [];
        const aiProcesses = [];
        if (process.platform === 'win32') {
            const psScript = `
        $procs = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 30 Id, ProcessName, @{Name='RAM_MB'; Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}}, Path
        $procs | ConvertTo-Json -Compress
      `;
            const out = await this.runPowerShell(psScript);
            let rawList = [];
            try {
                const parsed = JSON.parse(out);
                rawList = Array.isArray(parsed) ? parsed : [parsed];
            }
            catch { }
            // Get CommandLines for AI process identification
            const cmdScript = `
        Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress
      `;
            const cmdOut = await this.runPowerShell(cmdScript);
            const cmdMap = new Map();
            try {
                const parsedCmds = JSON.parse(cmdOut);
                const cmdList = Array.isArray(parsedCmds) ? parsedCmds : [parsedCmds];
                for (const item of cmdList) {
                    if (item && item.ProcessId) {
                        cmdMap.set(item.ProcessId, item.CommandLine || '');
                    }
                }
            }
            catch { }
            for (const p of rawList) {
                if (!p || !p.Id)
                    continue;
                const pid = p.Id;
                const name = p.ProcessName || `PID ${pid}`;
                const ramMB = p.RAM_MB || 0;
                const path = p.Path || '';
                const commandLine = cmdMap.get(pid) || '';
                const aiCheck = this.isAIProcess(name, commandLine, path);
                const procInfo = {
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
        }
        else {
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
                    const procInfo = {
                        pid,
                        name,
                        ramMB,
                        commandLine,
                        isAIModel: aiCheck.isAI,
                        modelDetails: aiCheck.details,
                    };
                    processes.push(procInfo);
                    if (aiCheck.isAI)
                        aiProcesses.push(procInfo);
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
    static async getVRAMDiagnostics() {
        let gpuName = 'Graphics Adapter';
        let usedVRAM_MB = 0;
        const processes = [];
        const aiProcesses = [];
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
                if (parsed.GPU)
                    gpuName = parsed.GPU;
                if (parsed.UsedVRAM_MB)
                    usedVRAM_MB = parsed.UsedVRAM_MB;
                // Get command lines for processes
                const cmdScript = `
          Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress
        `;
                const cmdOut = await this.runPowerShell(cmdScript);
                const cmdMap = new Map();
                try {
                    const parsedCmds = JSON.parse(cmdOut);
                    const cmdList = Array.isArray(parsedCmds) ? parsedCmds : [parsedCmds];
                    for (const item of cmdList) {
                        if (item && item.ProcessId) {
                            cmdMap.set(item.ProcessId, item.CommandLine || '');
                        }
                    }
                }
                catch { }
                const rawProcs = Array.isArray(parsed.Processes) ? parsed.Processes : parsed.Processes ? [parsed.Processes] : [];
                for (const p of rawProcs) {
                    if (!p || !p.PID)
                        continue;
                    const pid = p.PID;
                    const name = p.Name || `PID ${pid}`;
                    const vramMB = p.VRAM_MB || 0;
                    const cmdLine = cmdMap.get(pid) || '';
                    const aiCheck = this.isAIProcess(name, cmdLine);
                    const procInfo = {
                        pid,
                        name,
                        ramMB: 0,
                        vramMB,
                        commandLine: cmdLine,
                        isAIModel: aiCheck.isAI,
                        modelDetails: aiCheck.details,
                    };
                    processes.push(procInfo);
                    if (aiCheck.isAI)
                        aiProcesses.push(procInfo);
                }
            }
            catch { }
        }
        else {
            // Check nvidia-smi on Linux
            const nvidiaOut = await this.runCommand('nvidia-smi --query-gpu=name,memory.used --format=csv,noheader,nounits');
            if (nvidiaOut) {
                const parts = nvidiaOut.split(',');
                gpuName = parts[0]?.trim() || gpuName;
                usedVRAM_MB = parseFloat(parts[1]?.trim()) || 0;
            }
            else {
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
                    }
                    catch { }
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
    static checkOllamaLoadedModels(baseUrl = 'http://localhost:11434') {
        return new Promise((resolve) => {
            const url = `${baseUrl.replace(/\/+$/, '')}/api/ps`;
            try {
                const req = http.get(url, { timeout: 2000 }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            const models = (parsed.models || []).map((m) => ({
                                source: 'ollama',
                                name: m.name || m.model || 'Unknown Ollama Model',
                                sizeFormatted: m.size ? `${(m.size / 1024 ** 3).toFixed(2)} GB` : undefined,
                                vramMB: m.size_vram ? Math.round(m.size_vram / 1024 ** 2) : undefined,
                                details: `Ollama • ${m.details?.parameter_size || ''} ${m.details?.quantization_level || ''}`.trim(),
                                expiresAt: m.expires_at,
                            }));
                            resolve(models);
                        }
                        catch {
                            resolve([]);
                        }
                    });
                });
                req.on('error', () => resolve([]));
                req.on('timeout', () => {
                    req.destroy();
                    resolve([]);
                });
            }
            catch {
                resolve([]);
            }
        });
    }
    /**
     * Aggregates all loaded AI models from system processes and server APIs.
     */
    static async getLoadedModels() {
        const models = [];
        // 1. Check Ollama API
        const ollamaModels = await this.checkOllamaLoadedModels();
        models.push(...ollamaModels);
        // 2. Check RAM & VRAM processes
        const [ramDiag, vramDiag] = await Promise.all([this.getRAMDiagnostics(), this.getVRAMDiagnostics()]);
        const vramMap = new Map();
        for (const vp of vramDiag.processes) {
            if (vp.vramMB)
                vramMap.set(vp.pid, vp.vramMB);
        }
        const seenPids = new Set();
        for (const ap of [...ramDiag.aiProcesses, ...vramDiag.aiProcesses]) {
            if (seenPids.has(ap.pid))
                continue;
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
    static killProcess(pid) {
        return new Promise((resolve) => {
            const cmd = process.platform === 'win32' ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
            (0, child_process_1.exec)(cmd, (err) => {
                resolve(!err);
            });
        });
    }
    /**
     * Unload an Ollama model by setting keep_alive: 0.
     */
    static unloadOllamaModel(modelName, baseUrl = 'http://localhost:11434') {
        return new Promise((resolve) => {
            const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/generate`);
            const body = JSON.stringify({ model: modelName, keep_alive: 0 });
            const req = http.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
                timeout: 4000,
            }, (res) => {
                resolve(res.statusCode === 200);
            });
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
exports.SystemDiagnostics = SystemDiagnostics;
//# sourceMappingURL=systemDiagnostics.js.map