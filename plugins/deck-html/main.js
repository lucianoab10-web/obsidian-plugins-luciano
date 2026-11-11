/* Deck HTML — plugin de Obsidian
 * Notas del vault (+ sus imágenes) → presentación HTML estilo PPT/Canva, con la API de Claude.
 */
"use strict";
const obsidian = require("obsidian");
const { Plugin, Modal, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFile, requestUrl, normalizePath } = obsidian;

// ───────────────────────────── Constantes ─────────────────────────────
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
const PH_PREFIX = "data:image/svg+xml;charset=utf-8,%3Csvg%20data-deck-ph%3D%22";
const MAX_TOTAL_CHARS = 300000;
const BRAND_MAX_CHARS = 30000;
const MAX_DECKS_KEPT = 25;

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-haiku-5-5",
  maxTokens: 32000,
  brandFile: "Brand/guia-de-marca.md",
  outputFolder: "Presentaciones",
  language: "Spanish",
  maxImages: 24,
  maxImagePx: 1600,
  speakerNotes: true,
  saveLite: true,
  decks: {},
};

const BRAND_TEMPLATE = "---\ntipo: guia-de-marca\n---\n# Guía de marca\n\n> Esta nota la lee el plugin **Deck HTML** en cada presentación, y también puedes subirla a tu proyecto de Claude o ChatGPT para que las iteraciones respeten tu identidad. Rellena lo que aplique y borra el resto. Cuanto más concreta (códigos HEX, nombres de fuentes, reglas medibles), mejor el resultado.\n\n## 1. Identidad\n- **Nombre de la marca / proyecto:**\n- **Qué hace y para quién:**\n- **Personalidad (3 adjetivos):** (ej.: sobria, técnica, cercana)\n\n## 2. Colores\n| Rol | Nombre | HEX | Uso |\n|---|---|---|---|\n| Primario | | #______ | Portada, títulos, elementos clave |\n| Secundario | | #______ | Subtítulos, íconos, apoyo |\n| Acento | | #______ | Resaltar una cifra o una llamada a la acción (con moderación) |\n| Fondo claro | | #______ | Diapositivas de contenido |\n| Fondo oscuro | | #______ | Portada y separadores de sección |\n| Texto | | #______ | Cuerpo de texto (contraste mínimo 4.5:1 sobre el fondo) |\n\n**Reglas de color:** (ej.: máximo 3 colores por diapositiva; el acento nunca como fondo)\n\n## 3. Tipografía\n- **Títulos:** (fuente y peso, ej.: Montserrat Bold)\n- **Cuerpo:** (ej.: Inter Regular)\n- **Alternativa si la fuente no está disponible:** (ej.: Arial, sans-serif)\n- **Tamaños orientativos** en una diapositiva de 1280×720 px: título 44–56 px, subtítulo 28–32 px, cuerpo 22–26 px.\n\n## 4. Logo\n- **Archivo:** ![[logo.png]]  *(incrusta aquí tu logo; el plugin se lo envía a Claude como recurso de marca)*\n- **Dónde va:** (ej.: portada centrada; en el resto, esquina inferior derecha, 120 px de ancho)\n- **Espacio libre y versiones:** (ej.: versión clara sobre fondos oscuros)\n- **Nunca:** deformarlo, recolorearlo ni ponerlo sobre fondos con poco contraste.\n\n## 5. Estilo visual\n- **Dirección general:** (minimalista / editorial / corporativo / científico…)\n- **Formas y bordes:** (ej.: esquinas redondeadas de 12 px, sin sombras duras)\n- **Imágenes:** (ej.: a sangre completa en portadas; con marco y pie de figura en el resto)\n- **Íconos e ilustraciones:** (estilo de línea, relleno, librería preferida)\n- **Fondos:** (planos, degradados sutiles, texturas…)\n\n## 6. Reglas de contenido\n- Máximo 5 viñetas por diapositiva, de 12 a 14 palabras cada una.\n- Un mensaje por diapositiva; el título enuncia la conclusión, no solo el tema.\n- Cifras importantes en tamaño grande.\n- Estructura típica: Portada → Contexto → Desarrollo → Conclusiones → Cierre.\n\n## 7. Tono de voz\n- **Idioma y tratamiento:** (ej.: español neutro, tuteo)\n- **Vocabulario:** (términos técnicos permitidos / a evitar)\n\n## 8. Evitar\n- (ej.: clip art, más de 2 fuentes, texto sobre imágenes sin contraste, animaciones recargadas)\n\n## Tokens (opcional)\n```yaml\nbrand:\n  name: \"\"\n  colors:\n    primary: \"#______\"\n    secondary: \"#______\"\n    accent: \"#______\"\n    background_light: \"#______\"\n    background_dark: \"#______\"\n    text: \"#______\"\n  fonts:\n    heading: \"\"\n    body: \"\"\n  logo: \"logo.png\"\n```\n";

const SYSTEM_PROMPT = `You are a senior presentation designer and front-end engineer. You turn the user's notes into ONE polished, self-contained HTML slide deck that looks like a professional PowerPoint/Canva presentation.

OUTPUT FORMAT
- Reply with the complete HTML document only: it must start with <!DOCTYPE html> and end with </html>. No markdown fences, no explanations before or after.
- A single file: all CSS in one <style>, all JS in one <script>. No external JS, CSS frameworks, CDN or remote images. The only exception: a <link> to Google Fonts if (and only if) the brand guidelines name a Google Font; always add a system-font fallback stack.
- <html lang="..."> must match the deck language; include a meaningful <title>.

DECK STRUCTURE
- Every slide is <section class="slide"> inside <main class="deck">. Slides are a fixed 1280x720 px (16:9) canvas; design with absolute pixel sizes inside it.
- The deck scales to fit any viewport (JS: scale = min(innerWidth/1280, innerHeight/720), applied with transform and centered, letterboxing in the brand's background colour). Show one slide at a time.
- Navigation: arrow keys, PageUp/PageDown, Space, Home/End, click or tap on the right/left side, touch swipe; a thin progress bar and a slide counter (e.g. 3 / 12); "F" toggles fullscreen; "O" toggles an overview grid of thumbnails; keep location.hash (#3) in sync so slides can be linked.
- Speaker notes (only when requested): put them in <aside class="notes"> inside each slide. Hidden by default; "N" toggles them in a small panel; never printed.
- Print / PDF: @page { size: 1280px 720px; margin: 0 } plus @media print rules so that ALL slides print, one per page, unscaled, with backgrounds (-webkit-print-color-adjust: exact; print-color-adjust: exact), no navigation chrome and no notes.

DESIGN
- Build a consistent design system with CSS variables on :root (colors, fonts, spacing, radius). If brand guidelines are provided they override everything below: use their exact colors, fonts, logo rules, tone and layout rules.
- Without brand guidelines choose one tasteful, modern palette (1 primary, 1 accent, neutrals) and at most 2 font families.
- Vary the layouts for rhythm: title slide, section dividers, key-message slide, bullets, two columns, image + text, big numbers, simple diagrams (inline SVG or CSS: process, timeline, comparison, cycle), quote, closing slide. Never use the same layout more than twice in a row.
- Typography: titles 40-56 px, body >= 22 px, strong hierarchy, line length <= 70 characters. Generous margins (>= 64 px) and whitespace. Good contrast.
- Text must NEVER overflow a slide: at most 5 bullets per slide, at most 14 words each; split content across slides instead of shrinking text. Titles state the takeaway, not just the topic.
- Subtle polish is welcome (soft shadows, rounded cards, accent shapes, fade/slide transitions <= 400 ms, respect prefers-reduced-motion). No gimmicks, no clip art, no emoji unless the notes use them.
- Use semantic HTML (h1/h2, ul/li, figure/figcaption) and alt text on images.

CONTENT
- Use ONLY the information in the notes (and the brand guidelines for style). Do not invent facts, numbers, quotes, citations or sources. You may restructure, condense and write connective titles. Keep technical terms, formulas and data exactly as written.
- Respect the requested language, length and extra instructions. If no length is given, choose what the material needs (typically 8-14 slides).
- Start with a title slide and end with a closing or summary slide.

IMAGES
- The notes mention images as [IMG_n: caption] and the images are attached so you can see them. Choose the ones that genuinely support each slide and place them next to the related text. Use <img src="{{IMG_n}}" alt="..."> or CSS background-image: url('{{IMG_n}}'). Write the placeholder exactly as {{IMG_n}}; the software replaces it with the real file. NEVER write base64 and never invent IDs.
- Use each image at most once, except brand assets (e.g. the logo): define those ONCE in a CSS class (background-image: url('{{IMG_n}}')) and reuse the class.
- Use object-fit: contain for diagrams, charts and screenshots (never crop them) and cover for photos; keep aspect ratios.
- Images marked BRAND ASSET follow the brand guidelines (logo placement, etc.).`;

// ───────────────────────────── Utilidades puras ─────────────────────────────
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escXml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function slugify(name) {
  const t = String(name || "").replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return t || "Presentación";
}

function cleanMarkdown(md) {
  let t = md.replace(/^\uFEFF/, "");
  t = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  t = t.replace(/%%[\s\S]*?%%/g, "");
  t = t.replace(/(?<!!)\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g, (m, page, heading, alias) => alias || (heading ? `${page} › ${heading}` : page));
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function parseMdImageTarget(raw) {
  let t = raw.trim();
  if (t.startsWith("<")) {
    const end = t.indexOf(">");
    if (end > 0) return t.slice(1, end);
  }
  return t.replace(/\s+["'][^"']*["']\s*$/, "");
}

function extractHtml(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && /<[a-z!]/i.test(fence[1])) t = fence[1].trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  const end = t.toLowerCase().lastIndexOf("</html>");
  if (end !== -1) t = t.slice(0, end + 7);
  return t;
}

function countSlides(html) {
  return (html.match(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b/gi) || []).length;
}

function getTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function injectMeta(html, deckId) {
  const meta = `<meta name="deck-id" content="${deckId}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (h) => `${h}\n${meta}`);
  return `${meta}\n${html}`;
}

function placeholderUri(id, label, w, h) {
  const W = 800;
  const H = Math.max(200, Math.min(800, Math.round(W * ((h || 450) / (w || 800)))));
  const svg =
    `<svg data-deck-ph="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
    `<rect width="${W}" height="${H}" fill="#E5E7EB"/>` +
    `<path d="M0 0L${W} ${H}M${W} 0L0 ${H}" stroke="#CBD5E1" stroke-width="3"/>` +
    `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" fill="#475569">${escXml(id)} · ${escXml(label || "")}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

const TOKEN_RE = /\{\{\s*(IMG_\d+)\s*\}\}|(\b(?:src|href)=)(["'])(IMG_\d+)\3/g;
function replaceImageTokens(html, resolve) {
  return html.replace(TOKEN_RE, (m, id1, attr, q, id2) => (id1 ? resolve(id1) : `${attr}${q}${resolve(id2)}${q}`));
}
const PH_RE = new RegExp(escapeRegExp(PH_PREFIX) + "[^\"'()\\s]*", "g");

function formatBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

// ───────────────────────────── Imágenes ─────────────────────────────
class ImageRegistry {
  constructor(max) { this.max = max; this.byPath = new Map(); this.list = []; }
  add(file, alt, from, brand) {
    let e = this.byPath.get(file.path);
    if (!e) {
      if (this.list.length >= this.max) return null;
      e = { id: `IMG_${this.list.length + 1}`, file, alt: "", from: new Set(), brand: !!brand, data: null };
      this.byPath.set(file.path, e);
      this.list.push(e);
    }
    if (alt && !e.alt) e.alt = alt;
    e.from.add(from);
    return e;
  }
}

function resolveFile(app, linkpath, sourcePath) {
  let lp = String(linkpath || "").trim();
  try { lp = decodeURIComponent(lp); } catch (e) { /* se deja tal cual */ }
  lp = lp.split("#")[0].trim();
  if (!lp) return null;
  const f = app.metadataCache.getFirstLinkpathDest(lp, sourcePath);
  if (f) return f;
  const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const af = app.vault.getAbstractFileByPath(normalizePath(dir ? `${dir}/${lp}` : lp));
  return af instanceof TFile ? af : null;
}

/** Sustituye las imágenes incrustadas por marcadores [IMG_n: pie] y las registra. */
function processNoteImages(app, md, sourcePath, noteTitle, registry, includeImages, brand) {
  const skipped = [];
  const stripped = md.replace(/%%[\s\S]*?%%/g, "");
  const text = stripped.replace(/!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (m, wiki, alt, mdpath) => {
    let target, caption = "";
    if (wiki !== undefined) {
      const parts = wiki.split("|");
      target = parts[0];
      const alias = parts.slice(1).join("|").trim();
      if (alias && !/^\d+(x\d+)?$/.test(alias)) caption = alias;
    } else {
      target = parseMdImageTarget(mdpath);
      caption = (alt || "").trim();
    }
    if (/^(https?:|data:)/i.test(target)) return caption ? `[Imagen externa omitida: ${caption}]` : "[Imagen externa omitida]";
    const file = resolveFile(app, target, sourcePath);
    if (!file) return `[Archivo no encontrado: ${target.trim()}]`;
    const ext = String(file.extension || "").toLowerCase();
    if (!IMAGE_EXT.has(ext)) return ext === "md" ? `[Nota incrustada: ${file.basename}]` : `[Archivo incrustado: ${file.name}]`;
    if (!includeImages) return `[Imagen: ${caption || file.basename}]`;
    const entry = registry.add(file, caption || file.basename, noteTitle, brand);
    if (!entry) { skipped.push(file.name); return `[Imagen omitida por límite: ${file.name}]`; }
    return `[${entry.id}: ${entry.alt}]`;
  });
  return { text, skipped };
}

async function prepareImage(app, file, maxPx) {
  const ext = String(file.extension || "").toLowerCase();
  const buf = await app.vault.readBinary(file);
  if (ext === "svg") {
    const text = new TextDecoder().decode(buf);
    return { mediaType: "image/svg+xml", base64: btoa(unescape(encodeURIComponent(text))), vision: false, width: 0, height: 0, bytes: buf.byteLength };
  }
  const srcType = MIME[ext] || "image/png";
  try {
    const bmp = await createImageBitmap(new Blob([buf], { type: srcType }));
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    if (scale >= 1 && buf.byteLength <= 900 * 1024 && ext !== "gif") {
      return { mediaType: srcType, base64: obsidian.arrayBufferToBase64(buf), vision: true, width: bmp.width, height: bmp.height, bytes: buf.byteLength };
    }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
    let blob;
    if (ext === "jpg" || ext === "jpeg") {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
      blob = await toBlob("image/jpeg", 0.85);
    } else {
      ctx.drawImage(bmp, 0, 0, w, h);
      blob = await toBlob("image/png");
      if (blob && blob.size > 1.2 * 1024 * 1024) {
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
        blob = await toBlob("image/jpeg", 0.85);
      }
    }
    if (!blob) throw new Error("canvas vacío");
    const out = await blob.arrayBuffer();
    return { mediaType: blob.type || "image/png", base64: obsidian.arrayBufferToBase64(out), vision: true, width: w, height: h, bytes: out.byteLength };
  } catch (e) {
    if (buf.byteLength <= 4 * 1024 * 1024) {
      return { mediaType: srcType, base64: obsidian.arrayBufferToBase64(buf), vision: true, width: 0, height: 0, bytes: buf.byteLength };
    }
    return null;
  }
}

// ───────────────────────────── Mensaje para Claude ─────────────────────────────
const LENGTH_TEXT = {
  auto: "Choose the number of slides the material needs (typically 8-14).",
  short: "About 6 slides.",
  medium: "About 10 slides.",
  long: "About 16 slides.",
};

function buildContent({ brandText, opts, notes, registry }) {
  const parts = [];
  if (brandText) parts.push(`<brand_guidelines>\n${brandText}\n</brand_guidelines>`);
  parts.push(
    `<instructions>\nLanguage of the slides: ${opts.language}\nLength: ${LENGTH_TEXT[opts.length] || LENGTH_TEXT.auto}\n` +
    `Speaker notes: ${opts.speakerNotes ? "include concise speaker notes (2-4 sentences) in every slide" : "do not include speaker notes"}\n` +
    `Extra instructions from the user: ${opts.instructions || "(none)"}\n</instructions>`
  );
  parts.push("<notes>\n" + notes.map((n, i) => `<note index="${i + 1}" title="${escAttr(n.title)}">\n${n.text}\n</note>`).join("\n") + "\n</notes>");
  if (registry.list.length) {
    parts.push(
      "<images>\n" +
      registry.list.map((e) =>
        `${e.id} — ${e.file.name}${e.brand ? " (BRAND ASSET)" : ""}${e.alt ? ` — caption: ${e.alt}` : ""}` +
        `${e.failed ? " — NOT AVAILABLE, do not use" : ""}${e.data && e.data.vision === false ? " — vector image (not visible to you, but it can be used)" : ""}`
      ).join("\n") + "\n</images>"
    );
  }
  const blocks = [{ type: "text", text: parts.join("\n\n") }];
  for (const e of registry.list) {
    if (e.failed || !e.data || e.data.vision === false) continue;
    blocks.push({ type: "text", text: `${e.id} (${e.file.name}):` });
    blocks.push({ type: "image", source: { type: "base64", media_type: e.data.mediaType, data: e.data.base64 } });
  }
  blocks.push({ type: "text", text: "Create the complete HTML deck now. Output only the HTML document." });
  return blocks;
}

// ───────────────────────────── API de Claude ─────────────────────────────
async function callClaude(settings, content, onRetry) {
  const model = (settings.model || DEFAULT_SETTINGS.model).trim();
  const retryable = [429, 500, 503, 504, 529];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let maxTokens = Number(settings.maxTokens) || DEFAULT_SETTINGS.maxTokens;
  let response = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Los modelos 5.5 no admiten temperature/top_p/top_k (error 400): no se envían.
    response = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM_PROMPT, messages: [{ role: "user", content }] }),
      throw: false,
    });
    if (response.status === 400 && maxTokens > 16000 && /max_tokens/i.test(String(response.text || ""))) {
      maxTokens = 16000;   // el modelo elegido admite menos salida: reintenta con un tope menor
      attempt--;
      continue;
    }
    if (!retryable.includes(response.status)) break;
    if (attempt < 2) { if (onRetry) onRetry(response.status, attempt + 1); await sleep(3000 * (attempt + 1)); }
  }
  let data = {};
  try { data = response.json || {}; } catch (e) { data = {}; }
  const apiMsg = (data.error && data.error.message) || response.text || "sin detalle";
  if (/credit balance/i.test(apiMsg)) throw new Error("Sin saldo en la API de Claude. Recarga créditos en platform.claude.com → Plans & Billing.");
  if (response.status === 401) throw new Error("La API key de Anthropic no es válida (401). Revísala en los ajustes del plugin.");
  if (response.status === 403) throw new Error(`La API de Claude rechazó la solicitud por permisos (403). Detalle: ${apiMsg}`);
  if (response.status === 404) throw new Error(`El modelo "${model}" no existe o no tienes acceso (404). Cámbialo en los ajustes. Detalle: ${apiMsg}`);
  if (response.status === 413) throw new Error("La solicitud es demasiado grande (413). Elige menos notas o desactiva las imágenes.");
  if (response.status === 429) throw new Error(`Límite de uso alcanzado (429). Espera un minuto y reintenta. Detalle: ${apiMsg}`);
  if (retryable.includes(response.status)) throw new Error(`Los servidores de Claude están sobrecargados (${response.status}), incluso tras reintentar. Prueba de nuevo en unos minutos.`);
  if (response.status !== 200 || data.error) throw new Error(`(${response.status}) ${apiMsg}`);
  if (data.stop_reason === "refusal") throw new Error("Claude rechazó esta solicitud (refusal). Prueba con otras notas o instrucciones.");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw new Error(`Claude no devolvió texto (stop_reason: ${data.stop_reason || "desconocido"}).`);
  return { text, stopReason: data.stop_reason, usage: data.usage || {}, model };
}

// ───────────────────────────── Ventanas ─────────────────────────────
class BrandFileModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Buscar una guía de marca entre las notas Markdown…");
  }
  getItems() { return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path)); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.onChoose(file.path); }
}

// La selección de esta presentación no modifica la guía predeterminada.
function addBrandSelector(containerEl, plugin, { name, value, onChange }) {
  let selectedPath = typeof value === "string" ? value.trim() : "";
  if (selectedPath) selectedPath = normalizePath(selectedPath);
  const setting = new Setting(containerEl).setName(name);
  setting.settingEl.addClass("dh-brand-selection");
  let dropdown;
  const refresh = () => {
    dropdown.selectEl.empty();
    dropdown.addOption("", "Sin guía de marca");
    const files = plugin.getBrandFiles(selectedPath);
    for (const file of files) dropdown.addOption(file.path, file.path);
    if (selectedPath && !files.some((file) => file.path === selectedPath)) {
      dropdown.addOption(selectedPath, `${selectedPath} (no encontrada)`);
    }
    dropdown.setValue(selectedPath);
    setting.setDesc(selectedPath
      ? (plugin.getBrandFile(selectedPath) ? `Guía: ${selectedPath}. Usa «Buscar otra…» para elegir cualquier otra nota Markdown.` : `No se encuentra una nota Markdown en «${selectedPath}». Elige otra guía o «Sin guía de marca».`)
      : "Se usará el estilo general. «Buscar otra…» permite elegir cualquier nota Markdown, sin renombrarla.");
  };
  const choose = (path) => {
    selectedPath = path ? normalizePath(path) : "";
    refresh();
    onChange(selectedPath);
  };
  setting.addDropdown((d) => {
    dropdown = d;
    d.selectEl.addClass("dh-brand-select");
    d.selectEl.setAttribute("aria-label", name);
    d.onChange(choose);
  });
  setting.addButton((b) => b.setButtonText("Buscar otra…").onClick(() => new BrandFileModal(plugin.app, choose).open()));
  refresh();
  return setting;
}

class NotesModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.selected = [];
    this.query = "";
    const s = plugin.settings;
    const brandFile = typeof s.brandFile === "string" ? s.brandFile.trim() : "";
    this.opts = { length: "auto", language: s.language, includeImages: true, brandFile, useBrand: !!brandFile, speakerNotes: s.speakerNotes, instructions: "" };
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("dh-modal");
    this.titleEl.setText("Crear presentación HTML");
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === "md") this.selected.push(active.path);

    contentEl.createEl("p", { cls: "dh-hint", text: "Elige las notas que serán la base de la presentación, en el orden en que aparecerán. Las imágenes incrustadas en las notas se envían a Claude." });
    this.search = contentEl.createEl("input", { cls: "dh-search", attr: { type: "text", placeholder: "Buscar notas…" } });
    this.search.addEventListener("input", () => { this.query = this.search.value.toLowerCase(); this.renderList(); });
    this.listEl = contentEl.createDiv({ cls: "dh-list" });
    this.countEl = contentEl.createDiv({ cls: "dh-count" });
    this.selEl = contentEl.createDiv({ cls: "dh-selected" });

    contentEl.createEl("div", { cls: "dh-label", text: "Instrucciones (opcional)" });
    this.instr = contentEl.createEl("textarea", {
      cls: "dh-instr",
      attr: { rows: "4", placeholder: "Ej.: Presentación de 10 minutos para mi clase; tono sobrio; enfatiza el proceso y cierra con conclusiones." },
    });

    new Setting(contentEl).setName("Longitud").addDropdown((d) =>
      d.addOption("auto", "Automática").addOption("short", "Corta (~6 diapositivas)").addOption("medium", "Media (~10)").addOption("long", "Larga (~16)")
        .setValue(this.opts.length).onChange((v) => { this.opts.length = v; }));
    new Setting(contentEl).setName("Idioma").addDropdown((d) =>
      d.addOption("Spanish", "Español").addOption("English", "English").addOption("Portuguese", "Português")
        .setValue(this.opts.language).onChange((v) => { this.opts.language = v; }));
    new Setting(contentEl).setName("Incluir imágenes de las notas").addToggle((t) => t.setValue(true).onChange((v) => { this.opts.includeImages = v; }));
    addBrandSelector(contentEl, this.plugin, {
      name: "Guía de marca de esta presentación",
      value: this.opts.brandFile,
      onChange: (path) => { this.opts.brandFile = path; this.opts.useBrand = !!path; },
    });
    new Setting(contentEl).setName("Notas del orador").addToggle((t) => t.setValue(this.opts.speakerNotes).onChange((v) => { this.opts.speakerNotes = v; }));

    const btns = contentEl.createDiv({ cls: "modal-button-container" });
    btns.createEl("button", { text: "Cancelar" }).addEventListener("click", () => this.close());
    this.goBtn = btns.createEl("button", { text: "Generar presentación", cls: "mod-cta" });
    this.goBtn.addEventListener("click", () => this.submit());

    this.renderList();
    this.renderSelected();
  }

  setSelected(path, on) {
    const i = this.selected.indexOf(path);
    if (on && i === -1) this.selected.push(path);
    if (!on && i !== -1) this.selected.splice(i, 1);
    this.renderSelected();
  }

  renderList() {
    this.listEl.empty();
    const q = this.query;
    const all = this.app.vault.getMarkdownFiles().filter((f) => !q || f.path.toLowerCase().includes(q)).sort((a, b) => a.path.localeCompare(b.path));
    for (const f of all.slice(0, 200)) {
      const row = this.listEl.createDiv({ cls: "dh-row" });
      const cb = row.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.selected.includes(f.path);
      const label = row.createDiv({ cls: "dh-row-label" });
      label.createSpan({ cls: "dh-name", text: f.basename });
      const dir = f.parent && f.parent.path && f.parent.path !== "/" ? f.parent.path : "";
      if (dir) label.createSpan({ cls: "dh-dir", text: dir });
      row.addEventListener("click", () => { const on = !this.selected.includes(f.path); cb.checked = on; this.setSelected(f.path, on); });
    }
    if (all.length > 200) this.listEl.createDiv({ cls: "dh-dir", text: `Mostrando 200 de ${all.length}. Afina la búsqueda.` });
    if (!all.length) this.listEl.createDiv({ cls: "dh-dir", text: "No hay notas que coincidan." });
  }

  renderSelected() {
    this.countEl.setText(this.selected.length ? `${this.selected.length} nota(s) seleccionada(s), en este orden:` : "Ninguna nota seleccionada.");
    this.selEl.empty();
    this.selected.forEach((path, i) => {
      const f = this.app.vault.getAbstractFileByPath(path);
      const row = this.selEl.createDiv({ cls: "dh-sel-row" });
      row.createSpan({ cls: "dh-sel-n", text: `${i + 1}.` });
      row.createSpan({ cls: "dh-sel-name", text: f ? f.basename : path });
      const up = row.createEl("button", { cls: "dh-mini", text: "↑", attr: { "aria-label": "Subir" } });
      const down = row.createEl("button", { cls: "dh-mini", text: "↓", attr: { "aria-label": "Bajar" } });
      const del = row.createEl("button", { cls: "dh-mini", text: "✕", attr: { "aria-label": "Quitar" } });
      up.addEventListener("click", () => { if (i > 0) { [this.selected[i - 1], this.selected[i]] = [this.selected[i], this.selected[i - 1]]; this.renderSelected(); } });
      down.addEventListener("click", () => { if (i < this.selected.length - 1) { [this.selected[i + 1], this.selected[i]] = [this.selected[i], this.selected[i + 1]]; this.renderSelected(); } });
      del.addEventListener("click", () => { this.selected.splice(i, 1); this.renderSelected(); this.renderList(); });
    });
  }

  submit() {
    if (!this.selected.length) { new Notice("⚠ Selecciona al menos una nota."); return; }
    if (this.opts.useBrand && !this.plugin.getBrandFile(this.opts.brandFile)) {
      new Notice(`No se encontró la guía «${this.opts.brandFile}». Elige otra o «Sin guía de marca».`);
      return;
    }
    this.opts.instructions = this.instr.value.trim();
    this.opts.paths = [...this.selected];
    this.close();
    this.plugin.generate(this.opts);
  }

  onClose() { this.contentEl.empty(); }
}

class ResultModal extends Modal {
  constructor(app, plugin, info) { super(app); this.plugin = plugin; this.info = info; }
  onOpen() {
    const { contentEl } = this;
    const i = this.info;
    this.modalEl.addClass("dh-modal");
    this.titleEl.setText(i.title || "Presentación lista");
    contentEl.createEl("p", { text: `${i.slides} diapositiva(s) · ${i.imagesEmbedded} imagen(es) incrustada(s) · ${formatBytes(i.bytes)}` });
    contentEl.createEl("p", { cls: "dh-path", text: i.fullPath });
    if (i.litePath) contentEl.createEl("p", { cls: "dh-path", text: `${i.litePath} (versión ligera, sin imágenes pesadas)` });
    if (i.warnings && i.warnings.length) {
      const ul = contentEl.createEl("ul", { cls: "dh-warn" });
      i.warnings.forEach((w) => ul.createEl("li", { text: "⚠ " + w }));
    }
    const help = contentEl.createDiv({ cls: "dh-hint" });
    help.createEl("p", { text: "Siguiente paso: ábrela en el navegador para revisarla. Para pulirla en el chat de Claude o ChatGPT, copia la versión ligera (pesa poco porque las imágenes van como marcadores). PDF: en el navegador, Imprimir → Guardar como PDF (activa «Gráficos de fondo»)." });
    const btns = contentEl.createDiv({ cls: "modal-button-container" });
    btns.createEl("button", { text: "Abrir en el navegador", cls: "mod-cta" }).addEventListener("click", () => this.plugin.openExternally(i.fullPath));
    btns.createEl("button", { text: "Mostrar en la carpeta" }).addEventListener("click", () => this.plugin.showInFolder(i.fullPath));
    if (i.liteHtml) {
      btns.createEl("button", { text: "Copiar versión ligera" }).addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(i.liteHtml); new Notice("Versión ligera copiada al portapapeles."); }
        catch (e) { new Notice("No se pudo copiar. Abre el archivo .lite.html y copia su contenido."); }
      });
    }
    btns.createEl("button", { text: "Cerrar" }).addEventListener("click", () => this.close());
  }
  onClose() { this.contentEl.empty(); }
}

class RehydrateModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; this.chosen = null; }
  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("dh-modal");
    this.titleEl.setText("Insertar imágenes en una presentación iterada");
    contentEl.createEl("p", { cls: "dh-hint", text: "Elige el HTML que mejoraste en Claude/ChatGPT (la versión ligera con marcadores de imagen) o pégalo desde el portapapeles. El plugin vuelve a incrustar las imágenes originales y guarda una versión final." });
    this.listEl = contentEl.createDiv({ cls: "dh-list" });
    const files = this.app.vault.getFiles().filter((f) => String(f.extension).toLowerCase() === "html")
      .sort((a, b) => ((b.stat && b.stat.mtime) || 0) - ((a.stat && a.stat.mtime) || 0)).slice(0, 40);
    if (!files.length) this.listEl.createDiv({ cls: "dh-dir", text: "No hay archivos .html en el vault. Pega el HTML desde el portapapeles." });
    for (const f of files) {
      const row = this.listEl.createDiv({ cls: "dh-row" });
      const radio = row.createEl("input", { attr: { type: "radio", name: "dh-file" } });
      const label = row.createDiv({ cls: "dh-row-label" });
      label.createSpan({ cls: "dh-name", text: f.name });
      if (f.parent && f.parent.path && f.parent.path !== "/") label.createSpan({ cls: "dh-dir", text: f.parent.path });
      row.addEventListener("click", () => { this.chosen = f; radio.checked = true; });
    }
    const btns = contentEl.createDiv({ cls: "modal-button-container" });
    btns.createEl("button", { text: "Cancelar" }).addEventListener("click", () => this.close());
    btns.createEl("button", { text: "Usar el portapapeles" }).addEventListener("click", async () => {
      let html = "";
      try { html = await navigator.clipboard.readText(); } catch (e) { /* sin permiso */ }
      if (!/<html|<!doctype/i.test(html)) { new Notice("⚠ El portapapeles no contiene un HTML completo."); return; }
      this.close();
      this.plugin.rehydrate(html, "Presentación");
    });
    btns.createEl("button", { text: "Insertar imágenes", cls: "mod-cta" }).addEventListener("click", async () => {
      if (!this.chosen) { new Notice("⚠ Elige un archivo de la lista."); return; }
      const html = await this.app.vault.read(this.chosen);
      this.close();
      this.plugin.rehydrate(html, this.chosen.basename.replace(/\.lite$/i, ""));
    });
  }
  onClose() { this.contentEl.empty(); }
}

// ───────────────────────────── Plugin ─────────────────────────────
class DeckHtmlPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("presentation", "Crear presentación HTML", () => new NotesModal(this.app, this).open());
    this.addCommand({ id: "create-deck", name: "Crear presentación HTML desde notas", callback: () => new NotesModal(this.app, this).open() });
    this.addCommand({ id: "rehydrate-deck", name: "Insertar imágenes en presentación HTML iterada", callback: () => new RehydrateModal(this.app, this).open() });
    this.addCommand({ id: "create-brand-template", name: "Crear plantilla de guía de marca", callback: () => this.createBrandTemplate() });
    this.addSettingTab(new DeckSettingTab(this.app, this));
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // copia propia: no compartir el objeto "decks" de DEFAULT_SETTINGS entre instancias
    this.settings.decks = Object.assign({}, saved.decks && typeof saved.decks === "object" ? saved.decks : {});
  }
  async saveSettings() { await this.saveData(this.settings); }

  getBrandFile(path = this.settings.brandFile) {
    const p = typeof path === "string" ? path.trim() : "";
    if (!p) return null;
    const f = this.app.vault.getAbstractFileByPath(normalizePath(p));
    return f instanceof TFile && f.extension.toLowerCase() === "md" ? f : null;
  }

  getBrandFiles(selectedPath = "") {
    const preferred = new Set([selectedPath, this.settings.brandFile].filter((path) => typeof path === "string" && path.trim()).map((path) => normalizePath(path.trim())));
    return this.app.vault.getMarkdownFiles().filter((file) => {
      if (preferred.has(file.path)) return true;
      // Los respaldos siguen disponibles con «Buscar otra…», sin llenar la lista principal.
      if (/(^|\/)(historial de marca|backups?|respaldos?)(\/|$)/i.test(file.path)) return false;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return frontmatter?.tipo === "guia-de-marca"
        || /^Brand\//i.test(file.path)
        || /gu[ií]a[-_ ]de[-_ ]marca/i.test(file.basename);
    }).sort((a, b) => a.path.localeCompare(b.path));
  }

  async ensureFolder(path) {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch (e) { /* ya existe */ }
      }
    }
  }

  async uniquePath(folder, base, ext) {
    let path = normalizePath(folder ? `${folder}/${base}.${ext}` : `${base}.${ext}`);
    if (!this.app.vault.getAbstractFileByPath(path)) return path;
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    path = normalizePath(folder ? `${folder}/${base}-${stamp}.${ext}` : `${base}-${stamp}.${ext}`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(folder ? `${folder}/${base}-${stamp}-${n}.${ext}` : `${base}-${stamp}-${n}.${ext}`);
      n++;
    }
    return path;
  }

  openExternally(path) {
    try { this.app.openWithDefaultApp(path); } catch (e) { new Notice("No se pudo abrir automáticamente. Ábrelo desde la carpeta del vault."); }
  }
  showInFolder(path) {
    try { this.app.showInFolder(path); } catch (e) { new Notice("No se pudo mostrar la carpeta en este dispositivo."); }
  }

  async createBrandTemplate() {
    const path = normalizePath(this.settings.brandFile || DEFAULT_SETTINGS.brandFile);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (dir) await this.ensureFolder(dir);
      file = await this.app.vault.create(path, BRAND_TEMPLATE);
      new Notice(`Plantilla creada en ${path}. Rellénala y sube el mismo archivo a tu proyecto de Claude/ChatGPT.`);
    } else {
      new Notice("Ya existe una guía de marca en esa ruta; se abre para que la edites.");
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // ── Generación ──
  async generate(opts) {
    const s = this.settings;
    // Compatibilidad con llamadas anteriores; una ruta vacía explícita nunca toma el predeterminado.
    const brandPath = opts.useBrand
      ? (typeof opts.brandFile === "string" ? opts.brandFile.trim() : (s.brandFile || "").trim())
      : "";
    if (!s.apiKey) { new Notice("⚠ Configura tu API key de Claude en los ajustes de Deck HTML."); return; }
    const progress = new Notice("Deck HTML: leyendo notas…", 0);
    const warnings = [];
    try {
      const registry = new ImageRegistry(opts.includeImages ? s.maxImages : 0);

      // 1) Guía de marca (primero, para que sus recursos reciban los primeros IDs)
      let brandText = "";
      if (brandPath) {
        const bf = this.getBrandFile(brandPath);
        if (bf) {
          const raw = await this.app.vault.cachedRead(bf);
          const r = processNoteImages(this.app, raw, bf.path, "guía de marca", registry, opts.includeImages, true);
          brandText = cleanMarkdown(r.text).slice(0, BRAND_MAX_CHARS);
        } else {
          throw new Error(`No se encontró la guía de marca «${brandPath}». Vuelve a crear la presentación y elige otra guía o «Sin guía de marca».`);
        }
      }

      // 2) Notas
      const notes = [];
      for (const path of opts.paths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) { warnings.push(`No se encontró la nota ${path}.`); continue; }
        const raw = await this.app.vault.cachedRead(file);
        const r = processNoteImages(this.app, raw, file.path, file.basename, registry, opts.includeImages, false);
        r.skipped.forEach((n) => warnings.push(`Imagen omitida por el límite de ${s.maxImages}: ${n}`));
        notes.push({ title: file.basename, path: file.path, text: cleanMarkdown(r.text) });
      }
      if (!notes.length) throw new Error("No se pudo leer ninguna de las notas seleccionadas.");
      const total = notes.reduce((a, n) => a + n.text.length, 0);
      if (total > MAX_TOTAL_CHARS) {
        const ratio = MAX_TOTAL_CHARS / total;
        notes.forEach((n) => { n.text = n.text.slice(0, Math.floor(n.text.length * ratio)) + "\n[…texto truncado por longitud]"; });
        warnings.push("Las notas eran muy largas y se recortaron para caber en la solicitud.");
      }

      // 3) Imágenes
      let k = 0;
      for (const e of registry.list) {
        k++;
        progress.setMessage(`Deck HTML: preparando imagen ${k} de ${registry.list.length}…`);
        e.data = await prepareImage(this.app, e.file, s.maxImagePx);
        if (!e.data) { e.failed = true; warnings.push(`No se pudo procesar la imagen ${e.file.name}.`); }
      }

      // 4) Llamada a Claude
      progress.setMessage("Deck HTML: Claude está diseñando la presentación… (puede tardar 1–3 minutos)");
      const content = buildContent({ brandText, opts, notes, registry });
      const res = await callClaude(s, content, (status, n) => progress.setMessage(`Deck HTML: Claude respondió ${status}; reintentando (${n}/2)…`));
      let template = extractHtml(res.text);
      if (!/<html[\s>]/i.test(template) || countSlides(template) === 0) {
        throw new Error("La respuesta de Claude no contiene una presentación HTML válida. Prueba de nuevo o simplifica las instrucciones.");
      }
      if (res.stopReason === "max_tokens" || !/<\/html>\s*$/i.test(template)) {
        warnings.push("La respuesta se cortó por el límite de longitud: la presentación puede estar incompleta. Sube «Máx. tokens de salida» en los ajustes o pide menos diapositivas.");
      }

      // 5) Post-proceso y guardado
      const deckId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      template = injectMeta(template, deckId);
      const byId = {};
      registry.list.forEach((e) => { byId[e.id] = e; });
      let unresolved = 0;
      const used = new Set();
      const full = replaceImageTokens(template, (id) => {
        const e = byId[id];
        if (e && e.data) { used.add(id); return `data:${e.data.mediaType};base64,${e.data.base64}`; }
        unresolved++;
        return placeholderUri(id, "no disponible");
      });
      if (unresolved) warnings.push(`${unresolved} referencia(s) a imágenes que no existen; se dejó un marcador.`);
      const lite = replaceImageTokens(template, (id) => placeholderUri(id, byId[id] ? byId[id].file.name : "no disponible", byId[id] && byId[id].data && byId[id].data.width, byId[id] && byId[id].data && byId[id].data.height));

      const folder = normalizePath(s.outputFolder || "Presentaciones");
      await this.ensureFolder(folder);
      const title = getTitle(template) || notes[0].title;
      const base = slugify(title);
      const fullPath = await this.uniquePath(folder, base, "html");
      await this.app.vault.create(fullPath, full);
      let litePath = "";
      if (s.saveLite) {
        litePath = fullPath.replace(/\.html$/i, ".lite.html");
        if (this.app.vault.getAbstractFileByPath(litePath)) litePath = await this.uniquePath(folder, base + ".lite", "html");
        await this.app.vault.create(litePath, lite);
      }
      const bytes = new Blob([full]).size;
      if (bytes > 8 * 1048576) warnings.push(`El archivo pesa ${formatBytes(bytes)} por las imágenes. Para compartirlo, considera reducir «Tamaño máx. de imagen» en los ajustes.`);

      // 6) Memoria del mazo (para reinsertar imágenes tras iterar)
      const images = {};
      registry.list.forEach((e) => { if (!e.failed) images[e.id] = { path: e.file.path, name: e.file.name }; });
      s.decks[deckId] = { title, created: Date.now(), images, brandFile: brandPath ? normalizePath(brandPath) : "" };
      const ids = Object.keys(s.decks).sort((a, b) => s.decks[b].created - s.decks[a].created);
      ids.slice(MAX_DECKS_KEPT).forEach((id) => delete s.decks[id]);
      await this.saveSettings();

      progress.hide();
      new ResultModal(this.app, this, { title, fullPath, litePath, liteHtml: s.saveLite ? lite : "", slides: countSlides(template), imagesEmbedded: used.size, bytes, warnings }).open();
    } catch (e) {
      progress.hide();
      console.error("[Deck HTML]", e);
      new Notice(`Deck HTML: ${e.message || e}`, 15000);
    }
  }

  // ── Reinsertar imágenes en un HTML iterado ──
  async rehydrate(html, baseName) {
    const progress = new Notice("Deck HTML: insertando imágenes…", 0);
    const warnings = [];
    try {
      const m = html.match(/<meta[^>]+name=["']deck-id["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']deck-id["']/i);
      let deck = m && this.settings.decks[m[1]];
      if (!deck) {
        const latest = Object.keys(this.settings.decks).sort((a, b) => this.settings.decks[b].created - this.settings.decks[a].created)[0];
        if (!latest) throw new Error("No hay registro de ninguna presentación generada con este plugin, así que no sé de dónde salen las imágenes.");
        deck = this.settings.decks[latest];
        warnings.push(`El HTML no trae el identificador del mazo; se usaron las imágenes de la última presentación («${deck.title}»).`);
      }
      const ids = new Set();
      (html.match(PH_RE) || []).forEach((u) => { const t = u.match(/IMG_\d+/); if (t) ids.add(t[0]); });
      if (!ids.size) warnings.push("No se encontraron marcadores de imagen en el HTML.");
      const uris = {};
      let k = 0;
      for (const id of ids) {
        k++;
        progress.setMessage(`Deck HTML: preparando imagen ${k} de ${ids.size}…`);
        const info = deck.images[id];
        const file = info && this.app.vault.getAbstractFileByPath(info.path);
        if (!(file instanceof TFile)) { warnings.push(`No se encontró el archivo de ${id}${info ? ` (${info.path})` : ""}.`); continue; }
        const data = await prepareImage(this.app, file, this.settings.maxImagePx);
        if (!data) { warnings.push(`No se pudo procesar ${file.name}.`); continue; }
        uris[id] = `data:${data.mediaType};base64,${data.base64}`;
      }
      const out = html.replace(PH_RE, (u) => { const t = u.match(/IMG_\d+/); return (t && uris[t[0]]) || u; });
      const folder = normalizePath(this.settings.outputFolder || "Presentaciones");
      await this.ensureFolder(folder);
      const title = getTitle(out) || baseName;
      const fullPath = await this.uniquePath(folder, slugify(title) + " (con imágenes)", "html");
      await this.app.vault.create(fullPath, out);
      const bytes = new Blob([out]).size;
      progress.hide();
      new ResultModal(this.app, this, { title: `Versión final: ${title}`, fullPath, litePath: "", liteHtml: "", slides: countSlides(out), imagesEmbedded: Object.keys(uris).length, bytes, warnings }).open();
    } catch (e) {
      progress.hide();
      console.error("[Deck HTML]", e);
      new Notice(`Deck HTML: ${e.message || e}`, 15000);
    }
  }
}

class DeckSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Deck HTML — Configuración" });

    new Setting(containerEl).setName("API key de Claude (Anthropic)")
      .setDesc("Créala en platform.claude.com → API keys. Empieza con sk-ant-. La API se cobra aparte de tu suscripción de Claude.")
      .addText((t) => { t.inputEl.type = "password"; return t.setPlaceholder("sk-ant-...").setValue(s.apiKey).onChange(async (v) => { s.apiKey = v.trim(); await this.plugin.saveSettings(); }); });
    new Setting(containerEl).setName("Modelo")
      .setDesc("Recomendado: claude-haiku-5-5 (rápido y económico). Para mejor diseño: claude-sonnet-5-5 (más caro).")
      .addText((t) => t.setPlaceholder("claude-haiku-5-5").setValue(s.model).onChange(async (v) => { s.model = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Máx. tokens de salida")
      .setDesc("Tope de longitud de la respuesta. 32000 alcanza para mazos largos.")
      .addText((t) => t.setPlaceholder("32000").setValue(String(s.maxTokens)).onChange(async (v) => { const n = parseInt(v, 10); if (n > 1000) { s.maxTokens = n; await this.plugin.saveSettings(); } }));

    addBrandSelector(containerEl, this.plugin, {
      name: "Guía de marca predeterminada",
      value: s.brandFile,
      onChange: async (path) => { s.brandFile = path; await this.plugin.saveSettings(); },
    });
    new Setting(containerEl).setName("Plantilla de guía de marca")
      .setDesc("Abre la guía predeterminada para editarla. Sin una seleccionada, usa Brand/guia-de-marca.md; si no existe, crea la plantilla.")
      .addButton((b) => b.setButtonText("Abrir o crear plantilla").onClick(() => this.plugin.createBrandTemplate()));
    new Setting(containerEl).setName("Carpeta de salida").setDesc("Donde se guardan los .html. Se crea si no existe.")
      .addText((t) => t.setPlaceholder("Presentaciones").setValue(s.outputFolder).onChange(async (v) => { s.outputFolder = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Idioma por defecto")
      .addDropdown((d) => d.addOption("Spanish", "Español").addOption("English", "English").addOption("Portuguese", "Português").setValue(s.language).onChange(async (v) => { s.language = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Máx. imágenes por presentación").setDesc("Límite de imágenes enviadas a Claude (cada una cuesta unos cientos de tokens).")
      .addText((t) => t.setPlaceholder("24").setValue(String(s.maxImages)).onChange(async (v) => { const n = parseInt(v, 10); if (n >= 0) { s.maxImages = n; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Tamaño máx. de imagen (px)").setDesc("Las imágenes más grandes se reducen a este lado mayor, para el envío y para el HTML final.")
      .addText((t) => t.setPlaceholder("1600").setValue(String(s.maxImagePx)).onChange(async (v) => { const n = parseInt(v, 10); if (n >= 200) { s.maxImagePx = n; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Incluir notas del orador por defecto").addToggle((t) => t.setValue(s.speakerNotes).onChange(async (v) => { s.speakerNotes = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Guardar también la versión ligera (.lite.html)")
      .setDesc("Sin imágenes pesadas: sirve para iterar en el chat de Claude/ChatGPT. Luego «Insertar imágenes en presentación HTML iterada» las devuelve.")
      .addToggle((t) => t.setValue(s.saveLite).onChange(async (v) => { s.saveLite = v; await this.plugin.saveSettings(); }));

    containerEl.createEl("hr");
    const info = containerEl.createDiv({ cls: "setting-item-description" });
    info.createEl("p", { text: "💡 Flujo: botón de la barra lateral (o Ctrl/Cmd+P → «Crear presentación HTML desde notas») → elige notas e instrucciones → se guardan el .html completo y el .lite.html." });
    info.createEl("p", { text: "Para PDF: abre el .html en el navegador → Imprimir → Guardar como PDF (activa «Gráficos de fondo»). Para PowerPoint, pídele a Claude que reconstruya el mazo con su skill de pptx." });
  }
}

module.exports = DeckHtmlPlugin;
