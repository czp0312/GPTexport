# GPT 对话导出工具（Chrome 扩展）

将 ChatGPT / Gemini / Bing Chat / Copilot 等页面中的对话，按需导出为 `.json` / `.md` / 高质量 `.pdf`。

## 功能

- 可视化弹窗：对话列表预览 + 复选框选择
- 一键：全选 / 取消全选
- 导出格式：JSON / Markdown / PDF
- 页面右下角浮动“导出”按钮（不必点扩展图标也能打开弹窗）
- PDF：优先走 Chromium 打印引擎（更稳的分页/字体/公式），自动下载，不弹打印对话框

## 安装（开发者模式）

1. 打开 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”，选择本项目根目录（包含 `manifest.json`）

## 使用

1. 打开支持的网站对话页面
2. 点击右下角“导出”按钮或工具栏扩展图标
3. 在弹窗中勾选要导出的对话
4. 点击导出按钮：
   - 导出 JSON：直接下载
   - 导出 MD：直接下载
   - 导出 PDF：打开一个新的 `PDF 预览` 标签页，在预览页点击“高质量下载（推荐）”生成并下载

### PDF 导出说明（重要）

- “高质量下载（推荐）”使用 `chrome.debugger` 调用 Chromium DevTools Protocol 的 `Page.printToPDF`。
- Chrome 可能会提示“此扩展正在调试此浏览器/标签页”，属于正常现象。
- 如果高质量路径失败（例如该标签页已被其它调试器占用），预览页会显示“快速下载”（备用方案，可能仍有分页/字体细节瑕疵）。

## 支持的网站

- ChatGPT：`chat.openai.com` / `chatgpt.com`
- Google Gemini：`gemini.google.com`
- Bing Chat：`www.bing.com/chat`
- Microsoft Copilot：`copilot.microsoft.com`

## 权限与安全

- 扩展只在你访问的支持站点运行（见 `host_permissions`）。
- 不会把对话内容上传到任何服务器；导出在本地完成。
- 主要权限：
  - `activeTab` / `scripting`：读取并提取当前页面可见对话、注入临时打印 DOM
  - `downloads`：下载导出文件
  - `storage`：传递 PDF 导出任务、保存设置
  - `debugger`：用于高质量 PDF（`Page.printToPDF`）

## 常见问题

- **弹窗显示“未检测到对话内容”**：刷新页面后重试；页面首次加载时会自动重试提取。
- **高质量 PDF 失败**：可能被其它调试器占用；预览页会提供“快速下载”备用按钮。
- **对话很长导出慢**：建议减少勾选条目数量分批导出。

## 项目结构

```
GPTexport/
├── manifest.json              # 扩展配置（MV3）
├── README.md                  # 使用说明（本文件）
├── src/
│   ├── background.js          # 后台 Service Worker（打开 popup 等）
│   ├── content.js             # 内容脚本：检测/提取对话 + 注入右下角“导出”按钮
│   ├── popup.js               # 弹窗逻辑：对话选择 + 导出 JSON/MD/PDF
│   ├── pdf_preview.js         # PDF：优先 Chromium 打印引擎，失败才备用 html2pdf
│   └── options.js             # 选项页逻辑
├── pages/
│   ├── popup.html             # 扩展弹窗 UI
│   ├── pdf_preview.html       # PDF 预览/下载页（单独标签页，不影响聊天页面）
│   └── options.html           # 选项页 UI
├── vendor/
│   └── html2pdf.bundle.min.js # 备用 PDF 方案依赖（仅在需要时动态加载）
└── icons/                     # 扩展图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

