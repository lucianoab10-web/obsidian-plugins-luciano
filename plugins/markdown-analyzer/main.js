/* Obsidian Markdown Analyzer Plugin */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var main_exports = {};
__export(main_exports, {
  default: () => MarkdownAnalyzerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE = "md-analyzer-panel";
var DEFAULT_SETTINGS = {
  geminiApiKey: "",
  model: "gemini-3.5-flash",
  reviewLanguage: "Spanish",
  saveFolder: "Analisis"
};

var MarkdownAnalyzerView = class extends import_obsidian.ItemView {
  constructor(leaf, settings, app) {
    super(leaf);
    this.currentNoteName = "";
    this.currentReview = "";
    this.currentFocus = "";
    this.settings = settings;
    this.app = app;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Markdown Analyzer";
  }
  getIcon() {
    return "file-search";
  }
  updateSettings(settings) {
    this.settings = settings;
  }
  onOpen() {
    return __async(this, null, function* () {
      this.renderEmpty();
    });
  }
  renderEmpty() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("paper-review-root");
    this.injectStyles();
    const wrap = root.createDiv({ cls: "pr-wrap" });
    const icon = wrap.createDiv({ cls: "pr-empty-icon" });
    icon.setText("\u2B21");
    const msg = wrap.createDiv({ cls: "pr-empty-msg" });
    msg.createEl("p", {
      text: "Abre una nota Markdown en el vault y haz clic en",
      cls: "pr-empty-line"
    });
    msg.createEl("p", {
      text: "\xABAnalizar nota\xBB",
      cls: "pr-empty-cta"
    });
    msg.createEl("p", {
      text: "para obtener un an\xE1lisis estructurado.",
      cls: "pr-empty-line"
    });
  }
  renderLoading(noteName, focus) {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("paper-review-root");
    this.injectStyles();
    this.currentNoteName = noteName;
    const wrap = root.createDiv({ cls: "pr-wrap" });
    const spinner = wrap.createDiv({ cls: "pr-spinner-wrap" });
    spinner.createDiv({ cls: "pr-spinner" });
    wrap.createEl("p", {
      text: `Analizando \xAB${noteName}\xBB\u2026`,
      cls: "pr-loading-text"
    });
    wrap.createEl("p", {
      text: "Esto puede tomar unos segundos.",
      cls: "pr-loading-sub"
    });
    if (focus) {
      const shown = focus.length > 160 ? focus.slice(0, 160) + "\u2026" : focus;
      wrap.createEl("p", { text: `Enfoque: ${shown}`, cls: "pr-loading-sub" });
    }
  }
  renderReview(noteName, reviewMarkdown, focus) {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("paper-review-root");
    this.injectStyles();
    this.currentNoteName = noteName;
    this.currentReview = reviewMarkdown;
    this.currentFocus = focus || "";
    const wrap = root.createDiv({ cls: "pr-wrap pr-result" });
    const header = wrap.createDiv({ cls: "pr-header" });
    header.createEl("span", { text: noteName, cls: "pr-header-title" });
    const saveBtn = header.createEl("button", {
      text: "Guardar",
      cls: "pr-save-btn"
    });
    saveBtn.addEventListener("click", () => this.saveReviewAsNote());
    if (this.currentFocus) {
      const focusBox = wrap.createDiv({ cls: "pr-focus" });
      focusBox.createEl("strong", { text: "Enfoque: " });
      focusBox.appendText(this.currentFocus);
    }
    wrap.createEl("hr", { cls: "pr-divider" });
    const content = wrap.createDiv({ cls: "pr-content" });
    this.renderMarkdownToDiv(reviewMarkdown, content);
    const footer = wrap.createDiv({ cls: "pr-footer" });
    const saveBtnBottom = footer.createEl("button", {
      text: "\u{1F4BE} Guardar como nota",
      cls: "pr-save-btn pr-save-btn-full"
    });
    saveBtnBottom.addEventListener("click", () => this.saveReviewAsNote());
  }
  renderError(message) {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("paper-review-root");
    this.injectStyles();
    const wrap = root.createDiv({ cls: "pr-wrap" });
    wrap.createEl("p", { text: "\u26A0 Error", cls: "pr-error-title" });
    wrap.createEl("p", { text: message, cls: "pr-error-msg" });
  }
  renderMarkdownToDiv(md, container) {
    const lines = md.split("\n");
    let currentParagraph = null;
    for (const line of lines) {
      if (line.startsWith("### ")) {
        currentParagraph = null;
        container.createEl("h3", { text: line.replace("### ", ""), cls: "pr-h3" });
      } else if (line.startsWith("## ")) {
        currentParagraph = null;
        container.createEl("h2", { text: line.replace("## ", ""), cls: "pr-h2" });
      } else if (line.startsWith("# ")) {
        currentParagraph = null;
        container.createEl("h1", { text: line.replace("# ", ""), cls: "pr-h1" });
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        currentParagraph = null;
        const ul = container.createEl("ul", { cls: "pr-ul" });
        ul.createEl("li", { text: line.replace(/^[-*] /, ""), cls: "pr-li" });
      } else if (line.startsWith("**") && line.endsWith("**")) {
        currentParagraph = null;
        container.createEl("strong", { text: line.replace(/\*\*/g, ""), cls: "pr-strong" });
      } else if (line.trim() === "") {
        currentParagraph = null;
      } else {
        if (!currentParagraph) {
          currentParagraph = container.createEl("p", { cls: "pr-p" });
        }
        currentParagraph.appendText(line + " ");
      }
    }
  }
  saveReviewAsNote() {
    return __async(this, null, function* () {
      if (!this.currentReview) {
        new import_obsidian.Notice("No hay revisi\xF3n para guardar.");
        return;
      }
      const safeName = this.currentNoteName.replace(/\.md$/i, "").replace(/[\\/:*?"<>|]/g, "_");
      const focus = (this.currentFocus || "").trim();
      const isFocused = focus.length > 0;
      const focusSlug = focus.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
      const fileName = isFocused ? `${safeName}_analisis_${focusSlug || "enfoque"}.md` : `${safeName}_analisis.md`;
      const folder = this.settings.saveFolder;
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
        try {
          yield this.app.vault.createFolder(folder);
        } catch (e) {}
      }
      const fullPath = folder ? `${folder}/${fileName}` : fileName;
      const noteTitle = isFocused ? `An\xE1lisis: ${this.currentNoteName}` : `An\xE1lisis General: ${this.currentNoteName}`;
      const yamlFocus = focus.replace(/\s+/g, " ").replace(/"/g, '\\"');
      const focusLine = isFocused ? `focus: "${yamlFocus}"\n` : "";
      const focusQuote = isFocused ? `> **Enfoque:** ${focus.replace(/\s*\n\s*/g, " ")}\n\n` : "";
      const noteContent = `---
title: "${noteTitle}"
source: "${this.currentNoteName}"
${focusLine}date: ${new Date().toISOString().split("T")[0]}
tags: [${isFocused ? "analysis" : "review"}, ai-generated]
---

# ${noteTitle}

${focusQuote}${this.currentReview}
`;
      const existing = this.app.vault.getAbstractFileByPath(fullPath);
      if (existing && existing instanceof import_obsidian.TFile) {
        yield this.app.vault.modify(existing, noteContent);
        new import_obsidian.Notice(`\u2705 Nota actualizada: ${fullPath}`);
      } else {
        yield this.app.vault.create(fullPath, noteContent);
        new import_obsidian.Notice(`\u2705 Nota guardada: ${fullPath}`);
      }
      const newFile = this.app.vault.getAbstractFileByPath(fullPath);
      if (newFile instanceof import_obsidian.TFile) {
        yield this.app.workspace.openLinkText(fullPath, "", false);
      }
    });
  }
  injectStyles() {
    const oldStyle = document.getElementById("md-analyzer-styles");
    if (oldStyle) oldStyle.remove();
    const styleId = "md-analyzer-styles-v2";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.paper-review-root { height: 100%; overflow-y: auto; font-family: var(--font-text, Georgia, serif); }
.pr-wrap { padding: 20px 18px; display: flex; flex-direction: column; min-height: 100%; }
.pr-empty-icon { font-size: 48px; text-align: center; margin-bottom: 20px; opacity: 0.18; color: var(--text-normal); font-family: monospace; }
.pr-empty-msg { text-align: center; }
.pr-empty-line { font-size: 13px; color: var(--text-muted); margin: 2px 0; line-height: 1.5; }
.pr-empty-cta { font-size: 14px; font-weight: 600; color: var(--text-normal); margin: 6px 0; letter-spacing: 0.01em; }
.pr-spinner-wrap { display: flex; justify-content: center; margin-bottom: 16px; margin-top: 24px; }
.pr-spinner { width: 32px; height: 32px; border: 3px solid var(--background-modifier-border); border-top-color: var(--interactive-accent); border-radius: 50%; animation: pr-spin 0.9s linear infinite; }
@keyframes pr-spin { to { transform: rotate(360deg); } }
.pr-loading-text { text-align: center; font-size: 14px; color: var(--text-normal); font-weight: 500; margin: 0 0 6px; word-break: break-word; }
.pr-loading-sub { text-align: center; font-size: 12px; color: var(--text-muted); margin: 0; }
.pr-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.pr-header-title { font-size: 12px; color: var(--text-muted); font-family: var(--font-monospace, monospace); word-break: break-word; flex: 1; line-height: 1.4; }
.pr-save-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 5px; padding: 5px 11px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: opacity 0.15s; font-family: var(--font-interface, sans-serif); }
.pr-save-btn:hover { opacity: 0.85; }
.pr-save-btn-full { width: 100%; margin-top: 4px; padding: 9px; font-size: 13px; border-radius: 6px; }
.pr-divider { border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 16px; }
.pr-content { flex: 1; }
.pr-h1 { font-size: 16px; font-weight: 700; margin: 18px 0 8px; color: var(--text-normal); line-height: 1.3; }
.pr-h2 { font-size: 14px; font-weight: 700; margin: 16px 0 6px; color: var(--text-normal); letter-spacing: 0.01em; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 3px; }
.pr-h3 { font-size: 13px; font-weight: 600; margin: 12px 0 4px; color: var(--text-normal); }
.pr-p { font-size: 13px; line-height: 1.65; color: var(--text-normal); margin: 0 0 10px; }
.pr-ul { padding-left: 18px; margin: 4px 0 10px; }
.pr-li { font-size: 13px; line-height: 1.6; color: var(--text-normal); margin-bottom: 3px; }
.pr-strong { display: block; font-size: 13px; font-weight: 600; margin: 8px 0 4px; color: var(--text-normal); }
.pr-footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border); }
.pr-focus { font-size: 12px; line-height: 1.5; color: var(--text-muted); background: var(--background-secondary); border-left: 3px solid var(--interactive-accent); border-radius: 3px; padding: 6px 10px; margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; }
.pr-error-title { font-size: 15px; font-weight: 700; color: var(--text-error, #e55); margin: 0 0 8px; }
.pr-error-msg { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
    `;
    document.head.appendChild(style);
  }
  onClose() {
    return __async(this, null, function* () {});
  }
};

var FocusModal = class extends import_obsidian.Modal {
  constructor(app, fileName, onDone) {
    super(app);
    this.fileName = fileName;
    this.onDone = onDone;
    this.submitted = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Analizar Nota");
    const fileLine = contentEl.createEl("p", { text: this.fileName });
    fileLine.style.fontFamily = "var(--font-monospace, monospace)";
    fileLine.style.fontSize = "12px";
    fileLine.style.color = "var(--text-muted)";
    fileLine.style.wordBreak = "break-word";
    contentEl.createEl("p", {
      text: "\xBFEn qu\xE9 concepto, idea o aspecto quieres que se enfoque el an\xE1lisis? D\xE9jalo vac\xEDo para una revisi\xF3n general."
    });
    this.inputEl = contentEl.createEl("textarea", {
      attr: {
        rows: "6",
        placeholder: "Ej.: Extrae los argumentos principales sobre X y comp\xE1ralos con la postura de Y..."
      }
    });
    this.inputEl.style.width = "100%";
    this.inputEl.style.minHeight = "120px";
    this.inputEl.style.resize = "vertical";
    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) {
        evt.preventDefault();
        this.submit();
      }
    });
    const hint = contentEl.createEl("p", { text: "Ctrl/Cmd + Enter para analizar" });
    hint.style.fontSize = "11px";
    hint.style.color = "var(--text-faint)";
    hint.style.margin = "4px 0 0";
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = buttons.createEl("button", { text: "Cancelar" });
    cancelBtn.addEventListener("click", () => this.close());
    const goBtn = buttons.createEl("button", { text: "Analizar", cls: "mod-cta" });
    goBtn.addEventListener("click", () => this.submit());
    setTimeout(() => this.inputEl.focus(), 0);
  }
  submit() {
    this.submitted = true;
    const value = this.inputEl.value.trim();
    this.close();
    this.onDone(value);
  }
  onClose() {
    this.contentEl.empty();
    if (!this.submitted) {
      this.onDone(null);
    }
  }
};

var MarkdownAnalyzerPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.panelView = null;
  }
  onload() {
    return __async(this, null, function* () {
      yield this.loadSettings();
      this.registerView(VIEW_TYPE, (leaf) => {
        this.panelView = new MarkdownAnalyzerView(leaf, this.settings, this.app);
        return this.panelView;
      });
      this.addRibbonIcon("file-search", "Analizar nota", () => __async(this, null, function* () {
        yield this.analyzeMarkdown();
      }));
      this.addCommand({
        id: "analyze-markdown",
        name: "Analizar nota abierta",
        callback: () => __async(this, null, function* () {
          yield this.analyzeMarkdown();
        })
      });
      this.addSettingTab(new MarkdownAnalyzerSettingTab(this.app, this));
    });
  }
  askFocus(fileName) {
    return new Promise((resolve) => {
      new FocusModal(this.app, fileName, resolve).open();
    });
  }
  analyzeMarkdown() {
    return __async(this, null, function* () {
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) {
        new import_obsidian.Notice("\u26A0 No hay ning\xFAn archivo abierto.");
        return;
      }
      if (activeFile.extension.toLowerCase() !== "md") {
        new import_obsidian.Notice("\u26A0 El archivo activo no es un Markdown. Abre una nota primero.");
        return;
      }
      if (!this.settings.geminiApiKey) {
        new import_obsidian.Notice("\u26A0 Configura tu API key de Google (Gemini) en la configuraci\xF3n del plugin.");
        return;
      }
      const focus = yield this.askFocus(activeFile.name);
      if (focus === null) return;
      
      yield this.activatePanel();
      if (!this.panelView) {
        new import_obsidian.Notice("No se pudo abrir el panel.");
        return;
      }
      this.panelView.renderLoading(activeFile.name, focus);
      
      let noteText = "";
      try {
        noteText = yield this.app.vault.read(activeFile);
      } catch (e) {
        this.panelView.renderError("No se pudo extraer el texto de la nota.");
        return;
      }
      
      if (!noteText || noteText.trim().length < 20) {
        this.panelView.renderError("La nota parece estar vac\xEDa.");
        return;
      }
      
      let review = "";
      try {
        review = yield this.callGemini(noteText, activeFile.name, focus);
      } catch (e) {
        this.panelView.renderError(
          `Error al contactar Gemini: ${e.message || "Error desconocido"}.`
        );
        return;
      }
      this.panelView.renderReview(activeFile.name, review, focus);
    });
  }
  activatePanel() {
    return __async(this, null, function* () {
      const { workspace } = this.app;
      const existing = workspace.getLeavesOfType(VIEW_TYPE);
      if (existing.length > 0) {
        workspace.revealLeaf(existing[0]);
        this.panelView = existing[0].view;
        return;
      }
      const leaf = workspace.getRightLeaf(false);
      if (leaf) {
        yield leaf.setViewState({ type: VIEW_TYPE, active: true });
        workspace.revealLeaf(leaf);
        this.panelView = leaf.view;
      }
    });
  }
  callGemini(noteText, fileName, focus) {
    return __async(this, null, function* () {
      const maxChars = 12e4;
      const trimmedText = noteText.length > maxChars ? noteText.slice(0, maxChars) + "\n\n[Texto truncado por longitud]" : noteText;
      const lang = this.settings.reviewLanguage;
      
      let systemPrompt = `You are an expert analytical assistant. Your task is to provide structured, critical, and constructive analysis of text documents. Write the review in ${lang}. Be rigorous and well-organized. Use clear section headers with Markdown (##). Do not hallucinate information that is not in the text.`;
      
      let userPrompt = `Analyze the following markdown document and produce a structured summary with these sections:

## Resumen principal
A 2\u20133 sentence summary of what the document is about.

## Puntos clave
What are the main ideas, arguments or data presented?

## Estructura y flujo
How is the information organized?

## Conclusiones destacadas
What are the final takeaways or action items?

---
Note filename: ${fileName}

Note text:
${trimmedText}`;
      
      const focusText = (focus || "").trim();
      if (focusText) {
        systemPrompt = `You are an expert analytical assistant. The user gives you a document and a specific instruction/focus. Your task is to produce a precise, well-organized synthesis of what the document says about that focus, strictly following the instruction. Write the analysis in ${lang}. Use clear section headers with Markdown (##). Rely only on the text provided: do not hallucinate, and clearly separate what the document explicitly states from your own interpretation.`;
        
        userPrompt = `The user wants a specific, focused analysis of the document below.

User's instruction/focus:
"""
${focusText}
"""

Produce a synthesis centered exclusively on that focus. Ignore parts of the document that are unrelated. Use these section headers (translate them into ${lang} if needed):

## Enfoque analizado
Restate in 1\u20132 sentences what the analysis is targeting.

## An\xE1lisis seg\xFAn instrucci\xF3n
Address the user's focus directly using the document's content.

## Detalles y evidencia
Where applicable, list specific points, arguments, or examples from the text that support the analysis.

## Observaciones adicionales
Any gaps, tensions, or missing information in the text regarding this specific focus.

---
Note filename: ${fileName}

Note text:
${trimmedText}`;
      }
      
      const primary = (this.settings.model || DEFAULT_SETTINGS.model).trim().replace(/^models\//, "");
      const fallbackModel = "gemini-3.1-flash-lite";
      const candidates = primary === fallbackModel ? [primary] : [primary, fallbackModel];
      const retryable = [429, 500, 503, 504];
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const requestBody = JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
      });
      
      let response = null;
      let model = primary;
      for (let i = 0; i < candidates.length; i++) {
        model = candidates[i];
        for (let attempt = 0; attempt < 3; attempt++) {
          response = yield (0, import_obsidian.requestUrl)({
            url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            method: "POST",
            headers: {
              "x-goog-api-key": this.settings.geminiApiKey,
              "Content-Type": "application/json"
            },
            body: requestBody,
            throw: false
          });
          if (!retryable.includes(response.status)) break;
          if (attempt < 2) yield sleep(3e3 * (attempt + 1));
        }
        const canFallback = retryable.includes(response.status) || response.status === 404;
        if (response.status === 200 || !canFallback) break;
      }
      
      let data = {};
      try { data = response.json || {}; } catch (e) { data = {}; }
      const apiMsg = data.error && data.error.message ? data.error.message : response.text || "sin detalle";
      
      if (response.status !== 200 || data.error) {
        throw new Error(`(${response.status}) ${apiMsg}`);
      }
      const candidate = data.candidates && data.candidates[0];
      const parts = candidate && candidate.content && candidate.content.parts || [];
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
      return text;
    });
  }
  loadSettings() {
    return __async(this, null, function* () {
      const saved = (yield this.loadData()) || {};
      this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    });
  }
  saveSettings() {
    return __async(this, null, function* () {
      yield this.saveData(this.settings);
      if (this.panelView) {
        this.panelView.updateSettings(this.settings);
      }
    });
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
};

var MarkdownAnalyzerSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Markdown Analyzer \u2014 Configuraci\xF3n" });
    
    new import_obsidian.Setting(containerEl).setName("API Key de Google (Gemini)").setDesc("Cl\xE1vala en Google AI Studio.").addText(
      (text) => text.setPlaceholder("AIza...").setValue(this.plugin.settings.geminiApiKey).onChange((value) => __async(this, null, function* () {
        this.plugin.settings.geminiApiKey = value.trim();
        yield this.plugin.saveSettings();
      }))
    );
    new import_obsidian.Setting(containerEl).setName("Modelo").addText(
      (text) => text.setPlaceholder("gemini-3.5-flash").setValue(this.plugin.settings.model).onChange((value) => __async(this, null, function* () {
        this.plugin.settings.model = value.trim();
        yield this.plugin.saveSettings();
      }))
    );
    new import_obsidian.Setting(containerEl).setName("Idioma del an\xE1lisis").addDropdown(
      (drop) => drop.addOption("Spanish", "Espa\xF1ol").addOption("English", "English").setValue(this.plugin.settings.reviewLanguage).onChange((value) => __async(this, null, function* () {
        this.plugin.settings.reviewLanguage = value;
        yield this.plugin.saveSettings();
      }))
    );
    new import_obsidian.Setting(containerEl).setName("Carpeta para guardar an\xE1lisis").addText(
      (text) => text.setPlaceholder("Analisis").setValue(this.plugin.settings.saveFolder).onChange((value) => __async(this, null, function* () {
        this.plugin.settings.saveFolder = value.trim();
        yield this.plugin.saveSettings();
      }))
    );
  }
};