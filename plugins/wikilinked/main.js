/*
  Wikilinked — Obsidian plugin (v1.1.0)

  • Enlaza (wikilink o embed) el archivo activo dentro de otra nota, con un clic.
  • NUEVO: reglas de etiqueta → cuando un archivo recibe la etiqueta X, se enlaza
    automáticamente dentro de la nota contenedora que elijas.
  • NUEVO: etiquetas para PDF, imágenes y cualquier archivo que no sea .md.
    Estos archivos no tienen propiedades, así que las etiquetas se guardan en el
    registro del plugin (data.json), siguen al archivo si lo renombras o mueves,
    y se gestionan desde un modal, el menú del archivo o la barra de estado.
*/

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

var main_exports = {};
__export(main_exports, {
  default: () => WikilinkedPlugin
});
module.exports = __toCommonJS(main_exports);

var import_obsidian = require("obsidian");

// ─── Defaults ────────────────────────────────────────────────────────────────

var DEFAULT_SETTINGS = {
  defaultLinkType: "wikilink",
  insertPosition: "end",
  containerTag: "wikilinked",
  showRibbonButton: true,
  favorites: [],
  // Reglas de etiqueta: { id, tag, target, linkType }
  tagRules: [],
  autoLinkEnabled: true,
  showNotices: true,
  // Registro de etiquetas para archivos SIN propiedades (pdf, imágenes, …):
  // { "ruta/archivo.pdf": ["fdg", "minerales"] }
  fileTags: {}
};

// Espera tras un cambio de metadatos antes de evaluar reglas. Evita disparar
// reglas con etiquetas a medio escribir (#f → #fd → #fdg).
var TAG_DEBOUNCE_MS = 1000;
var SAVE_DEBOUNCE_MS = 400;

// ─── Utilidades: etiquetas ───────────────────────────────────────────────────

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHash(tag) {
  return (tag || "").trim().replace(/^#+/, "");
}

/** Para comparar: sin '#', en minúsculas. */
function normalizeTag(tag) {
  return stripHash(tag).toLowerCase();
}

/**
 * Limpia lo que escribe el usuario para dejar una etiqueta válida en Obsidian:
 * sin '#', sin espacios (→ '-'), sin caracteres que rompen YAML/enlaces y que
 * no sea solo números. Devuelve "" si no es válida.
 */
function sanitizeTag(raw) {
  let t = stripHash(String(raw || ""));
  t = t.replace(/[\s,;]+/g, "-")
       .replace(/[#\[\]{}()"'`<>|\\]/g, "")
       .replace(/^[-/]+|[-/]+$/g, "");
  if (!t || /^\d+$/.test(t)) return "";
  return t;
}

function uniqueTags(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const k = normalizeTag(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(stripHash(t));
  }
  return out;
}

/** "fdg, myc pye" → ["fdg", "myc", "pye"] */
function parseTagInput(str) {
  return uniqueTags(String(str || "").split(/[\s,;]+/).map(sanitizeTag).filter(Boolean));
}

/** Convierte el valor de `tags:` del frontmatter (lista o texto) en lista. */
function toTagArray(value) {
  if (Array.isArray(value)) return value.map(v => stripHash(String(v))).filter(Boolean);
  if (typeof value === "string") return value.split(/[\s,]+/).map(stripHash).filter(Boolean);
  return [];
}

/**
 * ¿La etiqueta del archivo satisface la etiqueta de la regla?
 * Igual que la búsqueda de Obsidian: "clases" también coincide con "clases/fdg".
 */
function tagMatches(fileTag, ruleTag) {
  const a = normalizeTag(fileTag);
  const b = normalizeTag(ruleTag);
  return b !== "" && (a === b || a.startsWith(b + "/"));
}

/** Devuelve la ruta nueva si `p` es `oldPath` o está dentro de él; si no, null. */
function remapIfInside(p, oldPath, newPath) {
  if (p === oldPath) return newPath;
  if (p.startsWith(oldPath + "/")) return newPath + p.slice(oldPath.length);
  return null;
}

// ─── Utilidades: enlaces y callout ───────────────────────────────────────────

/**
 * Texto que va dentro de [[ ]]. Notas .md → sin extensión; el resto → con
 * extensión (obligatoria para pdf/imágenes). Si otro archivo del vault se llama
 * igual y Obsidian resolvería el enlace mal, se usa la ruta completa.
 */
function linkTextFor(file, app, sourcePath) {
  const short = file.extension === "md" ? file.basename : file.name;
  if (app) {
    const dest = app.metadataCache.getFirstLinkpathDest(short, sourcePath || "");
    if (dest && dest.path !== file.path) {
      return file.extension === "md" ? file.path.replace(/\.md$/i, "") : file.path;
    }
  }
  return short;
}

function buildLink(file, type, app, sourcePath) {
  const prefix = type === "embed" ? "!" : "";
  return `${prefix}[[${linkTextFor(file, app, sourcePath)}]]`;
}

/**
 * ¿`content` ya enlaza a `file`? Resuelve cada [[enlace]] con Obsidian, así que
 * entiende rutas, alias, #encabezados y enlaces sin extensión. Además distingue
 * bien "fdg1108.md" de "fdg1108.pdf" aunque se llamen igual.
 * Devuelve "none" | "wikilink" | "embed" | "both".
 */
function checkExistingLink(app, content, file, sourcePath) {
  const re = /(!?)\[\[([^\]|#^\n]+?)(?:[#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
  let hasEmbed = false;
  let hasWikilink = false;
  let m;
  while ((m = re.exec(content)) !== null) {
    const dest = app.metadataCache.getFirstLinkpathDest(m[2].trim(), sourcePath || "");
    if (!dest || dest.path !== file.path) continue;
    if (m[1] === "!") hasEmbed = true; else hasWikilink = true;
  }
  if (hasEmbed && hasWikilink) return "both";
  if (hasEmbed) return "embed";
  if (hasWikilink) return "wikilink";
  return "none";
}

function calloutHeaderRe(tag, flags) {
  return new RegExp("^>\\s*\\[!" + escapeRegExp(tag) + "\\]", flags || "i");
}

function getLinksFromCallout(content, tag) {
  const lines = content.split("\n");
  const links = [];
  let inBlock = false;
  const headerRe = calloutHeaderRe(tag);
  for (const line of lines) {
    if (headerRe.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.startsWith(">")) {
        const inner = line.replace(/^>\s?/, "").trim();
        if (inner.length > 0) links.push(inner);
      } else {
        inBlock = false;
      }
    }
  }
  return links;
}

function insertIntoCallout(content, tag, link) {
  const lines = content.split("\n");
  const headerRe = calloutHeaderRe(tag);
  let lastCalloutLine = -1;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      inBlock = true;
      lastCalloutLine = i;
      continue;
    }
    if (inBlock) {
      if (lines[i].startsWith(">")) {
        lastCalloutLine = i;
      } else {
        break;
      }
    }
  }
  if (lastCalloutLine === -1) return content;
  lines.splice(lastCalloutLine + 1, 0, `> ${link}`);
  return lines.join("\n");
}

/** Añade el enlace dentro del callout contenedor si existe; si no, al final. */
function addLinkToContent(content, tag, link) {
  if (calloutHeaderRe(tag, "im").test(content)) return insertIntoCallout(content, tag, link);
  const sep = content === "" || content.endsWith("\n") ? "" : "\n";
  return content + sep + link + "\n";
}

// ─── Selector de notas (solo .md: son las únicas que pueden contener enlaces) ─

var FileSuggestModal = class extends import_obsidian.SuggestModal {
  constructor(app, onChooseCb, excludeFile = null) {
    super(app);
    this.onChooseCb = onChooseCb;
    this.setPlaceholder("Escriba para buscar una nota…");
    this.allFiles = app.vault.getMarkdownFiles()
      .filter((f) => f !== excludeFile)
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }
  getSuggestions(query) {
    const q = query.toLowerCase().trim();
    if (!q) return this.allFiles;
    return this.allFiles.filter(
      (f) => f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }
  renderSuggestion(file, el) {
    el.createEl("span", { text: "📄 " });
    const wrap = el.createEl("div", { cls: "wikilinked-suggestion-text" });
    wrap.createEl("div", { cls: "wikilinked-suggestion-name", text: file.basename });
    wrap.createEl("div", { cls: "wikilinked-suggestion-path", text: file.path });
  }
  onChooseSuggestion(file, _evt) {
    this.onChooseCb(file);
  }
};

// ─── Buscador de archivos etiquetados (PDF, imágenes, …) ─────────────────────

var TaggedFilesModal = class extends import_obsidian.SuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder("Filtra por nombre o etiqueta…");
    const ft = plugin.settings.fileTags;
    this.items = Object.keys(ft)
      .filter((p) => ft[p] && ft[p].length > 0 && plugin.app.vault.getAbstractFileByPath(p) instanceof import_obsidian.TFile)
      .map((p) => ({ path: p, tags: ft[p] }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  getSuggestions(query) {
    const q = query.toLowerCase().trim().replace(/^#/, "");
    if (!q) return this.items;
    return this.items.filter(
      (i) => i.path.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q))
    );
  }
  renderSuggestion(item, el) {
    const ext = item.path.split(".").pop().toLowerCase();
    el.createEl("span", { text: (ext === "pdf" ? "📕" : "🖼️") + " " });
    const wrap = el.createEl("div", { cls: "wikilinked-suggestion-text" });
    wrap.createEl("div", { cls: "wikilinked-suggestion-name", text: item.path.split("/").pop() });
    wrap.createEl("div", { cls: "wikilinked-suggestion-path", text: item.tags.map((t) => "#" + t).join("  ") + "  ·  " + item.path });
  }
  onChooseSuggestion(item, _evt) {
    const f = this.app.vault.getAbstractFileByPath(item.path);
    if (f instanceof import_obsidian.TFile) this.app.workspace.getLeaf(false).openFile(f);
  }
};

// ─── Modal: etiquetar un archivo (md, pdf, imagen, …) ────────────────────────

var TagFileModal = class extends import_obsidian.Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.isMd = file.extension === "md";
    this.stored = plugin.getStoredTags(file);
    this.inline = plugin.getFileTags(file).inline;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("wikilinked-modal");
    contentEl.createEl("h2", { cls: "wikilinked-modal-title", text: "🏷️ Etiquetas" });

    const subtitle = contentEl.createEl("p", { cls: "wikilinked-subtitle" });
    subtitle.createEl("span", { text: "Archivo: " });
    subtitle.createEl("strong", { text: this.file.name });

    contentEl.createEl("p", {
      cls: "wikilinked-hint",
      text: this.isMd
        ? "Las etiquetas se guardan en las propiedades (frontmatter) de la nota."
        : "Este tipo de archivo no tiene propiedades, así que Wikilinked guarda sus etiquetas en su propio registro. Siguen al archivo si lo renombras o lo mueves."
    });

    this.chipsEl = contentEl.createDiv({ cls: "wikilinked-tag-chips" });

    const row = contentEl.createDiv({ cls: "wikilinked-tag-input-row" });
    this.inputEl = row.createEl("input", {
      cls: "wikilinked-tag-input",
      type: "text",
      placeholder: "nueva etiqueta (varias separadas por coma o espacio)"
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit(this.inputEl.value);
      }
    });
    new import_obsidian.ButtonComponent(row)
      .setButtonText("Añadir")
      .setCta()
      .onClick(() => this.submit(this.inputEl.value));

    // Atajos: etiquetas que ya tienen una regla configurada
    const ruleTags = uniqueTags(this.plugin.settings.tagRules.map((r) => r.tag).filter(Boolean));
    if (ruleTags.length > 0) {
      const sec = contentEl.createDiv({ cls: "wikilinked-section" });
      sec.createEl("div", { cls: "wikilinked-section-label", text: "⚡ Etiquetas con regla automática" });
      const grid = sec.createDiv({ cls: "wikilinked-fav-grid" });
      ruleTags.forEach((t) => {
        const btn = grid.createEl("button", { cls: "wikilinked-fav-btn", text: "#" + t });
        btn.addEventListener("click", () => this.submit(t));
      });
    }

    const footer = contentEl.createDiv({ cls: "wikilinked-footer" });
    new import_obsidian.ButtonComponent(footer).setButtonText("Cerrar").onClick(() => this.close());

    this.renderChips();
    setTimeout(() => this.inputEl.focus(), 50);
  }

  renderChips() {
    this.chipsEl.empty();
    if (this.stored.length === 0 && this.inline.length === 0) {
      this.chipsEl.createEl("span", { cls: "wikilinked-fav-empty", text: "Sin etiquetas todavía." });
      return;
    }
    this.stored.forEach((tag) => {
      const chip = this.chipsEl.createDiv({ cls: "wikilinked-tag-chip" });
      chip.createEl("span", { text: "#" + tag });
      const x = chip.createEl("button", { cls: "wikilinked-tag-chip-x", text: "✕", title: "Quitar etiqueta" });
      x.addEventListener("click", async () => {
        this.stored = await this.plugin.removeTag(this.file, tag);
        this.renderChips();
      });
    });
    this.inline.forEach((tag) => {
      this.chipsEl.createDiv({
        cls: "wikilinked-tag-chip wikilinked-tag-chip--inline",
        text: "#" + tag,
        title: "Esta etiqueta está escrita en el cuerpo de la nota; quítala desde el editor."
      });
    });
  }

  async submit(raw) {
    const tags = parseTagInput(raw);
    if (tags.length === 0) {
      if ((raw || "").trim()) {
        new import_obsidian.Notice("⚠️ Etiqueta no válida (no puede ser solo números ni tener caracteres especiales).");
      }
      return;
    }
    try {
      const res = await this.plugin.addTags(this.file, tags);
      this.stored = res.current;
      this.inputEl.value = "";
      this.renderChips();
    } catch (e) {
      new import_obsidian.Notice(`❌ Wikilinked: no se pudo etiquetar. ${e.message}`);
      console.error("Wikilinked tag error:", e);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
};

// ─── Modal principal: enlazar el archivo activo en otra nota ─────────────────

var WikilinkedModal = class extends import_obsidian.Modal {
  constructor(plugin, activeFile) {
    super(plugin.app);
    this.selectedTarget = null;
    this.plugin = plugin;
    this.activeFile = activeFile;
    this.linkType = plugin.settings.defaultLinkType;
    this.insertPos = plugin.settings.insertPosition;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("wikilinked-modal");
    contentEl.createEl("h2", { cls: "wikilinked-modal-title", text: "Wikilinked" });

    const subtitle = contentEl.createEl("p", { cls: "wikilinked-subtitle" });
    subtitle.createEl("span", { text: "Archivo activo: " });
    subtitle.createEl("strong", { text: this.activeFile.name });

    // Acceso rápido a las etiquetas (md, pdf, imágenes…)
    const tagRow = contentEl.createDiv({ cls: "wikilinked-tag-open" });
    new import_obsidian.ButtonComponent(tagRow)
      .setButtonText("🏷️ Etiquetar este archivo…")
      .onClick(() => new TagFileModal(this.plugin, this.activeFile).open());

    const section = (label) => {
      const sec = contentEl.createDiv({ cls: "wikilinked-section" });
      sec.createEl("div", { cls: "wikilinked-section-label", text: label });
      return sec;
    };

    const favs = this.plugin.settings.favorites;
    if (favs.length > 0) {
      const favSec = section("⭐ Notas favoritas");
      const favGrid = favSec.createDiv({ cls: "wikilinked-fav-grid" });
      favs.forEach((fav) => {
        const btn = favGrid.createEl("button", {
          cls: "wikilinked-fav-btn",
          text: fav.label || fav.path.split("/").pop() || fav.path
        });
        const file = this.app.vault.getAbstractFileByPath(fav.path);
        if (file instanceof import_obsidian.TFile && this.selectedTarget === file) {
          btn.addClass("wikilinked-fav-btn--active");
        }
        btn.addEventListener("click", () => {
          const f = this.app.vault.getAbstractFileByPath(fav.path);
          if (!(f instanceof import_obsidian.TFile)) {
            new import_obsidian.Notice(`⚠️ No se encontró: ${fav.path}`);
            return;
          }
          this.selectedTarget = f;
          this.targetNameEl.textContent = f.path;
          this.targetNameEl.addClass("wikilinked-target-selected");
          favGrid.querySelectorAll(".wikilinked-fav-btn").forEach(
            (b) => b.removeClass("wikilinked-fav-btn--active")
          );
          btn.addClass("wikilinked-fav-btn--active");
          this.refreshPreview();
        });
      });
    }

    const targetSec = section("📌 Nota destino");
    const targetRow = targetSec.createDiv({ cls: "wikilinked-target-row" });
    this.targetNameEl = targetRow.createEl("span", {
      cls: "wikilinked-target-name",
      text: "Ninguna seleccionada"
    });
    this.statusEl = targetSec.createEl("div", { cls: "wikilinked-link-status" });

    new import_obsidian.ButtonComponent(targetRow).setButtonText("Elegir nota…").setCta().onClick(() => {
      new FileSuggestModal(this.app, (file) => {
        this.selectedTarget = file;
        this.targetNameEl.textContent = file.path;
        this.targetNameEl.addClass("wikilinked-target-selected");
        contentEl.querySelectorAll(".wikilinked-fav-btn").forEach(
          (b) => b.removeClass("wikilinked-fav-btn--active")
        );
        favs.forEach((fav, i) => {
          if (fav.path === file.path) {
            const el = contentEl.querySelectorAll(".wikilinked-fav-btn")[i];
            if (el) el.addClass("wikilinked-fav-btn--active");
          }
        });
        this.refreshPreview();
      }, this.activeFile).open();
    });

    const typeSec = section("🔗 Tipo de enlace");
    const typeRow = typeSec.createDiv({ cls: "wikilinked-type-row" });
    const makeTypeBtn = (label, value) => {
      const btn = typeRow.createEl("button", {
        cls: "wikilinked-type-btn" + (this.linkType === value ? " wikilinked-type-btn--active" : ""),
        text: label
      });
      btn.addEventListener("click", () => {
        this.linkType = value;
        typeRow.querySelectorAll(".wikilinked-type-btn").forEach((b) => b.removeClass("wikilinked-type-btn--active"));
        btn.addClass("wikilinked-type-btn--active");
        this.refreshPreview();
      });
    };
    makeTypeBtn("[[Wikilink]]", "wikilink");
    makeTypeBtn("![[Embed]]", "embed");

    const posSec = section("📍 Posición de inserción");
    const posRow = posSec.createDiv({ cls: "wikilinked-type-row" });
    const makePosBtn = (label, value) => {
      const btn = posRow.createEl("button", {
        cls: "wikilinked-type-btn" + (this.insertPos === value ? " wikilinked-type-btn--active" : ""),
        text: label
      });
      btn.addEventListener("click", () => {
        this.insertPos = value;
        posRow.querySelectorAll(".wikilinked-type-btn").forEach((b) => b.removeClass("wikilinked-type-btn--active"));
        btn.addClass("wikilinked-type-btn--active");
      });
    };
    makePosBtn("Al final", "end");
    makePosBtn("En el cursor", "cursor");

    const containerSec = section("📦 Callout contenedor (opcional)");
    containerSec.createEl("p", {
      cls: "wikilinked-hint",
      text: `Si la nota destino tiene > [!${this.plugin.settings.containerTag}], el link se insertará dentro. Funciona en iPhone sin plugin.`
    });

    const prevSec = section("👁 Vista previa");
    this.previewEl = prevSec.createEl("code", { cls: "wikilinked-preview", text: "—" });

    const footer = contentEl.createDiv({ cls: "wikilinked-footer" });
    new import_obsidian.ButtonComponent(footer).setButtonText("Insertar enlace").setCta().onClick(() => this.doInsert());
    new import_obsidian.ButtonComponent(footer).setButtonText("Cancelar").onClick(() => this.close());
  }

  async refreshPreview() {
    if (!this.selectedTarget) {
      this.previewEl.textContent = "—";
      this.statusEl.textContent = "";
      this.statusEl.className = "wikilinked-link-status";
      return;
    }
    const target = this.selectedTarget;
    this.previewEl.textContent = buildLink(this.activeFile, this.linkType, this.app, target.path);
    try {
      const content = await this.app.vault.read(target);
      const status = checkExistingLink(this.app, content, this.activeFile, target.path);
      this.statusEl.className = "wikilinked-link-status";
      if (status === "none") {
        this.statusEl.addClass("wikilinked-link-status--none");
        this.statusEl.textContent = "✔ Aún no vinculado en esta nota.";
      } else if (status === "wikilink") {
        this.statusEl.addClass("wikilinked-link-status--exists");
        this.statusEl.textContent = "⚠️ Ya existe un [[wikilink]] de este archivo en la nota destino.";
      } else if (status === "embed") {
        this.statusEl.addClass("wikilinked-link-status--exists");
        this.statusEl.textContent = "⚠️ Ya existe un ![[embed]] de este archivo en la nota destino.";
      } else {
        this.statusEl.addClass("wikilinked-link-status--exists");
        this.statusEl.textContent = "⚠️ Ya existen tanto [[wikilink]] como ![[embed]] de este archivo en la nota destino.";
      }
    } catch {
      this.statusEl.textContent = "";
    }
  }

  async doInsert() {
    if (!this.selectedTarget) {
      new import_obsidian.Notice("⚠️ Selecciona una nota destino primero.");
      return;
    }
    const targetFile = this.selectedTarget;
    if (targetFile.path === this.activeFile.path) {
      new import_obsidian.Notice("⚠️ No puedes enlazar un archivo consigo mismo.");
      return;
    }
    try {
      const where = await this.plugin.insertLink(this.activeFile, targetFile, this.linkType, this.insertPos);
      const msgs = {
        callout: `✅ Enlace añadido al callout de "${targetFile.name}"`,
        end: `✅ Enlace añadido al final de "${targetFile.name}"`,
        cursor: `✅ Enlace insertado en el cursor de "${targetFile.name}"`,
        "end-fallback": `✅ Añadido al final de "${targetFile.name}" (nota no estaba abierta)`
      };
      new import_obsidian.Notice(msgs[where]);
      this.close();
    } catch (e) {
      new import_obsidian.Notice(`❌ Wikilinked: no se pudo insertar el enlace. ${e.message}`);
      console.error("Wikilinked insert error:", e);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
};

// ─── Modal: enlaces del callout contenedor ───────────────────────────────────

var ContainerLinksModal = class extends import_obsidian.Modal {
  constructor(plugin, links) {
    super(plugin.app);
    this.plugin = plugin;
    this.links = links;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("wikilinked-modal");
    contentEl.createEl("h2", { cls: "wikilinked-modal-title", text: "📦 Notas en el callout contenedor" });
    if (this.links.length === 0) {
      contentEl.createEl("p", { text: "No se encontraron enlaces en el callout contenedor." });
    } else {
      const list = contentEl.createEl("ul", { cls: "wikilinked-container-list" });
      this.links.forEach((link) => {
        const match = link.match(/!?\[\[(.+?)\]\]/);
        if (!match) return;
        const fileName = match[1];
        const isEmbed = link.startsWith("!");
        const li = list.createEl("li", { cls: "wikilinked-container-item" });
        li.createEl("span", { cls: "wikilinked-container-icon", text: isEmbed ? "🔳 " : "🔗 " });
        const nameEl = li.createEl("span", { cls: "wikilinked-container-name", text: fileName });
        nameEl.addEventListener("click", async () => {
          const file = this.app.metadataCache.getFirstLinkpathDest(fileName.split("|")[0], "");
          if (file) {
            await this.app.workspace.openLinkText(file.path, "", false);
            this.close();
          } else {
            new import_obsidian.Notice(`⚠️ No se encontró el archivo: ${fileName}`);
          }
        });
      });
    }
    const footer = contentEl.createDiv({ cls: "wikilinked-footer" });
    new import_obsidian.ButtonComponent(footer).setButtonText("Cerrar").onClick(() => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};

// ─── Settings tab ────────────────────────────────────────────────────────────

var WikilinkedSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Wikilinked — Ajustes" });

    // ── General ──
    containerEl.createEl("h3", { text: "General" });

    new import_obsidian.Setting(containerEl)
      .setName("Tipo de enlace predeterminado")
      .setDesc("Si insertar como [[wikilink]] o como ![[embed]].")
      .addDropdown((d) => d
        .addOption("wikilink", "[[Wikilink]]")
        .addOption("embed", "![[Embed]]")
        .setValue(this.plugin.settings.defaultLinkType)
        .onChange(async (v) => {
          this.plugin.settings.defaultLinkType = v;
          await this.plugin.saveSettings();
        })
      );

    new import_obsidian.Setting(containerEl)
      .setName("Posición de inserción predeterminada")
      .addDropdown((d) => d
        .addOption("end", "Al final de la nota")
        .addOption("cursor", "En la posición del cursor")
        .setValue(this.plugin.settings.insertPosition)
        .onChange(async (v) => {
          this.plugin.settings.insertPosition = v;
          await this.plugin.saveSettings();
        })
      );

    new import_obsidian.Setting(containerEl)
      .setName("Tag del callout contenedor")
      .setDesc('Nombre del callout. Por defecto "wikilinked". Úsalo en notas como > [!wikilinked]')
      .addText((t) => t
        .setValue(this.plugin.settings.containerTag)
        .onChange(async (v) => {
          this.plugin.settings.containerTag = v.trim() || "wikilinked";
          await this.plugin.saveSettings();
        })
      );

    new import_obsidian.Setting(containerEl)
      .setName("Mostrar botón en el ribbon")
      .addToggle((t) => t
        .setValue(this.plugin.settings.showRibbonButton)
        .onChange(async (v) => {
          this.plugin.settings.showRibbonButton = v;
          await this.plugin.saveSettings();
          new import_obsidian.Notice("Reinicia Obsidian para aplicar el cambio del ribbon.");
        })
      );

    // ── Reglas de etiqueta ──
    containerEl.createEl("h3", { text: "🏷️ Reglas de etiqueta → enlazar automáticamente" });
    containerEl.createEl("p", {
      cls: "wikilinked-settings-desc",
      text: "Cuando un archivo recibe la etiqueta indicada (nota .md, PDF, imagen…), Wikilinked lo enlaza solo dentro de la nota contenedora elegida: en su callout [!" + this.plugin.settings.containerTag + "] si lo tiene, o al final de la nota. Una etiqueta padre también vale para sus hijas (\"clases\" coincide con \"clases/fdg\"). Si ya existe un enlace a ese archivo en la nota, no se duplica. Todas las reglas que coincidan se aplican."
    });

    new import_obsidian.Setting(containerEl)
      .setName("Enlazar automáticamente al etiquetar")
      .addToggle((t) => t
        .setValue(this.plugin.settings.autoLinkEnabled)
        .onChange(async (v) => {
          this.plugin.settings.autoLinkEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new import_obsidian.Setting(containerEl)
      .setName("Mostrar avisos")
      .setDesc("Muestra un aviso cada vez que se añade un enlace automáticamente.")
      .addToggle((t) => t
        .setValue(this.plugin.settings.showNotices)
        .onChange(async (v) => {
          this.plugin.settings.showNotices = v;
          await this.plugin.saveSettings();
        })
      );

    const rulesContainer = containerEl.createDiv({ cls: "wikilinked-rules-container" });
    this.renderTagRules(rulesContainer);

    new import_obsidian.Setting(containerEl)
      .addButton((btn) => btn
        .setButtonText("+ Añadir regla de etiqueta")
        .setCta()
        .onClick(async () => {
          this.plugin.settings.tagRules.push({
            id: Math.random().toString(36).slice(2, 8),
            tag: "",
            target: "",
            linkType: this.plugin.settings.defaultLinkType
          });
          await this.plugin.saveSettings();
          this.display();
        })
      )
      .addButton((btn) => btn
        .setButtonText("Aplicar reglas ahora a todo el vault")
        .onClick(async () => {
          await this.plugin.applyAllRules();
        })
      );

    // ── Registro de etiquetas de archivos sin propiedades ──
    containerEl.createEl("h3", { text: "🗂️ Etiquetas de PDF, imágenes y otros archivos" });
    containerEl.createEl("p", {
      cls: "wikilinked-settings-desc",
      text: "Los PDF y las imágenes no tienen propiedades, así que sus etiquetas se guardan en el registro de Wikilinked (data.json de este plugin). Para etiquetar: comando «Etiquetar archivo activo», menú del archivo (clic derecho o menú ⋯ de la pestaña) o la barra de estado. Estas etiquetas no aparecen en el panel de etiquetas de Obsidian; búscalas con el comando «Buscar archivos etiquetados». Si tienes instalado el plugin Autosort y creas ahí una regla con esta misma etiqueta, el archivo también se moverá automáticamente a la carpeta que definas en Autosort."
    });

    const count = Object.keys(this.plugin.settings.fileTags).length;
    new import_obsidian.Setting(containerEl)
      .setName("Archivos etiquetados")
      .setDesc(`${count} archivo(s) con etiquetas guardadas en el registro.`)
      .addButton((btn) => btn
        .setButtonText("Ver / buscar")
        .onClick(() => this.plugin.openTaggedFiles())
      )
      .addButton((btn) => btn
        .setButtonText("Limpiar huérfanas")
        .setTooltip("Elimina del registro los archivos que ya no existen en el vault")
        .onClick(async () => {
          const removed = await this.plugin.cleanOrphanTags();
          new import_obsidian.Notice(removed > 0 ? `🧹 ${removed} entrada(s) eliminadas del registro.` : "No hay entradas huérfanas.");
          this.display();
        })
      );

    // ── Favoritos ──
    containerEl.createEl("h3", { text: "⭐ Notas favoritas" });
    containerEl.createEl("p", {
      cls: "wikilinked-settings-desc",
      text: "Estas notas aparecen como botones de acceso rápido en la parte superior del modal. Útil para notas contenedoras o índices que usas frecuentemente."
    });

    const favList = containerEl.createDiv({ cls: "wikilinked-fav-settings-list" });
    this.renderFavList(favList);

    new import_obsidian.Setting(containerEl)
      .setName("Añadir nota favorita")
      .setDesc("Elige una nota del vault para añadirla a favoritos.")
      .addButton((btn) => btn
        .setButtonText("+ Añadir favorita")
        .setCta()
        .onClick(() => {
          new FileSuggestModal(this.app, async (file) => {
            if (this.plugin.settings.favorites.some((f) => f.path === file.path)) {
              new import_obsidian.Notice("Esa nota ya está en favoritos.");
              return;
            }
            this.plugin.settings.favorites.push({ path: file.path, label: file.basename });
            await this.plugin.saveSettings();
            this.renderFavList(favList);
          }).open();
        })
      );

    containerEl.createEl("h3", { text: "Formato del callout contenedor" });
    containerEl.createEl("p", { text: "Crea este callout en cualquier nota para que el plugin inserte links dentro de él:" });
    containerEl.createEl("pre", { cls: "wikilinked-settings-pre" })
      .createEl("code", { text: "> [!wikilinked]\n> [[Mi nota]]\n> ![[diagrama.png]]\n> [[referencia.pdf]]" });
  }

  renderTagRules(container) {
    container.empty();
    const rules = this.plugin.settings.tagRules;

    if (rules.length === 0) {
      container.createEl("p", {
        cls: "wikilinked-fav-empty",
        text: "Sin reglas de etiqueta. Añade una con el botón de abajo."
      });
      return;
    }

    const headerRow = container.createDiv({ cls: "wikilinked-rule-header-row" });
    headerRow.createEl("span", { text: "Etiqueta" });
    headerRow.createEl("span", { text: "→  Nota contenedora" });
    headerRow.createEl("span", { text: "" });
    headerRow.createEl("span", { text: "Enlace" });
    headerRow.createEl("span", { text: "" });

    rules.forEach((rule, rIndex) => {
      const row = container.createDiv({ cls: "wikilinked-rule-row" });

      const tagInput = row.createEl("input", {
        cls: "wikilinked-input",
        type: "text",
        value: rule.tag || "",
        placeholder: "fdg  (sin #)"
      });
      tagInput.addEventListener("change", async () => {
        const t = sanitizeTag(tagInput.value);
        tagInput.value = t;
        this.plugin.settings.tagRules[rIndex].tag = t;
        await this.plugin.saveSettings();
      });

      const targetInput = row.createEl("input", {
        cls: "wikilinked-input",
        type: "text",
        value: rule.target || "",
        placeholder: "carpeta/nota-contenedora.md"
      });
      targetInput.addEventListener("change", async () => {
        const raw = targetInput.value.trim();
        const t = raw ? import_obsidian.normalizePath(raw) : "";
        targetInput.value = t;
        this.plugin.settings.tagRules[rIndex].target = t;
        await this.plugin.saveSettings();
      });

      const pickBtn = row.createEl("button", { cls: "wikilinked-fav-move", text: "📄", title: "Elegir nota…" });
      pickBtn.addEventListener("click", () => {
        new FileSuggestModal(this.app, async (file) => {
          this.plugin.settings.tagRules[rIndex].target = file.path;
          targetInput.value = file.path;
          await this.plugin.saveSettings();
        }).open();
      });

      const typeSelect = row.createEl("select", { cls: "wikilinked-select" });
      [["wikilink", "[[Wikilink]]"], ["embed", "![[Embed]]"]].forEach(([val, label]) => {
        const opt = typeSelect.createEl("option", { value: val, text: label });
        if ((rule.linkType || "wikilink") === val) opt.selected = true;
      });
      typeSelect.addEventListener("change", async () => {
        this.plugin.settings.tagRules[rIndex].linkType = typeSelect.value;
        await this.plugin.saveSettings();
      });

      const delBtn = row.createEl("button", { cls: "wikilinked-fav-delete", text: "✕", title: "Eliminar regla" });
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.tagRules.splice(rIndex, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  renderFavList(container) {
    container.empty();
    const favs = this.plugin.settings.favorites;
    if (favs.length === 0) {
      container.createEl("p", {
        cls: "wikilinked-fav-empty",
        text: "Sin favoritos aún. Añade notas con el botón de abajo."
      });
      return;
    }
    favs.forEach((fav, index) => {
      const row = container.createDiv({ cls: "wikilinked-fav-settings-row" });
      row.createEl("span", { cls: "wikilinked-fav-handle", text: "⠿" });

      const labelInput = row.createEl("input", {
        cls: "wikilinked-fav-label-input",
        type: "text",
        value: fav.label
      });
      labelInput.placeholder = "Etiqueta…";
      labelInput.addEventListener("change", async () => {
        this.plugin.settings.favorites[index].label = labelInput.value.trim() || fav.path.split("/").pop() || fav.path;
        await this.plugin.saveSettings();
      });

      row.createEl("span", { cls: "wikilinked-fav-path", text: fav.path, title: fav.path });

      const moveUp = row.createEl("button", { cls: "wikilinked-fav-move", text: "↑", title: "Mover arriba" });
      moveUp.disabled = index === 0;
      moveUp.addEventListener("click", async () => {
        if (index === 0) return;
        const f = this.plugin.settings.favorites;
        [f[index - 1], f[index]] = [f[index], f[index - 1]];
        await this.plugin.saveSettings();
        this.renderFavList(container);
      });

      const moveDown = row.createEl("button", { cls: "wikilinked-fav-move", text: "↓", title: "Mover abajo" });
      moveDown.disabled = index === favs.length - 1;
      moveDown.addEventListener("click", async () => {
        if (index === favs.length - 1) return;
        const f = this.plugin.settings.favorites;
        [f[index], f[index + 1]] = [f[index + 1], f[index]];
        await this.plugin.saveSettings();
        this.renderFavList(container);
      });

      const delBtn = row.createEl("button", { cls: "wikilinked-fav-delete", text: "✕", title: "Eliminar" });
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.favorites.splice(index, 1);
        await this.plugin.saveSettings();
        this.renderFavList(container);
      });
    });
  }
};

// ─── Plugin principal ────────────────────────────────────────────────────────

var WikilinkedPlugin = class extends import_obsidian.Plugin {

  async onload() {
    await this.loadSettings();

    this._queue = Promise.resolve();   // cola: una escritura a la vez sobre las notas contenedoras
    this._tagSnap = new Map();         // ruta → Set de etiquetas (normalizadas) de cada nota .md
    this._tagTimers = new Map();       // debounce por nota
    this._saveTimer = null;

    this.addSettingTab(new WikilinkedSettingTab(this.app, this));

    if (this.settings.showRibbonButton) {
      this.addRibbonIcon("link", "Wikilinked", () => this.openWikilinkedModal());
    }

    // ── Comandos ──
    this.addCommand({
      id: "open-wikilinked-modal",
      name: "Abrir panel Wikilinked",
      callback: () => this.openWikilinkedModal(),
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "w" }]
    });
    this.addCommand({
      id: "view-container-links",
      name: "Ver enlaces del callout contenedor",
      callback: () => this.openContainerLinks()
    });
    this.addCommand({
      id: "tag-active-file",
      name: "Etiquetar archivo activo (nota, PDF, imagen…)",
      callback: () => this.openTagModal()
    });
    this.addCommand({
      id: "browse-tagged-files",
      name: "Buscar archivos etiquetados (PDF, imágenes…)",
      callback: () => this.openTaggedFiles()
    });
    this.addCommand({
      id: "apply-tag-rules",
      name: "Aplicar reglas de etiqueta a todo el vault",
      callback: () => this.applyAllRules()
    });

    // ── Menú del archivo (explorador, clic derecho y menú ⋯ de PDF/imagen) ──
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof import_obsidian.TFile)) return;
        menu.addItem((item) => item
          .setTitle("Wikilinked: etiquetar…")
          .setIcon("tag")
          .onClick(() => new TagFileModal(this, file).open()));
        menu.addItem((item) => item
          .setTitle("Wikilinked: enlazar en otra nota…")
          .setIcon("link")
          .onClick(() => new WikilinkedModal(this, file).open()));
      })
    );

    // ── Barra de estado: muestra las etiquetas del PDF/imagen abierto ──
    this._statusEl = this.addStatusBarItem();
    this._statusEl.addClass("wikilinked-statusbar");
    this._statusEl.addEventListener("click", () => this.openTagModal());
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateStatusBar()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatusBar()));

    // ── Mantener el registro al día cuando se renombra, mueve o borra ──
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.remapPath(oldPath, file.path))
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.dropPath(file.path))
    );

    // ── Etiquetas de notas .md ──
    // Se registra cuando el vault ya está indexado: así no se evalúan reglas
    // para todas las notas existentes en cada arranque.
    this.app.workspace.onLayoutReady(() => {
      for (const f of this.app.vault.getMarkdownFiles()) {
        this._tagSnap.set(f.path, new Set(this.getFileTags(f).all.map(normalizeTag)));
      }
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") return;
          const prev = this._tagTimers.get(file.path);
          if (prev) clearTimeout(prev);
          this._tagTimers.set(file.path, setTimeout(() => {
            this._tagTimers.delete(file.path);
            this.onMarkdownTagsChanged(file);
          }, TAG_DEBOUNCE_MS));
        })
      );
      this.updateStatusBar();
    });

    this.loadStyles();
    console.log("Wikilinked plugin loaded ✓");
  }

  async onunload() {
    for (const t of this._tagTimers.values()) clearTimeout(t);
    this._tagTimers.clear();
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      await this.saveSettings();
    }
    console.log("Wikilinked plugin unloaded");
  }

  // ── Apertura de modales ───────────────────────────────────────────────────

  openWikilinkedModal() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new import_obsidian.Notice("⚠️ Abre un archivo primero.");
      return;
    }
    new WikilinkedModal(this, activeFile).open();
  }

  openTagModal(file) {
    const target = file || this.app.workspace.getActiveFile();
    if (!target) {
      new import_obsidian.Notice("⚠️ Abre un archivo primero.");
      return;
    }
    new TagFileModal(this, target).open();
  }

  openTaggedFiles() {
    const modal = new TaggedFilesModal(this);
    if (modal.items.length === 0) {
      new import_obsidian.Notice("Aún no hay PDF, imágenes u otros archivos etiquetados.");
      return;
    }
    modal.open();
  }

  async openContainerLinks() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new import_obsidian.Notice("⚠️ Abre una nota primero.");
      return;
    }
    const content = await this.app.vault.read(activeFile);
    const links = getLinksFromCallout(content, this.settings.containerTag);
    new ContainerLinksModal(this, links).open();
  }

  // ── Lectura de etiquetas ──────────────────────────────────────────────────

  /**
   * Etiquetas de un archivo (sin '#'):
   *  all    → todas
   *  fm     → las guardadas de forma editable (frontmatter en .md; registro en el resto)
   *  inline → las escritas en el cuerpo de una nota (solo .md; no editables desde aquí)
   */
  getFileTags(file) {
    if (file.extension !== "md") {
      const stored = uniqueTags(this.settings.fileTags[file.path] || []);
      return { all: stored, fm: stored, inline: [] };
    }
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return { all: [], fm: [], inline: [] };
    const all = uniqueTags((import_obsidian.getAllTags(cache) || []).map(stripHash));
    const fmRaw = typeof import_obsidian.parseFrontMatterTags === "function"
      ? import_obsidian.parseFrontMatterTags(cache.frontmatter)
      : toTagArray(cache.frontmatter && cache.frontmatter.tags);
    const fm = uniqueTags((fmRaw || []).map(stripHash));
    const fmKeys = new Set(fm.map(normalizeTag));
    const inline = all.filter((t) => !fmKeys.has(normalizeTag(t)));
    return { all, fm, inline };
  }

  /** Etiquetas que este plugin puede editar para el archivo. */
  getStoredTags(file) {
    return this.getFileTags(file).fm;
  }

  /**
   * API pública mínima para que otros plugins (ej. Autosort, vía
   * app.plugins.plugins["wikilinked"]) lean las etiquetas de un archivo,
   * incluidos los PDF/imágenes que solo existen en el registro propio.
   */
  getTags(file) {
    return this.getFileTags(file).all;
  }

  // ── Escritura de etiquetas ────────────────────────────────────────────────

  /**
   * Añade etiquetas a un archivo. En notas .md las escribe en el frontmatter;
   * en PDF/imágenes/etc. las guarda en el registro del plugin. Después evalúa
   * las reglas de etiqueta con las etiquetas recién añadidas.
   * Devuelve { added, current }.
   */
  async addTags(file, rawTags) {
    const wanted = uniqueTags(rawTags.map(sanitizeTag).filter(Boolean));
    let added = [];
    let current = this.getStoredTags(file);
    if (wanted.length === 0) return { added, current };

    if (file.extension === "md") {
      if (typeof this.app.fileManager.processFrontMatter !== "function") {
        new import_obsidian.Notice("⚠️ Tu versión de Obsidian no permite editar propiedades desde plugins.");
        return { added, current };
      }
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const arr = toTagArray(fm.tags);
        const have = new Set(arr.map(normalizeTag));
        for (const t of wanted) {
          if (have.has(normalizeTag(t))) continue;
          arr.push(t);
          have.add(normalizeTag(t));
          added.push(t);
        }
        if (added.length > 0) fm.tags = arr;
        current = arr;
      });
    } else {
      const arr = uniqueTags(this.settings.fileTags[file.path] || []);
      const have = new Set(arr.map(normalizeTag));
      for (const t of wanted) {
        if (have.has(normalizeTag(t))) continue;
        arr.push(t);
        have.add(normalizeTag(t));
        added.push(t);
      }
      if (added.length > 0) {
        this.settings.fileTags[file.path] = arr;
        this.requestSave();
      }
      current = arr;
    }

    if (added.length > 0) {
      const addedKeys = added.map(normalizeTag);
      if (file.extension === "md") {
        // Registrar ya en la instantánea, para que el evento de metadatos
        // posterior no vuelva a evaluar estas mismas etiquetas.
        const snap = this._tagSnap.get(file.path) || new Set();
        addedKeys.forEach((k) => snap.add(k));
        this._tagSnap.set(file.path, snap);
      } else {
        // Los archivos sin propiedades (PDF, imágenes…) no disparan ningún
        // evento propio de Obsidian al etiquetarlos: avisamos nosotros mismos
        // para que otros plugins (ej. Autosort) puedan reaccionar.
        this.app.workspace.trigger("wikilinked:tags-changed", file, current);
      }
      await this.applyRulesForFile(file, addedKeys);
    }
    this.updateStatusBar();
    return { added, current };
  }

  /** Quita una etiqueta editable (frontmatter o registro). Devuelve las que quedan. */
  async removeTag(file, tag) {
    const key = normalizeTag(tag);
    let current = this.getStoredTags(file);

    if (file.extension === "md") {
      if (typeof this.app.fileManager.processFrontMatter !== "function") return current;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const arr = toTagArray(fm.tags).filter((t) => normalizeTag(t) !== key);
        if (arr.length > 0) fm.tags = arr; else delete fm.tags;
        current = arr;
      });
      const snap = this._tagSnap.get(file.path);
      if (snap) snap.delete(key);
    } else {
      const arr = uniqueTags(this.settings.fileTags[file.path] || []).filter((t) => normalizeTag(t) !== key);
      if (arr.length > 0) this.settings.fileTags[file.path] = arr;
      else delete this.settings.fileTags[file.path];
      this.requestSave();
      current = arr;
      this.app.workspace.trigger("wikilinked:tags-changed", file, current);
    }
    this.updateStatusBar();
    return current;
  }

  // ── Reglas de etiqueta ────────────────────────────────────────────────────

  /**
   * Un .md cambió de metadatos: si ganó etiquetas nuevas, evalúa las reglas
   * solo con ellas. (Así, quitar a mano un enlace del contenedor no lo vuelve
   * a añadir cada vez que editas la nota.)
   */
  async onMarkdownTagsChanged(file) {
    if (!this.app.vault.getAbstractFileByPath(file.path)) return;
    const cur = new Set(this.getFileTags(file).all.map(normalizeTag));
    const prev = this._tagSnap.get(file.path);
    this._tagSnap.set(file.path, cur);

    if (!this.settings.autoLinkEnabled || this.settings.tagRules.length === 0) return;
    const added = [...cur].filter((t) => !prev || !prev.has(t));
    if (added.length === 0) return;
    await this.applyRulesForFile(file, added);
  }

  /**
   * Evalúa todas las reglas para un archivo. `onlyTags` limita la evaluación a
   * esas etiquetas (normalizadas); sin él se usan todas las del archivo.
   * Devuelve cuántos enlaces nuevos se añadieron.
   */
  async applyRulesForFile(file, onlyTags, opts = {}) {
    if (!this.settings.autoLinkEnabled) return 0;
    if (!this.app.vault.getAbstractFileByPath(file.path)) return 0;

    const candidates = onlyTags || this.getFileTags(file).all.map(normalizeTag);
    if (candidates.length === 0) return 0;

    let linked = 0;
    for (const rule of this.settings.tagRules) {
      if (!rule.tag || !rule.target) continue;
      const matched = candidates.find((t) => tagMatches(t, rule.tag));
      if (!matched) continue;

      const target = this.app.vault.getAbstractFileByPath(import_obsidian.normalizePath(rule.target));
      if (!(target instanceof import_obsidian.TFile) || target.extension !== "md") {
        if (!opts.silent && this.settings.showNotices) {
          new import_obsidian.Notice(`⚠️ Wikilinked: no se encontró la nota contenedora "${rule.target}" (regla #${rule.tag}).`);
        }
        continue;
      }
      if (target.path === file.path) continue;

      try {
        const outcome = await this.autoInsert(file, target, rule.linkType || this.settings.defaultLinkType);
        if (outcome !== "exists") {
          linked++;
          if (!opts.silent && this.settings.showNotices) {
            new import_obsidian.Notice(`🔗 Wikilinked: "${file.name}" → ${target.name} (#${stripHash(rule.tag)})`);
          }
        }
      } catch (e) {
        new import_obsidian.Notice(`❌ Wikilinked: no se pudo enlazar "${file.name}" en "${target.name}". ${e.message}`);
        console.error("Wikilinked auto-link error:", e);
      }
    }
    return linked;
  }

  /** Recorre el vault y aplica las reglas a todo archivo que ya tenga la etiqueta. */
  async applyAllRules() {
    if (this.settings.tagRules.length === 0) {
      new import_obsidian.Notice("Aún no hay reglas de etiqueta. Créalas en los ajustes de Wikilinked.");
      return;
    }
    let total = 0;
    for (const f of this.app.vault.getFiles()) {
      total += await this.applyRulesForFile(f, undefined, { silent: true });
    }
    new import_obsidian.Notice(total > 0
      ? `🔗 Wikilinked: ${total} enlace(s) añadido(s).`
      : "Wikilinked: todo estaba ya enlazado.");
  }

  /** Cola: evita que dos escrituras simultáneas pisen la misma nota contenedora. */
  enqueue(job) {
    const run = this._queue.then(job);
    this._queue = run.catch(() => {});
    return run;
  }

  /** Inserta el enlace en la nota destino si aún no hay ninguno a ese archivo. */
  autoInsert(file, target, linkType) {
    return this.enqueue(async () => {
      let outcome = "exists";
      const tag = this.settings.containerTag;
      await this.app.vault.process(target, (content) => {
        if (checkExistingLink(this.app, content, file, target.path) !== "none") return content;
        const link = buildLink(file, linkType, this.app, target.path);
        outcome = calloutHeaderRe(tag, "im").test(content) ? "callout" : "end";
        return addLinkToContent(content, tag, link);
      });
      return outcome;
    });
  }

  // ── Inserción manual (desde el modal) ─────────────────────────────────────

  /** Devuelve "callout" | "end" | "cursor" | "end-fallback". */
  async insertLink(source, target, linkType, position) {
    const tag = this.settings.containerTag;
    const link = buildLink(source, linkType, this.app, target.path);

    return this.enqueue(async () => {
      const content = await this.app.vault.read(target);
      const hasCallout = calloutHeaderRe(tag, "im").test(content);

      if (hasCallout || position !== "cursor") {
        await this.app.vault.process(target, (c) => addLinkToContent(c, tag, link));
        return hasCallout ? "callout" : "end";
      }

      const leaf = this.app.workspace.getMostRecentLeaf();
      if (leaf && leaf.view instanceof import_obsidian.MarkdownView && leaf.view.file === target) {
        leaf.view.editor.replaceRange(link + "\n", leaf.view.editor.getCursor());
        return "cursor";
      }
      await this.app.vault.process(target, (c) => addLinkToContent(c, tag, link));
      return "end-fallback";
    });
  }

  // ── Mantenimiento del registro ────────────────────────────────────────────

  /** Un archivo o carpeta cambió de ruta: actualiza registro, favoritos y reglas. */
  remapPath(oldPath, newPath) {
    let changed = false;

    const ft = this.settings.fileTags;
    for (const key of Object.keys(ft)) {
      const np = remapIfInside(key, oldPath, newPath);
      if (np === null) continue;
      ft[np] = uniqueTags([...(ft[np] || []), ...ft[key]]);
      delete ft[key];
      changed = true;
    }
    for (const fav of this.settings.favorites) {
      const np = remapIfInside(fav.path, oldPath, newPath);
      if (np !== null) { fav.path = np; changed = true; }
    }
    for (const rule of this.settings.tagRules) {
      if (!rule.target) continue;
      const np = remapIfInside(rule.target, oldPath, newPath);
      if (np !== null) { rule.target = np; changed = true; }
    }
    for (const key of [...this._tagSnap.keys()]) {
      const np = remapIfInside(key, oldPath, newPath);
      if (np !== null) {
        this._tagSnap.set(np, this._tagSnap.get(key));
        this._tagSnap.delete(key);
      }
    }
    if (changed) this.requestSave();
    this.updateStatusBar();
  }

  /** Un archivo o carpeta se borró: limpia su registro. */
  dropPath(path) {
    let changed = false;
    const ft = this.settings.fileTags;
    for (const key of Object.keys(ft)) {
      if (remapIfInside(key, path, "") !== null) { delete ft[key]; changed = true; }
    }
    for (const key of [...this._tagSnap.keys()]) {
      if (remapIfInside(key, path, "") !== null) this._tagSnap.delete(key);
    }
    if (changed) this.requestSave();
    this.updateStatusBar();
  }

  /** Elimina del registro los archivos que ya no existen. Devuelve cuántos. */
  async cleanOrphanTags() {
    let removed = 0;
    const ft = this.settings.fileTags;
    for (const key of Object.keys(ft)) {
      if (!(this.app.vault.getAbstractFileByPath(key) instanceof import_obsidian.TFile)) {
        delete ft[key];
        removed++;
      }
    }
    if (removed > 0) await this.saveSettings();
    return removed;
  }

  // ── Barra de estado ───────────────────────────────────────────────────────

  updateStatusBar() {
    if (!this._statusEl) return;
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension === "md") {
      this._statusEl.style.display = "none";
      return;
    }
    const tags = uniqueTags(this.settings.fileTags[file.path] || []);
    this._statusEl.style.display = "";
    this._statusEl.setText(tags.length > 0 ? "🏷️ " + tags.map((t) => "#" + t).join(" ") : "🏷️ etiquetar");
    this._statusEl.setAttribute("aria-label", "Wikilinked: etiquetas de este archivo");
  }

  // ── Ajustes ───────────────────────────────────────────────────────────────

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // Copias propias de las estructuras (no compartir referencias con los defaults)
    this.settings.favorites = Array.isArray(data.favorites) ? data.favorites : [];
    this.settings.tagRules = Array.isArray(data.tagRules) ? data.tagRules : [];
    this.settings.fileTags = data.fileTags && typeof data.fileTags === "object" && !Array.isArray(data.fileTags)
      ? data.fileTags
      : {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Guarda con retardo (el registro puede cambiar varias veces seguidas). */
  requestSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveSettings();
    }, SAVE_DEBOUNCE_MS);
  }

  loadStyles() {
    const style = document.createElement("style");
    style.id = "wikilinked-styles";
    style.textContent = CSS_CONTENT;
    document.head.appendChild(style);
    this.register(() => style.remove());
  }
};

// ─── CSS ─────────────────────────────────────────────────────────────────────

var CSS_CONTENT = `
/* ── Modal general ── */
.wikilinked-modal { padding: 0.5rem 0.25rem; max-width: 560px; }
.wikilinked-modal-title { margin-bottom: 0.25rem; font-size: 1.3rem; font-weight: 700; color: var(--text-accent); }
.wikilinked-subtitle { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem; }
.wikilinked-section { margin-bottom: 1.1rem; }
.wikilinked-section-label { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 0.4rem; }
.wikilinked-tag-open { margin: -0.4rem 0 1rem; }

/* ── Favoritos en el modal ── */
.wikilinked-fav-grid { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.wikilinked-fav-btn {
  padding: 0.3rem 0.7rem;
  border-radius: 20px;
  border: 1.5px solid var(--interactive-accent);
  background: transparent;
  color: var(--interactive-accent);
  cursor: pointer;
  font-size: 0.84rem;
  font-weight: 500;
  transition: all 0.15s;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wikilinked-fav-btn:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
.wikilinked-fav-btn--active { background: var(--interactive-accent); color: var(--text-on-accent); }

/* ── Nota destino ── */
.wikilinked-target-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.wikilinked-target-name { flex: 1; font-size: 0.9rem; color: var(--text-muted); font-style: italic; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wikilinked-target-selected { color: var(--text-normal); font-style: normal; font-weight: 500; }

/* ── Estado de enlace existente ── */
.wikilinked-link-status { font-size: 0.82rem; margin-top: 0.4rem; min-height: 1.1rem; font-weight: 500; }
.wikilinked-link-status--none   { color: var(--color-green); }
.wikilinked-link-status--exists { color: var(--color-orange); }

/* ── Botones tipo/posición ── */
.wikilinked-type-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.wikilinked-type-btn { padding: 0.35rem 0.8rem; border-radius: 6px; border: 1.5px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); cursor: pointer; font-size: 0.88rem; transition: all 0.15s; }
.wikilinked-type-btn:hover { background: var(--background-modifier-hover); }
.wikilinked-type-btn--active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }

/* ── Preview ── */
.wikilinked-preview { display: block; background: var(--code-background); color: var(--code-normal); border-radius: 6px; padding: 0.5rem 0.75rem; font-family: var(--font-monospace); font-size: 0.95rem; min-height: 2rem; }
.wikilinked-hint { font-size: 0.82rem; color: var(--text-muted); margin: 0; }

/* ── Footer ── */
.wikilinked-footer { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--background-modifier-border); }

/* ── Sugerencias ── */
.wikilinked-suggestion-text { display: flex; flex-direction: column; min-width: 0; }
.wikilinked-suggestion-name { font-weight: 500; font-size: 0.9rem; }
.wikilinked-suggestion-path { font-size: 0.78rem; color: var(--text-muted); }

/* ── Container modal ── */
.wikilinked-container-list { list-style: none; padding: 0; margin: 0 0 1rem; }
.wikilinked-container-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.5rem; border-radius: 6px; cursor: pointer; transition: background 0.12s; }
.wikilinked-container-item:hover { background: var(--background-modifier-hover); }
.wikilinked-container-name { font-size: 0.9rem; color: var(--text-accent); text-decoration: underline dotted; }

/* ── Modal de etiquetas ── */
.wikilinked-tag-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.75rem 0; min-height: 1.9rem; align-items: center; }
.wikilinked-tag-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.35rem 0.15rem 0.65rem; border-radius: 14px; background: var(--background-modifier-hover); color: var(--text-normal); font-size: 0.85rem; }
.wikilinked-tag-chip--inline { opacity: 0.65; padding-right: 0.65rem; }
.wikilinked-tag-chip-x { border: none; background: transparent; color: var(--text-muted); cursor: pointer; padding: 0 0.25rem; font-size: 0.8rem; box-shadow: none; height: auto; }
.wikilinked-tag-chip-x:hover { color: var(--text-error); }
.wikilinked-tag-input-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
.wikilinked-tag-input { flex: 1; min-width: 0; }
.wikilinked-statusbar { cursor: pointer; }

/* ── Settings: lista de favoritos ── */
.wikilinked-settings-desc { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem; }
.wikilinked-fav-settings-list { margin-bottom: 0.5rem; }
.wikilinked-fav-empty { font-size: 0.85rem; color: var(--text-muted); font-style: italic; }
.wikilinked-fav-settings-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--background-modifier-border);
  margin-bottom: 0.4rem;
  background: var(--background-secondary);
}
.wikilinked-fav-handle { color: var(--text-muted); cursor: grab; font-size: 1rem; flex-shrink: 0; }
.wikilinked-fav-label-input {
  flex: 0 0 130px;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: 0.85rem;
}
.wikilinked-fav-path { flex: 1; font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wikilinked-fav-move {
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
  flex-shrink: 0;
}
.wikilinked-fav-move:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
.wikilinked-fav-move:disabled { opacity: 0.3; cursor: default; }
.wikilinked-fav-delete {
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
  flex-shrink: 0;
  transition: all 0.12s;
}
.wikilinked-fav-delete:hover { background: var(--background-modifier-error); color: var(--text-error); }

/* ── Settings: reglas de etiqueta ── */
.wikilinked-rules-container { margin-bottom: 0.5rem; }
.wikilinked-rule-header-row { display: grid; grid-template-columns: 110px 1fr 34px 105px 34px; gap: 0.4rem; padding: 0.2rem 0.4rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.wikilinked-rule-row { display: grid; grid-template-columns: 110px 1fr 34px 105px 34px; gap: 0.4rem; align-items: center; padding: 0.25rem 0.4rem; border-radius: 5px; margin-bottom: 0.3rem; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); }
.wikilinked-input { padding: 0.2rem 0.4rem; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.83rem; width: 100%; min-width: 0; }
.wikilinked-select { padding: 0.2rem 0.3rem; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: 0.83rem; width: 100%; }

/* ── Settings: pre ── */
.wikilinked-settings-pre { background: var(--code-background); border-radius: 6px; padding: 0.75rem 1rem; font-size: 0.88rem; margin: 0.5rem 0 1rem; }
`;
