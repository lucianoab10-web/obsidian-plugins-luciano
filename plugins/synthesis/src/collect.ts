import { App, MarkdownView, TFile, normalizePath } from 'obsidian';
import type Anthropic from '@anthropic-ai/sdk';
import { prepareImage, type PreparedImage } from './images';

export type ContentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;

export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);

/* ───────────────────────── Análisis del Markdown (funciones puras) ───────────────────────── */

export type Segment =
	| { kind: 'text'; text: string }
	| { kind: 'embed'; target: string; alt: string } // ![[archivo|alt|400]]
	| { kind: 'mdimage'; url: string; alt: string }; // ![alt](ruta)

// 1.º: ![[...]]   2.º: ![alt](url "título")
const EMBED_RE =
	/!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;
const FENCE_RE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;

export function stripFrontmatter(md: string): string {
	return md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
}

/** Separa los bloques de código (que no se tocan) del resto del texto. */
export function splitByFences(md: string): { code: boolean; text: string }[] {
	const out: { code: boolean; text: string }[] = [];
	let last = 0;
	for (const m of md.matchAll(FENCE_RE)) {
		const idx = m.index ?? 0;
		if (idx > last) out.push({ code: false, text: md.slice(last, idx) });
		out.push({ code: true, text: m[0] });
		last = idx + m[0].length;
	}
	if (last < md.length) out.push({ code: false, text: md.slice(last) });
	return out;
}

export function tokenizeText(text: string): Segment[] {
	const segs: Segment[] = [];
	let last = 0;
	for (const m of text.matchAll(EMBED_RE)) {
		const idx = m.index ?? 0;
		if (idx > last) segs.push({ kind: 'text', text: text.slice(last, idx) });
		if (m[1] !== undefined) {
			const [rawTarget, ...rest] = m[1].split('|');
			const target = (rawTarget ?? '').split('#')[0].split('^')[0].trim();
			// En ![[img.png|300]] o ![[img.png|texto|300]] el número es el ancho, no un texto alternativo.
			const alt = rest.filter((p) => !/^\s*\d+(x\d+)?\s*$/i.test(p)).join(' ').trim();
			segs.push({ kind: 'embed', target, alt });
		} else {
			let url = m[3] ?? '';
			if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1);
			segs.push({ kind: 'mdimage', url, alt: (m[2] ?? '').trim() });
		}
		last = idx + m[0].length;
	}
	if (last < text.length) segs.push({ kind: 'text', text: text.slice(last) });
	return segs;
}

/** Quita comentarios %%…%% y deja los [[wikilinks]] como texto legible. */
export function cleanText(text: string): string {
	return text
		.replace(/%%[\s\S]*?%%/g, '')
		.replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g, (_m: string, target: string, alias?: string) => {
			const a = alias?.trim();
			if (a) return a;
			return target
				.replace(/#\^[^#]*$/, '')
				.split('#')
				.map((s) => s.trim())
				.filter(Boolean)
				.join(' › ');
		})
		.replace(/\n{3,}/g, '\n\n');
}

function extOf(link: string): string {
	const clean = link.split('#')[0].split('?')[0];
	const i = clean.lastIndexOf('.');
	return i < 0 ? '' : clean.slice(i + 1).toLowerCase();
}

function baseOf(link: string): string {
	const clean = link.split('#')[0].split('?')[0];
	return clean.slice(clean.lastIndexOf('/') + 1);
}

function isRemote(link: string): boolean {
	return /^(https?:|data:|file:)/i.test(link);
}

function attr(s: string): string {
	return s.replace(/["<>]/g, "'");
}

/* ───────────────────────── Acceso al vault ───────────────────────── */

function resolveRelative(dir: string, rel: string): string {
	const parts = dir ? dir.split('/') : [];
	for (const seg of rel.split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') parts.pop();
		else parts.push(seg);
	}
	return parts.join('/');
}

/** Resuelve [[wikilinks]] y rutas Markdown (relativas o absolutas dentro del vault). */
export function findFile(app: App, link: string, sourcePath: string): TFile | null {
	const clean = link.trim();
	if (!clean) return null;
	const variants = [clean];
	try {
		const decoded = decodeURIComponent(clean);
		if (decoded !== clean) variants.push(decoded);
	} catch {
		/* %-secuencia inválida: se usa tal cual */
	}
	for (const v of variants) {
		const f = app.metadataCache.getFirstLinkpathDest(v, sourcePath);
		if (f) return f;
	}
	const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
	for (const v of variants) {
		for (const cand of [resolveRelative(dir, v), normalizePath(v)]) {
			const a = app.vault.getAbstractFileByPath(cand);
			if (a instanceof TFile) return a;
		}
	}
	return null;
}

/** Lee la nota; si está abierta en el editor usa el contenido actual (aunque no se haya guardado). */
async function readNote(app: App, file: TFile): Promise<string> {
	try {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.file?.path === file.path) return view.getViewData();
	} catch {
		/* se lee desde el disco */
	}
	return app.vault.read(file);
}

/* ───────────────────────── Estimación para el modal ───────────────────────── */

export async function estimateNotes(
	app: App,
	files: TFile[],
): Promise<{ chars: number; textTokens: number; images: number }> {
	let chars = 0;
	let images = 0;
	for (const f of files) {
		let raw: string;
		try {
			raw = await readNote(app, f);
		} catch {
			continue;
		}
		for (const part of splitByFences(stripFrontmatter(raw))) {
			if (part.code) {
				chars += part.text.length;
				continue;
			}
			for (const seg of tokenizeText(part.text)) {
				if (seg.kind === 'text') {
					chars += cleanText(seg.text).length;
				} else {
					const link = seg.kind === 'embed' ? seg.target : seg.url;
					if (IMAGE_EXT.has(extOf(link)) && !isRemote(link)) images++;
				}
			}
		}
	}
	return { chars, images, textTokens: Math.ceil(chars / 3.5) };
}

/* ───────────────────────── Recolección para la petición ───────────────────────── */

export interface CollectOptions {
	includeImages: boolean;
	maxImages: number;
	maxImageSide: number;
	/** Tope de caracteres base64 acumulados (la API admite 32 MB por petición). */
	maxTotalImageChars?: number;
}

export interface CollectedImage {
	n: number;
	name: string;
	notePath: string;
	alt: string;
	prepared: PreparedImage;
}

export interface CollectResult {
	content: ContentBlock[];
	images: CollectedImage[];
	warnings: string[];
	noteTitles: string[];
	chars: number;
}

export interface CollectDeps {
	/** Inyectable para pruebas (en Node no hay canvas). */
	prepareImage?: (data: ArrayBuffer, ext: string, maxSide: number) => Promise<PreparedImage>;
}

export async function collectNotes(
	app: App,
	files: TFile[],
	opts: CollectOptions,
	onProgress?: (message: string) => void,
	deps: CollectDeps = {},
): Promise<CollectResult> {
	const prep = deps.prepareImage ?? prepareImage;
	const budget = opts.maxTotalImageChars ?? 24_000_000;
	const content: ContentBlock[] = [];
	const images: CollectedImage[] = [];
	const warnings: string[] = [];
	const noteTitles: string[] = [];
	let chars = 0;
	let imageChars = 0;
	let countLimitWarned = false;
	let budgetWarned = false;

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		noteTitles.push(file.basename);
		onProgress?.(`Leyendo «${file.basename}» (${i + 1}/${files.length})…`);
		const raw = await readNote(app, file);

		let buf = `<nota n="${i + 1}" titulo="${attr(file.basename)}">\n`;
		const flush = () => {
			if (buf.trim()) content.push({ type: 'text', text: buf });
			buf = '';
		};

		for (const part of splitByFences(stripFrontmatter(raw))) {
			if (part.code) {
				buf += part.text;
				chars += part.text.length;
				continue;
			}
			for (const seg of tokenizeText(part.text)) {
				if (seg.kind === 'text') {
					const t = cleanText(seg.text);
					buf += t;
					chars += t.length;
					continue;
				}

				const link = seg.kind === 'embed' ? seg.target : seg.url;
				const alt = seg.alt;
				const name = baseOf(link);

				if (seg.kind === 'mdimage' && isRemote(link)) {
					buf += `[Imagen remota no incluida${alt ? `: ${alt}` : ''}]`;
					continue;
				}
				if (!IMAGE_EXT.has(extOf(link))) {
					// ![[otra nota]], ![[documento.pdf]], audio…
					const target = findFile(app, link, file.path);
					buf += target
						? `[Contenido incrustado «${target.basename}»: no se incluye aquí]`
						: `[Contenido incrustado no encontrado: «${name}»]`;
					continue;
				}
				if (!opts.includeImages) {
					buf += `[Imagen omitida: ${name}]`;
					continue;
				}
				if (images.length >= opts.maxImages) {
					if (!countLimitWarned) {
						warnings.push(`Se alcanzó el máximo de ${opts.maxImages} imágenes; las siguientes no se enviaron.`);
						countLimitWarned = true;
					}
					buf += `[Imagen no incluida: ${name}]`;
					continue;
				}
				const found = findFile(app, link, file.path);
				if (!found) {
					warnings.push(`No se encontró la imagen «${name}» (nota «${file.basename}»).`);
					buf += `[Imagen no encontrada: ${name}]`;
					continue;
				}
				try {
					onProgress?.(`Preparando imagen ${images.length + 1}: ${found.name}`);
					const data = await app.vault.readBinary(found);
					const prepared = await prep(data, found.extension.toLowerCase(), opts.maxImageSide);
					if (imageChars + prepared.base64.length > budget) {
						if (!budgetWarned) {
							warnings.push(
								`Las imágenes desde «${found.name}» en adelante no se enviaron para no superar el tamaño máximo de la petición.`,
							);
							budgetWarned = true;
						}
						buf += `[Imagen no incluida: ${found.name}]`;
						continue;
					}
					const n = images.length + 1;
					images.push({ n, name: found.name, notePath: file.path, alt, prepared });
					imageChars += prepared.base64.length;
					buf += `\n[Imagen ${n}: «${found.name}»${alt ? `; texto alternativo: «${alt}»` : ''}]\n`;
					flush();
					content.push({
						type: 'image',
						source: { type: 'base64', media_type: prepared.mediaType, data: prepared.base64 },
					});
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					warnings.push(`No se pudo procesar la imagen «${found.name}»: ${msg}.`);
					buf += `[Imagen no legible: ${found.name}]`;
				}
			}
		}
		buf += '\n</nota>\n';
		flush();
	}

	return { content, images, warnings, noteTitles, chars };
}
