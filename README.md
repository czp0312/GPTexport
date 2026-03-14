# GPT Export

Chrome 扩展（MV3），一键导出 ChatGPT / Gemini / Bing Chat / Copilot 对话为 JSON / Markdown / PDF。

## 功能

- 弹窗内预览对话列表，勾选后按格式导出
- 三种导出格式，按钮色彩编码一目了然：
  - **JSON**（琥珀色）— 结构化数据，方便程序处理
  - **Markdown**（绿色）— 保留标题、代码块、表格、数学公式
  - **PDF**（玫红色）— 打开预览页自动生成并下载
- 页面右下角浮动「导出」按钮，无需点击扩展图标
- 全选 / 清除一键操作
- 设置页：默认格式、文件名前缀、站点开关

## 支持的网站

| 平台 | 域名 | 角色识别 |
|------|------|----------|
| ChatGPT | `chatgpt.com` / `chat.openai.com` | 用户 / 助手 |
| Google Gemini | `gemini.google.com` | 用户 / 助手 |
| Bing Chat | `www.bing.com` | — |
| Microsoft Copilot | `copilot.microsoft.com` | — |

## 安装

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目根目录

## 使用

1. 打开上述任一对话页面
2. 点击右下角浮动按钮或工具栏扩展图标
3. 在弹窗中勾选要导出的对话
4. 点击对应格式按钮：
   - **JSON / Markdown**：直接下载文件
   - **PDF**：自动打开预览标签页，生成后自动下载

## 项目结构

```
GPTexport/
├── manifest.json                # MV3 扩展配置
├── src/
│   ├── background.js            # Service Worker：打开弹窗窗口
│   ├── content.js               # 内容脚本：对话提取 + 浮动按钮
│   ├── popup.js                 # 弹窗逻辑：选择 + 导出 JSON/MD/PDF
│   ├── pdf_preview.js           # PDF 预览页：html2pdf 生成 + 下载
│   └── options.js               # 设置页逻辑
├── pages/
│   ├── popup.html               # 弹窗 UI（360×540）
│   ├── pdf_preview.html         # PDF 预览页
│   └── options.html             # 设置页
├── vendor/
│   └── html2pdf.bundle.min.js   # PDF 生成库（动态加载）
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 技术要点

**对话提取**
- ChatGPT：通过 `data-message-author-role` 属性识别角色，`.markdown` 容器提取富文本
- Gemini：优先匹配 `model-response` / `user-query` 自定义元素，回退到 `[role="article"]` 并过滤侧边栏
- 提取失败时自动重试（最多 10 次，间隔 800ms）

**PDF 导出**
- 弹窗点击 PDF 按钮 → 对话数据存入 `chrome.storage.local` → 打开 `pdf_preview.html` 新标签页
- 预览页自动加载 html2pdf.js，渲染后生成 A4 尺寸 PDF 并触发下载
- 在完整视口中渲染，避免弹窗小窗口导致的 html2canvas 空白问题

**Markdown 转换**
- `popup.js` 内置 HTML→Markdown 引擎（~200 行），支持：标题、加粗/斜体、代码块（带语言标记）、有序/无序列表（嵌套）、表格、引用、链接、图片
- KaTeX / MathJax 公式自动提取为 `$...$` / `$$...$$` 格式

**编码约定**
- JS 文件保持 ASCII-only（中文用 `\uXXXX`），HTML 用 HTML entities

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` + `scripting` | 读取当前页面对话内容 |
| `storage` | 传递 PDF 任务数据、保存设置 |

所有数据在本地处理，不上传任何服务器。

## 设计

暖色调 + 靛蓝品牌色，色彩服务于信息传达：

| 元素 | 配色 | 色值 |
|------|------|------|
| 品牌 / 强调 | 靛蓝 | `#4f46e5` |
| 背景 | 暖石灰 | `#fafaf9` |
| JSON 按钮 | 琥珀 | `#b45309` on `#fffbeb` |
| Markdown 按钮 | 翡翠 | `#047857` on `#ecfdf5` |
| PDF 按钮 | 玫红 | `#be123c` on `#fff1f2` |
| 用户角色 | 靛蓝 | `#4f46e5` on `#eef2ff` |
| 助手角色 | 青绿 | `#0d9488` on `#f0fdfa` |

浮动按钮为靛蓝胶囊形，悬停时上浮并加深阴影。

## 常见问题

**弹窗显示「未检测到对话内容」**
刷新对话页面后重试。首次加载时扩展会自动重试提取。

**PDF 第一页空白或包含无关内容**
可能是网站 DOM 变更导致提取到了导航元素。请更新到最新版本。

**对话很长，导出较慢**
建议减少勾选条目数量，分批导出。

## License

MIT
