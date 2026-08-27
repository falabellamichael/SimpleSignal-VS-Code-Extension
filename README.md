<div align="center">

<img src="./media/logo.png" alt="SimpleSignal Logo" width="160" height="160" style="border-radius: 20px; box-shadow: 0 4px 20px rgba(255, 230, 0, 0.25);" />

# ⚡ SimpleSignal (Universal AI Model Provider)
**Broadcast Every Local & Cloud AI Model Directly Into VS Code Native UI**

[![Version](https://img.shields.io/badge/version-1.0.0-yellow.svg)](https://github.com/falabellamichael/SimpleSignal-VS-Code-Extension)
[![VS Code](https://img.shields.io/badge/VS%20Code-^1.90.0-007ACC.svg?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Local AI](https://img.shields.io/badge/Local%20AI-Lemonade%20%7C%20LM%20Studio%20%7C%20Ollama-green.svg)](https://lemonade-server.ai)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

*Zero external webviews. Zero clunky iframes. 100% native VS Code Language Model API integration.*

---

</div>

## 🌟 What is SimpleSignal?

**SimpleSignal** bridges all your local AI servers (**Lemonade**, **LM Studio**, **Ollama**, **vLLM**) and cloud APIs (**DashScope/Qwen**, **DeepSeek**, **OpenAI**, **Anthropic**, **Gemini**, **Groq**, **OpenRouter**) directly into Visual Studio Code's native user interface.

Instead of switching between separate sidebar webviews (like Continue or Cline), SimpleSignal feeds every model straight into:
- 💬 **Native VS Code Chat Panel** (`Ctrl+Alt+I` / `Ctrl+Shift+I`)
- ✍️ **Editor Inline Chat** (`Ctrl+I` directly inside code files)
- 🖥️ **Terminal Inline Chat** (`Ctrl+I` in the integrated terminal)
- 🛠️ **Native Agent Tools** (autonomous file edits, multi-file refactoring, diagnostics, and search)

---

## ⚡ Key Highlights

### 1. 🔄 Auto-Fetch & Auto-Fill JSON Engine
- Automatically probes active local servers on startup:
  - 🍋 **Lemonade Server** (`http://127.0.0.1:9000` / `13305`)
  - 🧪 **LM Studio** (`http://127.0.0.1:1234`)
  - 🦙 **Ollama** (`http://127.0.0.1:11434`)
  - ⚡ **LocalAI / vLLM** (`http://127.0.0.1:8000`)
- Auto-queries `/v1/models` and `/api/tags` on all configured endpoints.
- **Fills your `settings.json`** with all discovered models, context lengths, and capability badges (Vision, Tools).

### 2. 🧠 Native Function Calling & Tool Execution
- Supports full **Tool / Function Calling** for local models (`qwen3.5-4B-super-coder`, `gemma-4-E2B-it-GGUF`, `DeepSeek V4`, etc.).
- VS Code agents can autonomously read files, execute terminal commands, and perform edits directly through your local models.

### 3. 💭 Thinking / Reasoning Stream
- Native streaming support for reasoning models (`DeepSeek R1/V4`, `Qwen Thinking`, `o1/o3-mini`).
- Renders thinking thoughts in distinct blocks before the final code response.

### 4. 🎨 Minimal Dark Neon Theme Integration
- Dynamically inherits your active VS Code theme tokens (`--vscode-focusBorder`, `--vscode-editor-background`).
- Includes a dedicated **Activity Bar Sidebar Hub** (`$(sparkle)`) and an interactive **Visual Hub Dashboard** with live search and connectivity testing.

---

## 🚀 Quick Start Guide

### 1. Install & Reload
Install the extension and reload VS Code (`Ctrl+Shift+P` > **Developer: Reload Window**).

### 2. Select Your Model
1. Open native VS Code Chat (`Ctrl+Alt+I`).
2. Click the model dropdown selector at the bottom of the chat box.
3. Select **"Manage Models..."** and enable **SimpleSignal (Universal Models)**.
4. Pick any model from your active endpoints!

---

## ⚙️ Configuration (`settings.json`)

Configure your endpoints under `simplesignal.endpoints` in `settings.json`:

```json
{
  "simplesignal.autoScanLocalServers": true,
  "simplesignal.autoFetchOnStartup": true,
  "simplesignal.endpoints": [
    {
      "name": "Lemonade Local Server",
      "baseUrl": "http://127.0.0.1:9000/api/v1",
      "apiKey": "lemonade",
      "protocol": "lemonade",
      "enabled": true
    },
    {
      "name": "DashScope Qwen Cloud API",
      "baseUrl": "https://ws-nbf643rp7g7xmf6j.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      "apiKey": "YOUR_API_KEY",
      "protocol": "openai",
      "enabled": true
    },
    {
      "name": "DeepSeek Official API",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "YOUR_DEEPSEEK_KEY",
      "protocol": "openai",
      "enabled": true
    },
    {
      "name": "Ollama Local Server",
      "baseUrl": "http://127.0.0.1:11434",
      "protocol": "ollama",
      "enabled": true
    }
  ]
}
```

---

## ⌨️ Command Palette (`Ctrl+Shift+P`)

| Command | Description |
|---|---|
| `SimpleSignal: Auto-Fetch All Models & Update JSON` | Probes all endpoints, queries `/v1/models`, and writes models to `settings.json` |
| `SimpleSignal: Open Visual Hub Dashboard` | Opens the interactive Webview dashboard with live model search & test |
| `SimpleSignal: Manage & Add Endpoints` | QuickPick menu to add, toggle, or delete API endpoints |
| `SimpleSignal: Test All Endpoint Connections` | Tests connectivity and latency for all configured endpoints |
| `SimpleSignal: Open Endpoints JSON Configuration` | Opens your `settings.json` configuration directly |

---

## 📄 License
MIT License. Created for ultimate developer freedom and local AI privacy.
