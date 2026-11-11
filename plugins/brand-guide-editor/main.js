var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/core.cjs
var require_core = __commonJS({
  "src/core.cjs"(exports2, module2) {
    var COLORS2 = [
      ["primary", "Primario", "Portada, t\xEDtulos, elementos clave"],
      ["secondary", "Secundario", "Subt\xEDtulos, \xEDconos, apoyo"],
      ["accent", "Acento", "Resaltar cifras y llamadas a la acci\xF3n"],
      ["background_light", "Fondo claro", "Diapositivas de contenido"],
      ["background_dark", "Fondo oscuro", "Portada y separadores"],
      ["text", "Texto", "Cuerpo de texto"]
    ];
    var FIELDS2 = [
      ["name", "Nombre de la marca / proyecto", "Identidad"],
      ["purpose", "Qu\xE9 hace y para qui\xE9n", "Identidad"],
      ["personality", "Personalidad (3 adjetivos)", "Identidad"],
      ["colorRules", "Reglas de color", "Colores"],
      ["heading", "T\xEDtulos", "Tipograf\xEDa"],
      ["body", "Cuerpo", "Tipograf\xEDa"],
      ["fallback", "Alternativa si la fuente no est\xE1 disponible", "Tipograf\xEDa"],
      ["logo", "Archivo", "Logo"],
      ["logoPosition", "D\xF3nde va", "Logo"],
      ["logoSpace", "Espacio libre y versiones", "Logo"],
      ["logoNever", "Nunca", "Logo"],
      ["style", "Direcci\xF3n general", "Estilo visual"],
      ["shapes", "Formas y bordes", "Estilo visual"],
      ["images", "Im\xE1genes", "Estilo visual"],
      ["icons", "\xCDconos e ilustraciones", "Estilo visual"],
      ["backgrounds", "Fondos", "Estilo visual"],
      ["voice", "Idioma y tratamiento", "Tono de voz"],
      ["vocabulary", "Vocabulario", "Tono de voz"]
    ];
    var PRESETS2 = {
      "Editorial azul": ["#2543A5", "#64748B", "#D97706", "#F8FAFC", "#15234B", "#172033"],
      "Natural": ["#25634B", "#6B8064", "#B95931", "#FAF8F1", "#16392D", "#26342B"],
      "Ciruela": ["#69356D", "#86658A", "#C85038", "#FCF8FC", "#321D36", "#332636"],
      "Monocromo": ["#202020", "#666666", "#404040", "#FFFFFF", "#141414", "#202020"]
    };
    function empty() {
      return { colors: {}, colorNames: {}, colorUses: {}, extra: "", rules: "", avoid: "", frontmatter: "", sizes: null, ...Object.fromEntries(FIELDS2.map(([k]) => [k, ""])) };
    }
    function clean(value) {
      const s = String(value ?? "").trim();
      return !s || /^\(?ej\.:/i.test(s) || /^\((fuente y peso|minimalista)/i.test(s) || /#______/.test(s) ? "" : s;
    }
    function normalizeHex(s) {
      return /^#[0-9a-f]{6}$/i.test(s || "") ? s.toUpperCase() : /^#[0-9a-f]{3}$/i.test(s || "") ? "#" + s.slice(1).split("").map((c) => c + c).join("").toUpperCase() : "";
    }
    function parseGuide2(text, parseYaml2) {
      const d = empty();
      let body = text.replace(/^\uFEFF/, "");
      const fm = body.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
      if (fm) {
        d.frontmatter = fm[0].trimEnd();
        body = body.slice(fm[0].length);
      }
      let tokenExtra = "";
      body = body.replace(/```(?:yaml|yml)\s*\r?\n([\s\S]*?)```/g, (whole, raw) => {
        let obj;
        try {
          obj = parseYaml2 ? parseYaml2(raw) : JSON.parse(raw);
        } catch {
          return whole;
        }
        if (!obj?.brand) return whole;
        const b = obj.brand;
        if (b.name !== void 0) d.name = clean(b.name);
        for (const [k] of COLORS2) {
          const c = normalizeHex(b.colors?.[k]);
          if (c) d.colors[k] = c;
        }
        if (b.fonts?.heading !== void 0) d.heading = clean(b.fonts.heading);
        if (b.fonts?.body !== void 0) d.body = clean(b.fonts.body);
        if (b.fonts?.fallback !== void 0) d.fallback = clean(b.fonts.fallback);
        if (b.logo && b.logo !== "logo.png") d.logo = clean(b.logo);
        const rest = structuredClone(obj);
        const rb = rest.brand;
        for (const k of ["name", "logo"]) delete rb[k];
        if (rb.colors) {
          for (const [k] of COLORS2) delete rb.colors[k];
          if (!Object.keys(rb.colors).length) delete rb.colors;
        }
        if (rb.fonts) {
          for (const k of ["heading", "body", "fallback"]) delete rb.fonts[k];
          if (!Object.keys(rb.fonts).length) delete rb.fonts;
        }
        if (!Object.keys(rb).length) delete rest.brand;
        if (Object.keys(rest).length) tokenExtra += (tokenExtra ? "\n\n" : "") + "```yaml\n" + JSON.stringify(rest, null, 2) + "\n```";
        return "";
      });
      let section = "", extra = [];
      for (const line of body.split(/\r?\n/)) {
        const heading = line.match(/^##\s+(?:\d+\.\s*)?(.+?)\s*$/);
        if (heading) {
          section = heading[1].replace(/\s*\(opcional\)/i, "");
          if (!["Identidad", "Colores", "Tipograf\xEDa", "Logo", "Estilo visual", "Reglas de contenido", "Tono de voz", "Evitar", "Tokens", "Notas adicionales"].includes(section)) extra.push(line);
          continue;
        }
        if (!line.trim() || /^# Guía de marca\s*$/.test(line) || /^> Esta nota la lee el plugin/.test(line)) continue;
        const field = line.match(/^\s*(?:-\s*)?\*\*(.+?):\*\*\s*(.*)$/);
        if (field) {
          const item = FIELDS2.find(([, label, sec]) => label === field[1] && sec === section);
          if (item) {
            let v = clean(field[2]);
            if (item[0] === "logo") {
              const m = v.match(/^!\[\[([^\]]+)\]\]/);
              if (m) v = m[1].split("|")[0];
              if (v === "logo.png" && /incrusta aquí/.test(field[2])) v = "";
            }
            d[item[0]] = v;
            continue;
          }
        }
        if (section === "Colores" && /^\|/.test(line)) {
          const cells = line.split("|").slice(1, -1).map((s) => s.trim());
          const item = COLORS2.find(([, label]) => label === cells[0]);
          if (item) {
            const hex = normalizeHex(cells[2]);
            if (hex) {
              d.colors[item[0]] = hex;
              d.colorNames[item[0]] = cells[1];
              d.colorUses[item[0]] = cells[3];
            }
            continue;
          }
          if (cells[0] === "Rol" || /^[-: ]+$/.test(cells[0] || "")) continue;
        }
        if (section === "Tipograf\xEDa" && /^- \*\*Tamaños orientativos\*\*/.test(line)) {
          const m = line.match(/título (\d+)(?:–\d+)? px, subtítulo (\d+)(?:–\d+)? px, cuerpo (\d+)(?:–\d+)? px/);
          if (m && !line.includes("44\u201356")) d.sizes = { heading: +m[1], subtitle: +m[2], body: +m[3] };
          continue;
        }
        if (section === "Reglas de contenido") {
          d.rules += (d.rules ? "\n" : "") + line;
          continue;
        }
        if (section === "Evitar") {
          if (!/^[- ]*\(ej\.:/.test(line)) d.avoid += (d.avoid ? "\n" : "") + line;
          continue;
        }
        extra.push(line);
      }
      d.extra = [extra.join("\n"), tokenExtra].filter(Boolean).join("\n\n");
      return d;
    }
    var oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();
    var cell = (s) => oneLine(s).replace(/\|/g, "&#124;");
    function serialize2(d) {
      let parts = [d.frontmatter || "---\ntipo: guia-de-marca\n---", "# Gu\xEDa de marca"];
      const sections = ["Identidad", "Colores", "Tipograf\xEDa", "Logo", "Estilo visual", "Reglas de contenido", "Tono de voz", "Evitar"];
      for (const sec of sections) {
        const lines = [];
        if (sec === "Colores") {
          const rows = COLORS2.filter(([k]) => normalizeHex(d.colors[k])).map(([k, l, use]) => `| ${l} | ${cell(d.colorNames[k])} | ${normalizeHex(d.colors[k])} | ${cell(d.colorUses[k] || use)} |`);
          if (rows.length) lines.push("| Rol | Nombre | HEX | Uso |", "|---|---|---|---|", ...rows);
        }
        for (const [k, label, s] of FIELDS2) if (s === sec && String(d[k] || "").trim()) {
          const v = k === "logo" ? `![[${oneLine(d[k])}]]` : oneLine(d[k]);
          lines.push(`- **${label}:** ${v}`);
        }
        if (sec === "Tipograf\xEDa" && d.sizes) lines.push(`- **Tama\xF1os orientativos** en una diapositiva de 1280\xD7720 px: t\xEDtulo ${d.sizes.heading} px, subt\xEDtulo ${d.sizes.subtitle} px, cuerpo ${d.sizes.body} px.`);
        if (sec === "Reglas de contenido" && d.rules.trim()) lines.push(d.rules.trim());
        if (sec === "Evitar" && d.avoid.trim()) lines.push(d.avoid.trim());
        if (lines.length) parts.push("## " + sec + "\n" + lines.join("\n"));
      }
      const b = {};
      if (d.name.trim()) b.name = oneLine(d.name);
      const colors = Object.fromEntries(COLORS2.filter(([k]) => normalizeHex(d.colors[k])).map(([k]) => [k, normalizeHex(d.colors[k])]));
      if (Object.keys(colors).length) b.colors = colors;
      const fonts = Object.fromEntries(["heading", "body", "fallback"].filter((k) => d[k].trim()).map((k) => [k, oneLine(d[k])]));
      if (Object.keys(fonts).length) b.fonts = fonts;
      if (d.logo.trim()) b.logo = oneLine(d.logo);
      if (Object.keys(b).length) {
        const lines = ["brand:"];
        for (const [k, v] of Object.entries(b)) {
          if (typeof v === "object") {
            lines.push("  " + k + ":");
            for (const [a, x] of Object.entries(v)) lines.push("    " + a + ": " + JSON.stringify(x));
          } else lines.push("  " + k + ": " + JSON.stringify(v));
        }
        parts.push("## Tokens\n```yaml\n" + lines.join("\n") + "\n```");
      }
      if (d.extra.trim()) parts.push("## Notas adicionales\n" + d.extra.trim().replace(/^## Notas adicionales\s*\n?/, ""));
      return parts.join("\n\n") + "\n";
    }
    function contrast2(a, b) {
      function lum(hex) {
        const rgb = normalizeHex(hex).slice(1).match(/../g).map((x2) => parseInt(x2, 16) / 255).map((x2) => x2 <= 0.04045 ? x2 / 12.92 : ((x2 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      }
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }
    module2.exports = { COLORS: COLORS2, FIELDS: FIELDS2, PRESETS: PRESETS2, empty, parseGuide: parseGuide2, serialize: serialize2, normalizeHex, contrast: contrast2 };
  }
});

// src/main.cjs
var { Plugin, ItemView, Modal, Setting, PluginSettingTab, TFile, MarkdownView, Notice, parseYaml, normalizePath } = require("obsidian");
var { COLORS, FIELDS, PRESETS, parseGuide, serialize, contrast } = require_core();
var TYPE = "brand-guide-editor";
var el = (parent, tag, text, cls) => parent.createEl(tag, { text, cls });
function button(parent, text, action, primary = false) {
  const b = el(parent, "button", text, primary ? "mod-cta" : "");
  b.addEventListener("click", () => Promise.resolve().then(action).catch((e) => new Notice(e.message)));
  return b;
}
var ReviewModal = class extends Modal {
  constructor(view) {
    super(view.app);
    this.view = view;
  }
  onOpen() {
    this.titleEl.setText("Revisar la gu\xEDa antes de guardar");
    this.modalEl.addClass("bge-review");
    el(this.contentEl, "p", "Se omitir\xE1n los campos vac\xEDos. Tus reglas y notas adicionales se conservar\xE1n. Se crear\xE1 una copia de seguridad del archivo anterior.");
    el(this.contentEl, "pre", serialize(this.view.data), "bge-markdown");
    button(this.contentEl, "Guardar gu\xEDa", async () => {
      await this.view.save();
      this.close();
    }, true);
    button(this.contentEl, "Seguir editando", () => this.close());
  }
};
var BrandView = class extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.dirty = false;
    this.file = null;
    this.source = "";
  }
  getViewType() {
    return TYPE;
  }
  getDisplayText() {
    return "Editor de marca";
  }
  getIcon() {
    return "palette";
  }
  async onOpen() {
    this.render();
  }
  async loadGuide(file) {
    if (this.dirty && this.file?.path !== file.path) {
      new Notice("Guarda la gu\xEDa actual o usa \xABRecargar archivo\xBB antes de abrir otra.");
      return;
    }
    if (this.file?.path === file.path) return;
    const source = await this.app.vault.read(file);
    this.file = file;
    this.source = source;
    const draft = this.plugin.settings.drafts[file.path];
    this.data = draft?.source === source ? draft.data : parseGuide(source, parseYaml);
    this.dirty = !!draft && draft.source === source;
    this.render();
    if (draft && draft.source !== source) new Notice("Hay un borrador anterior. El archivo cambi\xF3: se carg\xF3 su versi\xF3n actual; el borrador sigue en los datos del plugin.");
  }
  changed() {
    this.dirty = true;
    this.status.setText("Cambios pendientes \xB7 borrador local");
    this.preview();
    this.plugin.settings.drafts[this.file.path] = { source: this.source, data: structuredClone(this.data) };
    this.plugin.persist();
  }
  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("bge-root");
    el(root, "div", "TU IDENTIDAD, EN CADA DIAPOSITIVA", "bge-eyebrow");
    el(root, "h2", "Estudio de marca");
    if (!this.file) {
      el(root, "p", "Abre tu gu\xEDa de marca y elige \xABEditar gu\xEDa de marca\xBB en la paleta de comandos.");
      return;
    }
    el(root, "p", this.file.path, "bge-path");
    this.status = el(root, "p", this.dirty ? "Cambios pendientes \xB7 borrador local" : "Archivo cargado \xB7 sin cambios", "bge-status");
    const tools = root.createDiv({ cls: "bge-tools" });
    button(tools, "Revisar y guardar", () => new ReviewModal(this).open(), true);
    button(tools, "Recargar archivo", () => {
      const m = new Modal(this.app);
      m.titleEl.setText("Recargar desde el Markdown");
      el(m.contentEl, "p", "Se descartar\xE1n los cambios pendientes del editor visual. El archivo Markdown se conservar\xE1.");
      button(m.contentEl, "Descartar borrador y recargar", async () => {
        const f = this.file;
        delete this.plugin.settings.drafts[f.path];
        await this.plugin.persist();
        this.dirty = false;
        this.file = null;
        await this.loadGuide(f);
        m.close();
      });
      button(m.contentEl, "Volver", () => m.close());
      m.open();
    });
    this.previewBox = root.createDiv({ cls: "bge-preview" });
    this.preview();
    el(root, "p", "Vista ilustrativa 16:9. Los campos sin definir usan un estilo de ejemplo solo aqu\xED. Claude compone cada presentaci\xF3n y puede variar el resultado.", "bge-hint");
    const identity = this.group(root, "Identidad");
    for (const key of ["name", "purpose", "personality"]) this.textField(identity, key);
    const colors = this.group(root, "Colores");
    el(colors, "p", "Activa los colores que quieras incluir o elige una paleta completa.");
    const presets = colors.createDiv({ cls: "bge-presets" });
    for (const [name, values] of Object.entries(PRESETS)) {
      const b = button(presets, name, () => {
        COLORS.forEach(([k], i) => {
          this.data.colors[k] = values[i];
        });
        this.changed();
        this.render();
      });
      const swatches = b.createSpan({ cls: "bge-swatches" });
      values.slice(0, 3).forEach((c) => {
        const dot = swatches.createSpan();
        dot.style.backgroundColor = c;
      });
    }
    COLORS.forEach(([key, label], i) => {
      const row = colors.createDiv({ cls: "bge-color" });
      const check = el(row, "input");
      check.type = "checkbox";
      check.checked = !!this.data.colors[key];
      check.setAttribute("aria-label", "Incluir " + label);
      const picker = el(row, "input");
      picker.type = "color";
      picker.value = this.data.colors[key] || Object.values(PRESETS)[0][i];
      picker.disabled = !check.checked;
      picker.setAttribute("aria-label", label);
      const text = el(row, "span", label);
      const code = el(row, "small", this.data.colors[key] || "Sin definir");
      check.addEventListener("change", () => {
        picker.disabled = !check.checked;
        if (check.checked) this.data.colors[key] = picker.value.toUpperCase();
        else delete this.data.colors[key];
        code.setText(this.data.colors[key] || "Sin definir");
        this.changed();
      });
      picker.addEventListener("input", () => {
        this.data.colors[key] = picker.value.toUpperCase();
        code.setText(this.data.colors[key]);
        this.changed();
      });
    });
    this.textField(colors, "colorRules");
    const fonts = this.group(root, "Tipograf\xEDa");
    el(fonts, "p", "Puedes escribir otra fuente. La vista previa usa las fuentes instaladas; no descarga tipograf\xEDas.");
    for (const key of ["heading", "body", "fallback"]) {
      const row = fonts.createDiv({ cls: "bge-field" });
      const label = el(row, "label", FIELDS.find(([k]) => k === key)[1]);
      const input = el(label, "input");
      input.type = "text";
      input.value = this.data[key];
      input.placeholder = key === "fallback" ? "Arial, sans-serif" : "Selecciona o escribe una fuente";
      input.setAttribute("list", "bge-fonts-" + key);
      const list = el(row, "datalist");
      list.id = "bge-fonts-" + key;
      ["Arial", "Aptos", "Calibri", "Georgia", "Verdana", "Inter", "Montserrat", "Source Sans 3", "Lora"].forEach((f) => {
        const o = el(list, "option");
        o.value = f;
      });
      input.addEventListener("input", () => {
        this.data[key] = input.value;
        this.changed();
      });
    }
    new Setting(fonts).setName("Definir tama\xF1os de texto").addToggle((t) => t.setValue(!!this.data.sizes).onChange((v) => {
      this.data.sizes = v ? { heading: 48, subtitle: 30, body: 24 } : null;
      this.changed();
      this.render();
    }));
    if (this.data.sizes) for (const [key, name, min, max] of [["heading", "T\xEDtulo", 32, 72], ["subtitle", "Subt\xEDtulo", 22, 48], ["body", "Cuerpo", 18, 36]]) new Setting(fonts).setName(name).addSlider((s) => s.setLimits(min, max, 1).setValue(this.data.sizes[key]).setDynamicTooltip().onChange((v) => {
      this.data.sizes[key] = v;
      this.changed();
    }));
    const logo = this.group(root, "Logo");
    new Setting(logo).setName("Imagen del vault").addDropdown((d) => {
      d.addOption("", "Sin logo");
      const files = this.app.vault.getFiles().filter((f) => /^(png|jpe?g|webp|svg|gif)$/i.test(f.extension));
      if (this.data.logo && !files.some((f) => f.path === this.data.logo)) d.addOption(this.data.logo, this.data.logo);
      files.sort((a, b) => a.path.localeCompare(b.path)).forEach((f) => d.addOption(f.path, f.path));
      d.setValue(this.data.logo).onChange((v) => {
        this.data.logo = v;
        this.changed();
      });
    });
    for (const key of ["logoPosition", "logoSpace", "logoNever"]) this.textField(logo, key);
    const style = this.group(root, "Estilo visual");
    for (const key of ["style", "shapes", "images", "icons", "backgrounds"]) this.textField(style, key);
    const rules = this.group(root, "Contenido y voz");
    this.textField(rules, "rules", "Reglas de contenido", true);
    this.textField(rules, "voice");
    this.textField(rules, "vocabulary");
    this.textField(rules, "avoid", "Evitar", true);
    const extra = this.group(root, "Notas adicionales");
    el(extra, "p", "Contenido que no corresponde a los campos anteriores. Se conserva al guardar.");
    this.textField(extra, "extra", "Tus notas", true);
  }
  group(root, title) {
    const d = el(root, "details", void 0, "bge-group");
    d.open = ["Colores", "Identidad"].includes(title);
    el(d, "summary", title);
    return d.createDiv({ cls: "bge-group-body" });
  }
  textField(parent, key, title, multi = false) {
    const row = parent.createDiv({ cls: "bge-field" });
    const label = el(row, "label", title || FIELDS.find(([k]) => k === key)[1]);
    const input = el(label, multi ? "textarea" : "input");
    if (!multi) input.type = "text";
    input.value = this.data[key];
    input.placeholder = "Sin definir \xB7 se omite de la gu\xEDa";
    input.addEventListener("input", () => {
      this.data[key] = input.value;
      this.changed();
    });
  }
  preview() {
    if (!this.previewBox || !this.data) return;
    const p = this.previewBox;
    p.empty();
    const d = this.data, c = d.colors;
    const slide = p.createDiv({ cls: "bge-slide" });
    slide.style.backgroundColor = c.background_light || "#F8FAFC";
    slide.style.color = c.text || "#172033";
    slide.style.fontFamily = d.body || "Arial, sans-serif";
    const tag = el(slide, "span", d.name || "Tu marca", "bge-slide-tag");
    tag.style.color = c.primary || "#2543A5";
    const h = el(slide, "h3", "Una idea que merece ser contada");
    h.style.fontFamily = d.heading || "Arial, sans-serif";
    h.style.color = c.primary || "#2543A5";
    h.style.fontSize = (d.sizes?.heading || 48) / 4 + "cqw";
    const bar = slide.createDiv({ cls: "bge-slide-bar" });
    bar.style.backgroundColor = c.accent || "#D97706";
    const body = el(slide, "p", d.purpose || "El contenido de tus notas, con una identidad consistente.");
    body.style.fontSize = (d.sizes?.body || 24) / 4 + "cqw";
    const secondary = el(slide, "small", "CONTEXTO  /  IDEAS  /  CONCLUSIONES");
    secondary.style.color = c.secondary || "#64748B";
    if (d.logo) {
      const f = this.app.metadataCache.getFirstLinkpathDest(d.logo, this.file.path);
      if (f) {
        const img = el(slide, "img");
        img.src = this.app.vault.getResourcePath(f);
        img.alt = "Logo";
      }
    }
    const dark = p.createDiv({ cls: "bge-dark-swatch" });
    dark.style.backgroundColor = c.background_dark || "#15234B";
    dark.style.color = "#FFFFFF";
    dark.setText("Fondo oscuro");
    if (c.text && c.background_light) {
      const ratio = contrast(c.text, c.background_light);
      el(p, "p", `Contraste texto / fondo claro: ${ratio.toFixed(1)}:1 \xB7 ${ratio >= 4.5 ? "adecuado para texto normal" : "conviene ajustar estos colores"}`, "bge-contrast");
    }
  }
  async save() {
    if (this.saving) throw new Error("Ya se est\xE1 guardando la gu\xEDa.");
    this.saving = true;
    try {
      if (!this.app.vault.getAbstractFileByPath(this.file.path)) throw new Error("El archivo fue movido o eliminado. Abre su nueva ubicaci\xF3n.");
      let editorChanged = false;
      this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
        const v = leaf.view;
        if (v instanceof MarkdownView && v.file?.path === this.file.path && v.editor.getValue() !== this.source) editorChanged = true;
      });
      if (editorChanged) throw new Error("La nota cambi\xF3 en el editor Markdown. Recarga el archivo antes de guardar; tu borrador sigue conservado.");
      const current = await this.app.vault.read(this.file);
      if (current !== this.source) throw new Error("El archivo cambi\xF3 desde que lo abriste. Recarga antes de guardar para conservar esos cambios.");
      const output = serialize(this.data);
      if (output === current) {
        this.dirty = false;
        this.status.setText("Sin cambios que guardar");
        return;
      }
      const folder = normalizePath((this.file.parent?.path || "") + "/Historial de marca");
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const backup = normalizePath(folder + "/" + this.file.basename + "-" + Date.now() + ".md");
      await this.app.vault.create(backup, current);
      await this.app.vault.process(this.file, (latest) => {
        if (latest !== this.source) throw new Error("El archivo cambi\xF3 durante el guardado. No se sobrescribi\xF3.");
        return output;
      });
      this.source = output;
      this.dirty = false;
      delete this.plugin.settings.drafts[this.file.path];
      await this.plugin.persist();
      this.status.setText("Gu\xEDa guardada \xB7 copia de seguridad creada");
      new Notice("Gu\xEDa de marca lista para Deck HTML.");
    } finally {
      this.saving = false;
    }
  }
};
var BrandSettings = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    el(this.containerEl, "h2", "Editor visual de marca");
    new Setting(this.containerEl).setName("Gu\xEDa de marca").setDesc("Ruta dentro del vault. Debe coincidir con \xABArchivo de gu\xEDa de marca\xBB en Deck HTML.").addText((t) => t.setValue(this.plugin.settings.path).onChange(async (v) => {
      this.plugin.settings.path = normalizePath(v.trim());
      await this.plugin.persist();
    }));
    new Setting(this.containerEl).setName("Abrir autom\xE1ticamente").setDesc("Muestra el editor al abrir la gu\xEDa configurada.").addToggle((t) => t.setValue(this.plugin.settings.autoOpen).onChange(async (v) => {
      this.plugin.settings.autoOpen = v;
      await this.plugin.persist();
    }));
  }
};
module.exports = class BrandPlugin extends Plugin {
  async onload() {
    this.settings = { path: "Brand/guia-de-marca.md", autoOpen: true, drafts: {}, ...await this.loadData() };
    this.writeQueue = Promise.resolve();
    this.registerView(TYPE, (leaf) => new BrandView(leaf, this));
    this.addSettingTab(new BrandSettings(this.app, this));
    this.addCommand({ id: "edit-brand", name: "Editar gu\xEDa de marca", callback: () => this.open().catch((e) => new Notice(e.message)) });
    this.addRibbonIcon("palette", "Editar gu\xEDa de marca", () => this.open().catch((e) => new Notice(e.message)));
    this.registerEvent(this.app.workspace.on("file-open", (f) => {
      if (f && this.settings.autoOpen && this.matches(f)) this.open(f, false).catch((e) => new Notice(e.message));
    }));
    this.app.workspace.onLayoutReady(() => {
      const f = this.app.workspace.getActiveFile();
      if (f && this.settings.autoOpen && this.matches(f)) this.open(f, false).catch((e) => new Notice(e.message));
    });
  }
  persist() {
    const snapshot = JSON.parse(JSON.stringify(this.settings));
    this.writeQueue = this.writeQueue.catch(() => {
    }).then(() => this.saveData(snapshot));
    return this.writeQueue.catch(() => new Notice("No se pudo guardar el borrador local. Mant\xE9n abierto el editor y guarda la gu\xEDa."));
  }
  matches(f) {
    return f.path === this.settings.path || this.app.metadataCache.getFileCache(f)?.frontmatter?.tipo === "guia-de-marca";
  }
  async open(file, focus = true) {
    file = file || (this.matches(this.app.workspace.getActiveFile() || {}) ? this.app.workspace.getActiveFile() : this.app.vault.getAbstractFileByPath(this.settings.path));
    if (!(file instanceof TFile) || file.extension !== "md") throw new Error("Crea o abre tu gu\xEDa Markdown primero. Puedes usar \xABDeck HTML: Crear plantilla de gu\xEDa de marca\xBB.");
    let leaf = this.app.workspace.getLeavesOfType(TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) throw new Error("No se pudo abrir el panel.");
      await leaf.setViewState({ type: TYPE, active: focus });
    }
    await leaf.loadIfDeferred?.();
    await leaf.view.loadGuide(file);
    await this.app.workspace.revealLeaf(leaf);
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(TYPE);
  }
};
