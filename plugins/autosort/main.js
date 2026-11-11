/*
  Autosort — Obsidian plugin
  Mueve automáticamente archivos nuevos a subcarpetas según su tipo,
  dentro de las carpetas vigiladas configuradas por el usuario.
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
  default: () => AutosortPlugin
});
module.exports = __toCommonJS(main_exports);

var import_obsidian = require("obsidian");

// ─── Defaults ────────────────────────────────────────────────────────────────

var DEFAULT_SETTINGS = {
  enabled: true,
  watchedFolders: [
    {
      id: "compartidos",
      watchPath: "compartidos",
      rules: [
        { id: "r1", pattern: "*.pdf",      patternType: "extension", destination: "compartidos/libros-y-papers" },
        { id: "r2", pattern: "*.png",      patternType: "extension", destination: "compartidos/imagenes" },
        { id: "r3", pattern: "*.jpg",      patternType: "extension", destination: "compartidos/imagenes" },
        { id: "r4", pattern: "*.jpeg",     patternType: "extension", destination: "compartidos/imagenes" },
        { id: "r5", pattern: "*-notas.md", patternType: "glob",      destination: "compartidos/notas-y-apuntes" },
      ]
    },
    {
      id: "personal",
      watchPath: "personal",
      rules: [
        { id: "r1", pattern: "*.pdf",  patternType: "extension", destination: "personal/documentos" },
        { id: "r2", pattern: "*.png",  patternType: "extension", destination: "personal/imagenes" },
        { id: "r3", pattern: "*.jpg",  patternType: "extension", destination: "personal/imagenes" },
        { id: "r4", pattern: "*.jpeg", patternType: "extension", destination: "personal/imagenes" },
      ]
    }
  ],
  // Reglas por etiqueta: si una nota recibe (manualmente) una de estas
  // etiquetas, se mueve a la carpeta destino indicada — sin importar en
  // qué carpeta del vault esté.
  tagRules: [],
  onConflict: "rename", // "rename" | "overwrite" | "leave"
  showNotices: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Normaliza la ruta de una carpeta del vault:
 *  - usa "/" como separador, sin "/" inicial ni final
 *  - "", "/", "." y "./" significan la RAÍZ del vault y devuelven ""
 * Las rutas de Obsidian son relativas al vault y NUNCA llevan "/" al inicio:
 * "/revisar" y "revisar" son la misma carpeta.
 */
function normalizeFolder(p) {
  let s = (p || "").trim().replace(/\\/g, "/");
  s = s.replace(/\/{2,}/g, "/").replace(/^\.\//, "");
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  return s === "." ? "" : s;
}

/**
 * Convierte lo que escribe el usuario en un valor para guardar en ajustes:
 *  vacío → "" (sin configurar) · "/" o "." → "/" (raíz) · resto → ruta normalizada
 */
function folderForSettings(raw) {
  const trimmed = (raw || "").trim();
  if (trimmed === "") return "";
  const norm = normalizeFolder(trimmed);
  return norm === "" ? "/" : norm;
}

/** Carpeta que contiene a una ruta ("" si está en la raíz del vault). */
function folderOf(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Une carpeta + nombre respetando que la raíz es "". */
function joinPath(folder, name) {
  return folder ? folder + "/" + name : name;
}

/** ¿Esta carpeta vigilada tiene ya una ruta escrita? (vacía = sin configurar) */
function isWatchConfigured(wf) {
  return typeof wf.watchPath === "string" && wf.watchPath.trim() !== "";
}

// Espera antes de mover un archivo recién creado, para que Obsidian termine de
// escribirlo e insertar el enlace (ej: al pegar una imagen).
var MOVE_DELAY_MS = 500;

/**
 * Comprueba si un nombre de archivo coincide con un patrón.
 * patternType "extension" → compara solo la extensión (*.pdf)
 * patternType "glob"      → patrón simple con * al inicio o final (*-notas.md)
 */
function matchesRule(filename, pattern, patternType) {
  if (patternType === "extension") {
    const ext = "*." + filename.split(".").pop().toLowerCase();
    return ext === pattern.toLowerCase();
  }
  // glob simple: convierte * en regex .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$", "i").test(filename);
}

/**
 * Dado un path de destino y un nombre de archivo, devuelve un path
 * que no colisione con ningún archivo existente en el vault.
 * Añade sufijo -2, -3, … antes de la extensión si es necesario.
 */
async function resolveDestPath(vault, destFolder, filename) {
  const base = filename.replace(/\.[^/.]+$/, "");
  const ext  = filename.includes(".") ? "." + filename.split(".").pop() : "";
  let candidate = joinPath(destFolder, filename);
  let counter = 2;
  while (vault.getAbstractFileByPath(candidate)) {
    candidate = joinPath(destFolder, base + "-" + counter + ext);
    counter++;
  }
  return candidate;
}

/**
 * Normaliza una etiqueta para comparar sin '#' y sin distinguir mayúsculas.
 */
function normalizeTag(tag) {
  return (tag || "").trim().replace(/^#/, "").toLowerCase();
}

/**
 * Lee las etiquetas de un archivo que Autosort no puede ver por sí mismo:
 * PDF, imágenes u otros archivos sin propiedades, etiquetados con el plugin
 * Wikilinked (que guarda esas etiquetas en su propio registro, no en el
 * archivo). Si Wikilinked no está instalado o activo, devuelve null.
 */
function getWikilinkedTags(app, file) {
  try {
    const wl = app.plugins && app.plugins.plugins && app.plugins.plugins["wikilinked"];
    if (!wl) return null;
    if (typeof wl.getTags === "function") return wl.getTags(file) || [];
    if (typeof wl.getFileTags === "function") return wl.getFileTags(file).all || [];
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Se asegura de que una carpeta exista en el vault; la crea si no existe.
 */
async function ensureFolder(vault, folderPath) {
  const folder = normalizeFolder(folderPath);
  if (!folder) return; // la raíz siempre existe
  let current = "";
  for (const part of folder.split("/")) {
    current = current ? current + "/" + part : part;
    if (!vault.getAbstractFileByPath(current)) {
      try {
        await vault.createFolder(current);
      } catch (e) {
        // Si otra operación la creó justo ahora, no es un error real.
        if (!vault.getAbstractFileByPath(current)) throw e;
      }
    }
  }
}

// ─── Modal de confirmación de move ───────────────────────────────────────────

var MoveConfirmModal = class extends import_obsidian.Modal {
  constructor(app, file, destination, onConfirm) {
    super(app);
    this.file = file;
    this.destination = destination;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("autosort-modal");
    contentEl.createEl("h2", { text: "📂 Autosort", cls: "autosort-modal-title" });
    contentEl.createEl("p", {
      text: `Se detectó el archivo nuevo:`,
      cls: "autosort-modal-label"
    });
    contentEl.createEl("code", { text: this.file.path, cls: "autosort-modal-path" });
    contentEl.createEl("p", {
      text: `¿Moverlo a:`,
      cls: "autosort-modal-label"
    });
    contentEl.createEl("code", { text: this.destination, cls: "autosort-modal-path autosort-modal-dest" });

    const footer = contentEl.createDiv({ cls: "autosort-footer" });
    new import_obsidian.ButtonComponent(footer)
      .setButtonText("Mover")
      .setCta()
      .onClick(() => { this.onConfirm(true); this.close(); });
    new import_obsidian.ButtonComponent(footer)
      .setButtonText("Dejar aquí")
      .onClick(() => { this.onConfirm(false); this.close(); });
  }
  onClose() { this.contentEl.empty(); }
};

// ─── Settings tab ─────────────────────────────────────────────────────────────

var AutosortSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Autosort — Ajustes" });

    // Toggle global
    new import_obsidian.Setting(containerEl)
      .setName("Plugin activo")
      .setDesc("Activa o desactiva el movimiento automático de archivos.")
      .addToggle(t => t
        .setValue(this.plugin.settings.enabled)
        .onChange(async v => {
          this.plugin.settings.enabled = v;
          await this.plugin.saveSettings();
        })
      );

    new import_obsidian.Setting(containerEl)
      .setName("Mostrar notificaciones")
      .setDesc("Muestra un aviso cada vez que se mueve un archivo.")
      .addToggle(t => t
        .setValue(this.plugin.settings.showNotices)
        .onChange(async v => {
          this.plugin.settings.showNotices = v;
          await this.plugin.saveSettings();
        })
      );

    new import_obsidian.Setting(containerEl)
      .setName("Si el archivo ya existe en destino")
      .addDropdown(d => d
        .addOption("rename",    "Renombrar con sufijo numérico")
        .addOption("overwrite", "Sobreescribir")
        .addOption("leave",     "Dejar en sitio original y notificar")
        .setValue(this.plugin.settings.onConflict)
        .onChange(async v => {
          this.plugin.settings.onConflict = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("hr");
    containerEl.createEl("h3", { text: "📁 Carpetas vigiladas" });
    containerEl.createEl("p", {
      text: "Cada carpeta vigilada tiene su propio conjunto de reglas. Las reglas se evalúan en orden: gana la primera que coincida. Solo se procesan los archivos que caen directamente en la carpeta vigilada (no en sus subcarpetas). Para vigilar la RAÍZ del vault escribe / como carpeta vigilada. Las rutas son relativas al vault (sin / al inicio, y sin el nombre del vault).",
      cls: "autosort-settings-desc"
    });

    // Renderizar cada watched folder
    this.plugin.settings.watchedFolders.forEach((wf, wfIndex) => {
      this.renderWatchedFolder(containerEl, wf, wfIndex);
    });

    // Botón añadir carpeta
    new import_obsidian.Setting(containerEl)
      .addButton(btn => btn
        .setButtonText("+ Añadir carpeta vigilada")
        .setCta()
        .onClick(async () => {
          this.plugin.settings.watchedFolders.push({
            id: generateId(),
            watchPath: "",
            rules: []
          });
          await this.plugin.saveSettings();
          this.display();
        })
      );

    containerEl.createEl("hr");
    containerEl.createEl("h3", { text: "🏷️ Reglas por etiqueta" });
    containerEl.createEl("p", {
      text: "Cuando un archivo reciba una de estas etiquetas, Autosort lo mueve automáticamente a la carpeta indicada — sin importar en qué carpeta del vault esté. En notas .md funciona con el sistema de etiquetas de Obsidian (frontmatter o #etiqueta en el cuerpo). En PDF, imágenes u otros archivos sin propiedades, funciona si tienes instalado el plugin Wikilinked y les asignas ahí la etiqueta. Se evalúan en orden: gana la primera que coincida.",
      cls: "autosort-settings-desc"
    });

    const tagRulesContainer = containerEl.createDiv({ cls: "autosort-rules-container" });
    this.renderTagRules(tagRulesContainer);

    new import_obsidian.Setting(containerEl)
      .addButton(btn => btn
        .setButtonText("+ Añadir regla de etiqueta")
        .setCta()
        .onClick(async () => {
          if (!this.plugin.settings.tagRules) this.plugin.settings.tagRules = [];
          this.plugin.settings.tagRules.push({
            id: generateId(),
            tag: "archivar",
            destination: "archivo"
          });
          await this.plugin.saveSettings();
          this.display();
        })
      )
      .addButton(btn => btn
        .setButtonText("Aplicar reglas ahora a todo el vault")
        .onClick(async () => {
          await this.plugin.applyAllTagRules();
        })
      );

    // Estilos inline de settings (complementan el CSS global)
    this.injectSettingsStyles(containerEl);
  }

  renderTagRules(container) {
    container.empty();
    const tagRules = this.plugin.settings.tagRules || [];

    if (tagRules.length === 0) {
      container.createEl("p", {
        text: "Sin reglas de etiqueta. Añade una con el botón de abajo.",
        cls: "autosort-no-rules"
      });
      return;
    }

    const headerRow = container.createDiv({ cls: "autosort-tagrule-header-row" });
    headerRow.createEl("span", { text: "Etiqueta" });
    headerRow.createEl("span", { text: "→  Destino" });
    headerRow.createEl("span", { text: "" });

    tagRules.forEach((rule, rIndex) => {
      const row = container.createDiv({ cls: "autosort-tagrule-row" });

      // Etiqueta
      const tagInput = row.createEl("input", {
        cls: "autosort-input",
        type: "text",
        value: rule.tag,
        placeholder: "archivar  (sin #)"
      });
      tagInput.addEventListener("change", async () => {
        this.plugin.settings.tagRules[rIndex].tag = normalizeTag(tagInput.value);
        await this.plugin.saveSettings();
      });

      // Destino
      const destInput = row.createEl("input", {
        cls: "autosort-input",
        type: "text",
        value: rule.destination,
        placeholder: "carpeta/subcarpeta"
      });
      destInput.addEventListener("change", async () => {
        const dest = folderForSettings(destInput.value);
        destInput.value = dest;
        this.plugin.settings.tagRules[rIndex].destination = dest;
        await this.plugin.saveSettings();
      });

      // Borrar
      const actions = row.createDiv({ cls: "autosort-rule-col-actions" });
      const delBtn = actions.createEl("button", { cls: "autosort-rule-delete", text: "✕", title: "Eliminar regla" });
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.tagRules.splice(rIndex, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  renderWatchedFolder(containerEl, wf, wfIndex) {
    const box = containerEl.createDiv({ cls: "autosort-wf-box" });

    // Cabecera de la carpeta vigilada
    const header = box.createDiv({ cls: "autosort-wf-header" });
    header.createEl("span", { text: "📂 Carpeta vigilada", cls: "autosort-wf-label" });

    const headerRight = header.createDiv({ cls: "autosort-wf-header-right" });

    // Input path
    const pathInput = headerRight.createEl("input", {
      cls: "autosort-wf-path-input",
      type: "text",
      value: wf.watchPath,
      placeholder: "ej: compartidos   ( / = raíz del vault )"
    });
    pathInput.addEventListener("change", async () => {
      const path = folderForSettings(pathInput.value);
      pathInput.value = path;
      this.plugin.settings.watchedFolders[wfIndex].watchPath = path;
      await this.plugin.saveSettings();
    });

    // Botón eliminar carpeta
    const delFolderBtn = headerRight.createEl("button", {
      cls: "autosort-wf-delete",
      text: "✕",
      title: "Eliminar esta carpeta vigilada"
    });
    delFolderBtn.addEventListener("click", async () => {
      this.plugin.settings.watchedFolders.splice(wfIndex, 1);
      await this.plugin.saveSettings();
      this.display();
    });

    // Tabla de reglas
    const rulesContainer = box.createDiv({ cls: "autosort-rules-container" });
    this.renderRules(rulesContainer, wf, wfIndex);

    // Botón añadir regla
    const addRuleBtn = box.createEl("button", {
      cls: "autosort-add-rule-btn",
      text: "+ Añadir regla"
    });
    addRuleBtn.addEventListener("click", async () => {
      this.plugin.settings.watchedFolders[wfIndex].rules.push({
        id: generateId(),
        pattern: "*.ext",
        patternType: "extension",
        destination: joinPath(normalizeFolder(wf.watchPath), "subcarpeta")
      });
      await this.plugin.saveSettings();
      this.display();
    });
  }

  renderRules(container, wf, wfIndex) {
    container.empty();

    if (wf.rules.length === 0) {
      container.createEl("p", {
        text: "Sin reglas. Añade una con el botón de abajo.",
        cls: "autosort-no-rules"
      });
      return;
    }

    // Encabezados
    const headerRow = container.createDiv({ cls: "autosort-rule-header-row" });
    headerRow.createEl("span", { text: "Tipo", cls: "autosort-rule-col-type" });
    headerRow.createEl("span", { text: "Patrón", cls: "autosort-rule-col-pattern" });
    headerRow.createEl("span", { text: "→  Destino", cls: "autosort-rule-col-dest" });
    headerRow.createEl("span", { text: "", cls: "autosort-rule-col-actions" });

    wf.rules.forEach((rule, rIndex) => {
      const row = container.createDiv({ cls: "autosort-rule-row" });

      // Tipo de patrón
      const typeSelect = row.createEl("select", { cls: "autosort-rule-col-type autosort-select" });
      [["extension", "Extensión"], ["glob", "Glob (*-notas.md)"]].forEach(([val, label]) => {
        const opt = typeSelect.createEl("option", { value: val, text: label });
        if (rule.patternType === val) opt.selected = true;
      });
      typeSelect.addEventListener("change", async () => {
        this.plugin.settings.watchedFolders[wfIndex].rules[rIndex].patternType = typeSelect.value;
        await this.plugin.saveSettings();
      });

      // Patrón
      const patternInput = row.createEl("input", {
        cls: "autosort-rule-col-pattern autosort-input",
        type: "text",
        value: rule.pattern,
        placeholder: "*.pdf  o  *-notas.md"
      });
      patternInput.addEventListener("change", async () => {
        this.plugin.settings.watchedFolders[wfIndex].rules[rIndex].pattern = patternInput.value.trim();
        await this.plugin.saveSettings();
      });

      // Destino
      const destInput = row.createEl("input", {
        cls: "autosort-rule-col-dest autosort-input",
        type: "text",
        value: rule.destination,
        placeholder: "carpeta/subcarpeta"
      });
      destInput.addEventListener("change", async () => {
        const dest = folderForSettings(destInput.value);
        destInput.value = dest;
        this.plugin.settings.watchedFolders[wfIndex].rules[rIndex].destination = dest;
        await this.plugin.saveSettings();
      });

      // Acciones: subir, bajar, borrar
      const actions = row.createDiv({ cls: "autosort-rule-col-actions" });

      const upBtn = actions.createEl("button", { cls: "autosort-rule-move", text: "↑", title: "Subir regla" });
      upBtn.disabled = rIndex === 0;
      upBtn.addEventListener("click", async () => {
        if (rIndex === 0) return;
        const rules = this.plugin.settings.watchedFolders[wfIndex].rules;
        [rules[rIndex - 1], rules[rIndex]] = [rules[rIndex], rules[rIndex - 1]];
        await this.plugin.saveSettings();
        this.display();
      });

      const downBtn = actions.createEl("button", { cls: "autosort-rule-move", text: "↓", title: "Bajar regla" });
      downBtn.disabled = rIndex === wf.rules.length - 1;
      downBtn.addEventListener("click", async () => {
        if (rIndex === wf.rules.length - 1) return;
        const rules = this.plugin.settings.watchedFolders[wfIndex].rules;
        [rules[rIndex], rules[rIndex + 1]] = [rules[rIndex + 1], rules[rIndex]];
        await this.plugin.saveSettings();
        this.display();
      });

      const delBtn = actions.createEl("button", { cls: "autosort-rule-delete", text: "✕", title: "Eliminar regla" });
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.watchedFolders[wfIndex].rules.splice(rIndex, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  injectSettingsStyles(el) {
    // Evitar duplicar el bloque si ya existe
    if (el.querySelector("#autosort-settings-styles")) return;
    const s = el.createEl("style");
    s.id = "autosort-settings-styles";
    s.textContent = `
      .autosort-settings-desc { font-size:0.85rem; color:var(--text-muted); margin-bottom:0.75rem; }
      .autosort-wf-box { border:1px solid var(--background-modifier-border); border-radius:8px; padding:0.75rem 1rem; margin-bottom:1rem; background:var(--background-secondary); }
      .autosort-wf-header { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.6rem; flex-wrap:wrap; }
      .autosort-wf-label { font-weight:600; font-size:0.9rem; white-space:nowrap; }
      .autosort-wf-header-right { display:flex; align-items:center; gap:0.5rem; flex:1; flex-wrap:wrap; }
      .autosort-wf-path-input { flex:1; min-width:140px; padding:0.25rem 0.5rem; border-radius:4px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:0.88rem; }
      .autosort-wf-delete { padding:0.2rem 0.5rem; border-radius:4px; border:none; background:transparent; color:var(--text-muted); cursor:pointer; font-size:0.9rem; }
      .autosort-wf-delete:hover { background:var(--background-modifier-error); color:var(--text-error); }
      .autosort-rules-container { margin-bottom:0.5rem; }
      .autosort-no-rules { font-size:0.83rem; color:var(--text-muted); font-style:italic; }
      .autosort-rule-header-row { display:grid; grid-template-columns:120px 1fr 1fr 80px; gap:0.4rem; padding:0.2rem 0.4rem; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); }
      .autosort-rule-row { display:grid; grid-template-columns:120px 1fr 1fr 80px; gap:0.4rem; align-items:center; padding:0.25rem 0.4rem; border-radius:5px; margin-bottom:0.3rem; background:var(--background-primary); border:1px solid var(--background-modifier-border); }
      .autosort-select { padding:0.2rem 0.3rem; border-radius:4px; border:1px solid var(--background-modifier-border); background:var(--background-secondary); color:var(--text-normal); font-size:0.83rem; width:100%; }
      .autosort-input { padding:0.2rem 0.4rem; border-radius:4px; border:1px solid var(--background-modifier-border); background:var(--background-secondary); color:var(--text-normal); font-size:0.83rem; width:100%; }
      .autosort-rule-col-actions { display:flex; gap:0.25rem; justify-content:flex-end; }
      .autosort-rule-move { padding:0.15rem 0.35rem; border-radius:4px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-muted); cursor:pointer; font-size:0.8rem; }
      .autosort-rule-move:hover { color:var(--text-normal); }
      .autosort-rule-move:disabled { opacity:0.3; cursor:default; }
      .autosort-rule-delete { padding:0.15rem 0.4rem; border-radius:4px; border:none; background:transparent; color:var(--text-muted); cursor:pointer; font-size:0.8rem; }
      .autosort-rule-delete:hover { background:var(--background-modifier-error); color:var(--text-error); }
      .autosort-add-rule-btn { margin-top:0.3rem; padding:0.3rem 0.75rem; border-radius:6px; border:1.5px dashed var(--background-modifier-border); background:transparent; color:var(--text-muted); cursor:pointer; font-size:0.84rem; }
      .autosort-add-rule-btn:hover { border-color:var(--interactive-accent); color:var(--interactive-accent); }
      .autosort-tagrule-header-row { display:grid; grid-template-columns:1fr 1fr 40px; gap:0.4rem; padding:0.2rem 0.4rem; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); }
      .autosort-tagrule-row { display:grid; grid-template-columns:1fr 1fr 40px; gap:0.4rem; align-items:center; padding:0.25rem 0.4rem; border-radius:5px; margin-bottom:0.3rem; background:var(--background-primary); border:1px solid var(--background-modifier-border); }
    `;
  }
};

// ─── Plugin principal ─────────────────────────────────────────────────────────

var AutosortPlugin = class extends import_obsidian.Plugin {

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AutosortSettingTab(this.app, this));

    // Comando para activar/desactivar rápido
    this.addCommand({
      id: "toggle-autosort",
      name: "Activar / desactivar Autosort",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        new import_obsidian.Notice(this.settings.enabled ? "✅ Autosort activado" : "⏸ Autosort desactivado");
      }
    });

    this.addCommand({
      id: "apply-tag-rules",
      name: "Aplicar reglas de etiqueta a todo el vault",
      callback: () => this.applyAllTagRules()
    });

    // Rutas que el propio plugin acaba de mover (para no reprocesarlas)
    this._selfMoves = new Set();

    // Los eventos "create" también se disparan para CADA archivo existente
    // mientras Obsidian indexa el vault al abrirse. Si vigilas la raíz, eso
    // movería todo lo que ya estaba ahí. Por eso se registran recién cuando
    // el workspace está listo.
    this.app.workspace.onLayoutReady(() => {
      // Evento: archivo creado en el vault (ej: pegar imagen desde clipboard)
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (!(file instanceof import_obsidian.TFile)) return;
          if (!this.settings.enabled) return;
          setTimeout(() => this.handleNewFile(file), MOVE_DELAY_MS);
        })
      );

      // Evento: archivo movido/renombrado (ej: arrastrarlo a una carpeta vigilada)
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (!(file instanceof import_obsidian.TFile)) return;
          if (!this.settings.enabled) return;

          // Movimiento hecho por el propio plugin → ignorar (evita bucles)
          if (this._selfMoves.has(file.path)) {
            this._selfMoves.delete(file.path);
            return;
          }

          // Si el origen ya era una carpeta vigilada, ignorar.
          // Raíz: solo cuenta lo que estaba directamente en la raíz.
          // Resto: cuenta cualquier profundidad dentro de la carpeta.
          const movedFromWatched = this.settings.watchedFolders.some(wf => {
            if (!isWatchConfigured(wf)) return false;
            const wfFolder = normalizeFolder(wf.watchPath);
            if (wfFolder === "") return folderOf(oldPath) === "";
            return oldPath.startsWith(wfFolder + "/");
          });
          if (movedFromWatched) return;

          setTimeout(() => this.handleNewFile(file), MOVE_DELAY_MS);
        })
      );
    });

    // Evento: los metadatos de una nota cambiaron (ej: se agregó una etiqueta
    // en el frontmatter o como #etiqueta en el cuerpo). Se vigila TODO el
    // vault, no solo las carpetas vigiladas por extensión.
    this._tagMoveTimers = new Map();
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, data, cache) => {
        if (!(file instanceof import_obsidian.TFile)) return;
        if (!this.settings.enabled) return;
        if (file.extension !== "md") return;
        if (!this.settings.tagRules || this.settings.tagRules.length === 0) return;

        // Debounce por archivo: evita mover a mitad de una edición rápida.
        if (this._tagMoveTimers.has(file.path)) {
          clearTimeout(this._tagMoveTimers.get(file.path));
        }
        const timer = setTimeout(() => {
          this._tagMoveTimers.delete(file.path);
          this.handleTagChange(file, cache);
        }, 400);
        this._tagMoveTimers.set(file.path, timer);
      })
    );

    // Evento: el plugin Wikilinked etiquetó (o desetiquetó) un archivo SIN
    // propiedades — PDF, imagen, etc. — que Autosort no puede ver por sí
    // mismo. Si Wikilinked no está instalado, este evento simplemente nunca
    // se dispara y no pasa nada.
    this.registerEvent(
      this.app.workspace.on("wikilinked:tags-changed", (file) => {
        if (!(file instanceof import_obsidian.TFile)) return;
        if (!this.settings.enabled) return;
        if (!this.settings.tagRules || this.settings.tagRules.length === 0) return;

        if (this._tagMoveTimers.has(file.path)) {
          clearTimeout(this._tagMoveTimers.get(file.path));
        }
        const timer = setTimeout(() => {
          this._tagMoveTimers.delete(file.path);
          this.handleExternalTagChange(file);
        }, 400);
        this._tagMoveTimers.set(file.path, timer);
      })
    );

    this.loadStyles();
    console.log("Autosort plugin loaded ✓");
  }

  async onunload() {
    if (this._tagMoveTimers) {
      for (const timer of this._tagMoveTimers.values()) clearTimeout(timer);
      this._tagMoveTimers.clear();
    }
    console.log("Autosort plugin unloaded");
  }

  /**
   * Lógica principal: dado un archivo recién creado, busca si cae dentro
   * de alguna carpeta vigilada y si coincide con alguna regla.
   */
  async handleNewFile(file) {
    // Verificar que el archivo sigue existiendo (puede haberse movido ya)
    if (!this.app.vault.getAbstractFileByPath(file.path)) return;

    const fileFolder = folderOf(file.path); // "" si está en la raíz del vault

    for (const wf of this.settings.watchedFolders) {
      if (!isWatchConfigured(wf)) continue;
      const watchFolder = normalizeFolder(wf.watchPath); // "" = raíz

      // ¿El archivo está DIRECTAMENTE dentro de esta carpeta vigilada?
      // (no en subcarpetas de ella — evita loops al mover)
      if (fileFolder !== watchFolder) continue;

      // Buscar la primera regla que coincida
      for (const rule of wf.rules) {
        if (!rule.pattern || !rule.destination || !rule.destination.trim()) continue;
        if (!matchesRule(file.name, rule.pattern, rule.patternType)) continue;

        // La regla coincide — calcular destino
        await this.moveFile(file, rule.destination);
        return; // primera regla gana
      }
    }
  }

  /**
   * Núcleo compartido: dado un archivo y su lista actual de etiquetas (ya
   * sean del frontmatter/cuerpo de una nota, o del registro de Wikilinked
   * para archivos sin propiedades), aplica las reglas de etiqueta y mueve el
   * archivo a la carpeta destino de la primera regla que coincida.
   */
  async applyTagRulesForFile(file, rawTags) {
    // El archivo puede haberse eliminado o movido mientras esperábamos el debounce
    if (!this.app.vault.getAbstractFileByPath(file.path)) return;
    if (!this.settings.tagRules || this.settings.tagRules.length === 0) return;

    const currentTags = (rawTags || []).map(t => normalizeTag(t));
    if (currentTags.length === 0) return;

    for (const rule of this.settings.tagRules) {
      const ruleTag = normalizeTag(rule.tag);
      if (!ruleTag || !rule.destination) continue;
      if (!currentTags.includes(ruleTag)) continue;

      // Si ya está dentro de la carpeta destino, no hacer nada (evita loops).
      const destFolder = normalizeFolder(rule.destination);
      if (destFolder && file.path.startsWith(destFolder + "/")) return;

      await this.moveFile(file, rule.destination);
      return; // primera regla de etiqueta que coincide gana
    }
  }

  /**
   * Dada una nota cuyos metadatos acaban de cambiar (etiqueta agregada en el
   * frontmatter o como #etiqueta en el cuerpo), aplica las reglas de etiqueta.
   */
  async handleTagChange(file, cache) {
    if (!this.app.vault.getAbstractFileByPath(file.path)) return;
    // Si no nos pasaron cache (o quedó desactualizado), lo releemos.
    const fileCache = cache || this.app.metadataCache.getFileCache(file);
    if (!fileCache) return;
    const rawTags = import_obsidian.getAllTags(fileCache) || [];
    await this.applyTagRulesForFile(file, rawTags);
  }

  /**
   * Un archivo SIN propiedades (PDF, imagen, …) recibió o perdió una
   * etiqueta en el plugin Wikilinked. Aplica las reglas de etiqueta con el
   * estado más reciente de sus etiquetas (se relee por si cambió de nuevo
   * mientras esperábamos el debounce).
   */
  async handleExternalTagChange(file) {
    const tags = getWikilinkedTags(this.app, file);
    if (tags === null) return; // Wikilinked no está disponible
    await this.applyTagRulesForFile(file, tags);
  }

  /**
   * Recorre todo el vault y aplica las reglas de etiqueta a lo que ya esté
   * etiquetado: notas .md (etiquetas nativas de Obsidian) y, si Wikilinked
   * está instalado, también PDF/imágenes/otros con etiquetas en su registro.
   */
  async applyAllTagRules() {
    if (!this.settings.tagRules || this.settings.tagRules.length === 0) {
      new import_obsidian.Notice("Autosort: aún no hay reglas de etiqueta configuradas.");
      return;
    }
    let moved = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      const before = file.path;
      const cache = this.app.metadataCache.getFileCache(file);
      const rawTags = (cache && import_obsidian.getAllTags(cache)) || [];
      await this.applyTagRulesForFile(file, rawTags);
      if (file.path !== before) moved++;
    }

    const wl = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["wikilinked"];
    const fileTags = wl && wl.settings && wl.settings.fileTags;
    if (fileTags) {
      for (const path of Object.keys(fileTags)) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian.TFile)) continue;
        const before = file.path;
        const tags = getWikilinkedTags(this.app, file) || [];
        await this.applyTagRulesForFile(file, tags);
        if (file.path !== before) moved++;
      }
    }

    new import_obsidian.Notice(moved > 0
      ? `📂 Autosort: ${moved} archivo(s) movidos.`
      : "Autosort: nada que mover, ya estaba todo en su sitio.");
  }

  async moveFile(file, destFolder) {
    // "/revisar", "revisar/" y "revisar" son lo mismo; "/" es la raíz del vault
    const dest = normalizeFolder(destFolder);

    // Ya está en su carpeta destino → nada que hacer (evita bucles)
    if (folderOf(file.path) === dest) return;

    // Asegurarse de que la carpeta destino existe (crea también las intermedias)
    try {
      await ensureFolder(this.app.vault, dest);
    } catch (e) {
      new import_obsidian.Notice(`❌ Autosort: no se pudo crear la carpeta "${dest}". ${e.message}`);
      console.error("Autosort ensureFolder error:", e);
      return;
    }

    const existingAtDest = this.app.vault.getAbstractFileByPath(joinPath(dest, file.name));

    if (existingAtDest) {
      if (this.settings.onConflict === "leave") {
        if (this.settings.showNotices) {
          new import_obsidian.Notice(`⚠️ Autosort: "${file.name}" ya existe en ${dest || "/"}. Se deja en su lugar.`);
        }
        return;
      }
      if (this.settings.onConflict === "overwrite") {
        await this.app.vault.delete(existingAtDest);
      }
      // "rename" → se resuelve en resolveDestPath
    }

    const destPath = this.settings.onConflict === "rename"
      ? await resolveDestPath(this.app.vault, dest, file.name)
      : joinPath(dest, file.name);

    this._selfMoves.add(destPath);
    setTimeout(() => this._selfMoves.delete(destPath), 3000);

    try {
      // fileManager.renameFile (a diferencia de vault.rename) actualiza los
      // enlaces que apuntan al archivo, según tus ajustes de Obsidian.
      await this.app.fileManager.renameFile(file, destPath);
      if (this.settings.showNotices) {
        new import_obsidian.Notice(`📂 Autosort: "${file.name}" → ${destPath}`);
      }
    } catch (e) {
      this._selfMoves.delete(destPath);
      new import_obsidian.Notice(`❌ Autosort: no se pudo mover "${file.name}". ${e.message}`);
      console.error("Autosort move error:", e);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Migración defensiva: asegurar que watchedFolders existe
    if (!this.settings.watchedFolders) {
      this.settings.watchedFolders = DEFAULT_SETTINGS.watchedFolders;
    }
    if (!this.settings.tagRules) {
      this.settings.tagRules = [];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  loadStyles() {
    const style = document.createElement("style");
    style.id = "autosort-styles";
    style.textContent = CSS_CONTENT;
    document.head.appendChild(style);
    this.register(() => style.remove());
  }
};

// ─── CSS ─────────────────────────────────────────────────────────────────────

var CSS_CONTENT = `
/* ── Modal ── */
.autosort-modal { padding: 0.5rem 0.25rem; }
.autosort-modal-title { font-size: 1.2rem; font-weight: 700; color: var(--text-accent); margin-bottom: 0.75rem; }
.autosort-modal-label { font-size: 0.85rem; color: var(--text-muted); margin: 0.5rem 0 0.2rem; }
.autosort-modal-path { display: block; background: var(--code-background); color: var(--code-normal); border-radius: 5px; padding: 0.3rem 0.6rem; font-family: var(--font-monospace); font-size: 0.88rem; margin-bottom: 0.2rem; word-break: break-all; }
.autosort-modal-dest { color: var(--text-accent); }
.autosort-footer { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--background-modifier-border); }
`;
