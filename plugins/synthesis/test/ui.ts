/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { JSDOM } from 'jsdom';
import { Notice, TFile } from 'obsidian';

/* ───────────── Entorno DOM + ayudantes que Obsidian añade a los elementos ───────────── */

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const w: any = dom.window;
Object.assign(globalThis, { window: w, document: w.document, HTMLElement: w.HTMLElement, Node: w.Node });

function applyInfo(el: any, o?: any): void {
	if (!o) return;
	if (o.cls) for (const c of Array.isArray(o.cls) ? o.cls : String(o.cls).split(' ')) if (c) el.classList.add(c);
	if (o.text !== undefined) el.textContent = String(o.text);
	if (o.type) el.type = o.type;
	if (o.placeholder) el.placeholder = o.placeholder;
	if (o.value !== undefined) el.value = o.value;
	if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
}
const np = w.Node.prototype;
np.createEl = function (tag: string, o?: any) {
	const el = w.document.createElement(tag);
	applyInfo(el, o);
	this.appendChild(el);
	return el;
};
np.createDiv = function (o?: any) {
	return this.createEl('div', o);
};
np.createSpan = function (o?: any) {
	return this.createEl('span', o);
};
const hp = w.HTMLElement.prototype;
hp.empty = function () {
	while (this.firstChild) this.removeChild(this.firstChild);
};
hp.addClass = function (...c: string[]) {
	this.classList.add(...c);
};
hp.removeClass = function (...c: string[]) {
	this.classList.remove(...c);
};
hp.setText = function (t: string) {
	this.textContent = t;
};
hp.hide = function () {
	this.style.display = 'none';
};
hp.show = function () {
	this.style.display = '';
};

/* ───────────── Utilidades ───────────── */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 10000): Promise<void> {
	const t0 = Date.now();
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('tiempo de espera agotado');
		await sleep(25);
	}
}
const fire = (el: any, type: string) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const button = (root: HTMLElement, text: string): HTMLButtonElement => {
	const b = [...root.querySelectorAll('button')].find((x) => x.textContent === text);
	if (!b) throw new Error(`no hay un botón «${text}» (hay: ${[...root.querySelectorAll('button')].map((x) => x.textContent).join(', ')})`);
	return b as HTMLButtonElement;
};

const results: boolean[] = [];
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
	try {
		await fn();
		results.push(true);
		console.log(`  ✓ ${name}`);
	} catch (e) {
		results.push(false);
		console.log(`  ✗ ${name}\n      ${String((e as Error).message).split('\n').join('\n      ')}`);
	}
}

/* ───────────── App simulada ───────────── */

function mkFile(path: string, mtime: number): any {
	const f: any = new TFile();
	f.path = path;
	f.name = path.split('/').pop();
	f.extension = f.name.split('.').pop();
	f.basename = f.name.replace(/\.[^.]+$/, '');
	f.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
	f.stat.mtime = mtime;
	return f;
}

function makeApp() {
	const files = new Map<string, { file: any; data: any }>();
	const created: { path: string; data: any }[] = [];
	const opened: any[] = [];
	const add = (path: string, data: any, mtime = 0) => {
		const file = mkFile(path, mtime);
		files.set(path, { file, data });
		return file;
	};
	const noteA = add('Equilibrio químico.md', '# Equilibrio\n\nContenido de la nota A con **términos**.', 3);
	add('Cinética química.md', '# Cinética\n\nContenido de la nota B.', 2);
	add('Geología/Rocas metamórficas.md', '# Rocas\n\nContenido de la nota C.', 1);
	const app: any = {
		vault: {
			getMarkdownFiles: () => [...files.values()].map((x) => x.file).filter((f: any) => f.extension === 'md'),
			getAbstractFileByPath: (p: string) => files.get(p)?.file ?? null,
			read: async (f: any) => files.get(f.path)?.data,
			readBinary: async (f: any) => files.get(f.path)?.data,
			createFolder: async () => {},
			createBinary: async (p: string, d: ArrayBuffer) => {
				created.push({ path: p, data: d });
				return add(p, d, 9);
			},
			create: async (p: string, d: string) => {
				created.push({ path: p, data: d });
				return add(p, d, 9);
			},
		},
		workspace: {
			getActiveFile: () => noteA,
			getActiveViewOfType: () => null,
			getLeaf: () => ({
				openFile: async (f: any) => {
					opened.push(f);
				},
			}),
		},
		metadataCache: { getFirstLinkpathDest: () => null },
		secretStorage: { getSecret: (id: string) => (id === 'mi-clave' ? 'sk-ant-test' : null) },
		setting: {
			opened: false,
			tab: '',
			open() {
				this.opened = true;
			},
			openTabById(id: string) {
				this.tab = id;
			},
		},
	};
	return { app, created, opened };
}

/* ───────────── API simulada ───────────── */

type Mode = 'ok' | 'slow' | '401' | 'hang';
let mode: Mode = 'ok';
const SUMMARY = '# Resumen de prueba\n\n> **Idea clave:** algo importante.\n\n## Conceptos\n\n- **A:** definición.\n- **B:** otra definición.\n';
const ev = (res: http.ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
	const server = http.createServer((req, res) => {
		req.on('data', () => {});
		req.on('end', () => {
			if (mode === '401') {
				res.writeHead(401, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
				return;
			}
			const start = () => {
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				ev(res, 'message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4321, output_tokens: 1 } } });
				ev(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
				if (mode === 'hang') {
					ev(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '# Parcial' } });
					return; // la conexión queda abierta
				}
				ev(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: SUMMARY } });
				ev(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
				ev(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 987 } });
				ev(res, 'message_stop', { type: 'message_stop' });
				res.end();
			};
			if (mode === 'slow') setTimeout(start, 500);
			else start();
		});
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () =>
			resolve({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
				close: async () => {
					server.closeAllConnections();
					await new Promise<void>((r) => server.close(() => r()));
				},
			}),
		),
	);
}

/* ───────────── Pruebas ───────────── */

async function main() {
	const srv = await startServer();
	process.env.ANTHROPIC_BASE_URL = srv.url;
	// Con SYNTH_PROD_BUNDLE se prueba el main.js de producción (compilado para navegador) en lugar del código fuente.
	const prod = process.env.SYNTH_PROD_BUNDLE;
	const SynthesisPlugin: any = prod ? require(prod).default : (await import('../src/main')).default;
	const { app, created, opened } = makeApp();
	const plugin: any = new SynthesisPlugin(app, { id: 'synthesis' } as any);

	console.log('\nPlugin y ajustes');
	await test('onload registra el botón lateral, el comando y la pestaña de ajustes', async () => {
		await plugin.onload();
		assert.equal(plugin.ribbon[0].icon, 'graduation-cap');
		assert.match(plugin.ribbon[0].title, /Synthesis/);
		assert.equal(plugin.commands.length, 1);
		assert.equal(plugin.tabs.length, 1);
		assert.equal(plugin.getApiKey(), '', 'sin secreto configurado no hay clave');
		plugin.settings.apiKeySecret = 'mi-clave';
		assert.equal(plugin.getApiKey(), 'sk-ant-test', 'la clave se lee del llavero simulado');
	});
	await test('la pestaña de ajustes se dibuja completa y el selector de modelo personalizado funciona', async () => {
		const tab = plugin.tabs[0];
		tab.display();
		const root: HTMLElement = tab.containerEl;
		assert.ok(root.querySelectorAll('.setting-item').length >= 14, 'faltan ajustes');
		for (const t of ['Conexión con Claude', 'Clave de API de Claude', 'Probar conexión', 'Esfuerzo de razonamiento', 'Carpeta de los PDF', 'Instrucciones adicionales']) {
			assert.ok(root.textContent?.includes(t), `falta «${t}»`);
		}
		assert.ok(root.querySelector('[data-secret]'), 'falta el campo de clave (SecretComponent)');

		const sel = root.querySelector('select') as HTMLSelectElement; // el primero es el modelo
		sel.value = '__custom__';
		fire(sel, 'change');
		assert.ok(tab.containerEl.textContent.includes('ID del modelo'), 'debe aparecer el campo de ID personalizado');
		const idRow = [...tab.containerEl.querySelectorAll('.setting-item')].find((r: any) => r.textContent.includes('ID del modelo')) as HTMLElement;
		const idInput = idRow.querySelector('input') as HTMLInputElement;
		idInput.value = 'claude-sonnet-6';
		fire(idInput, 'input');
		assert.equal(plugin.settings.model, 'claude-sonnet-6');

		const sel2 = tab.containerEl.querySelector('select') as HTMLSelectElement;
		sel2.value = 'claude-sonnet-5-5';
		fire(sel2, 'change');
		await sleep(20); // el manejador guarda los ajustes (async) antes de redibujar
		assert.equal(plugin.settings.model, 'claude-sonnet-5-5');
		assert.ok(!tab.containerEl.textContent.includes('ID del modelo'), 'el campo personalizado debe ocultarse');
	});

	console.log('\nModal: selección de notas');
	await test('la nota abierta queda preseleccionada y se listan las notas del vault', async () => {
		plugin.openModal();
		const el: HTMLElement = plugin.modal.contentEl;
		const chips = el.querySelectorAll('.synthesis-chip');
		assert.equal(chips.length, 1);
		assert.equal(el.querySelector('.synthesis-chip-name')?.textContent, 'Equilibrio químico');
		assert.equal(el.querySelectorAll('.synthesis-row').length, 3);
		await waitFor(() => /1 nota/.test(el.querySelector('.synthesis-stats')?.textContent ?? ''));
		assert.match(el.querySelector('.synthesis-stats')?.textContent ?? '', /tokens de entrada/);
	});
	await test('buscar, sumar otra nota, limpiar y volver a seleccionar', async () => {
		const el: HTMLElement = plugin.modal.contentEl;
		const search = el.querySelector('.synthesis-search') as HTMLInputElement;
		search.value = 'roca';
		fire(search, 'input');
		const rows = el.querySelectorAll('.synthesis-row');
		assert.equal(rows.length, 1);
		(rows[0] as HTMLElement).click();
		assert.equal(el.querySelectorAll('.synthesis-chip').length, 2, 'ahora hay 2 notas');
		await waitFor(() => /2 notas/.test(el.querySelector('.synthesis-stats')?.textContent ?? ''));

		button(el, 'Limpiar selección').click();
		assert.equal(el.querySelectorAll('.synthesis-chip').length, 0);
		assert.equal(button(el, 'Generar PDF').disabled, true, 'sin notas no se puede generar');
		await waitFor(() => /al menos una nota/.test(el.querySelector('.synthesis-stats')?.textContent ?? ''));

		search.value = '';
		fire(search, 'input');
		(el.querySelectorAll('.synthesis-row')[0] as HTMLElement).click(); // la más reciente: «Equilibrio químico»
		assert.equal(el.querySelectorAll('.synthesis-chip').length, 1);
		assert.equal(button(el, 'Generar PDF').disabled, false);
	});
	await test('sin clave de API: avisa, cierra el modal y abre los ajustes del plugin', () => {
		plugin.settings.apiKeySecret = '';
		const el: HTMLElement = plugin.modal.contentEl;
		button(el, 'Generar PDF').click();
		assert.ok(Notice.log.some((m) => m.includes('falta la clave de API')));
		assert.equal(app.setting.opened, true);
		assert.equal(app.setting.tab, 'synthesis');
		assert.equal(plugin.modal, null, 'el modal debe cerrarse');
		plugin.settings.apiKeySecret = 'mi-clave';
	});

	console.log('\nModal: ejecución');
	await test('flujo completo con el modal abierto: progreso → «Tu PDF está listo» → abrir PDF', async () => {
		mode = 'ok';
		plugin.openModal();
		const el: HTMLElement = plugin.modal.contentEl;
		button(el, 'Generar PDF').click();
		assert.ok(el.querySelector('.synthesis-spinner') || /Tu PDF/.test(el.textContent ?? ''), 'debe mostrar el progreso');
		await waitFor(() => (el.textContent ?? '').includes('Tu PDF está listo'));
		const text = el.textContent ?? '';
		assert.match(text, /Synthesis\/Síntesis - Resumen de prueba \(\d{4}-\d{2}-\d{2}\)\.pdf/);
		assert.match(text, /4\.321 tokens de entrada/);
		assert.ok(created.some((c) => c.path.endsWith('.pdf')));
		button(el, 'Abrir PDF').click();
		assert.equal(opened.length, 1);
		assert.ok(opened[0].path.endsWith('.pdf'));
		assert.equal(plugin.modal, null);
	});
	await test('si se cierra el modal mientras corre, sigue en segundo plano y avisa al terminar', async () => {
		mode = 'slow';
		Notice.log.length = 0;
		plugin.openModal();
		button(plugin.modal.contentEl, 'Generar PDF').click();
		await sleep(60);
		assert.ok(/Ocultar/.test(plugin.modal.contentEl.textContent ?? ''), 'el modal ofrece ocultarse');
		plugin.modal.close();
		assert.equal(plugin.modal, null);
		assert.ok(/Synthesis:/.test(plugin.statusBar.textContent ?? ''), 'la barra de estado muestra el progreso');
		await waitFor(() => Notice.log.some((m) => m.includes('PDF listo')));
		assert.match(plugin.statusBar.textContent ?? '', /PDF listo/);
	});
	await test('al reabrir el modal con una síntesis en curso se muestra su progreso', async () => {
		mode = 'slow';
		plugin.openModal();
		button(plugin.modal.contentEl, 'Generar PDF').click();
		plugin.modal.close();
		plugin.openModal(); // otra instancia
		assert.ok(/Ocultar/.test(plugin.modal.contentEl.textContent ?? ''), 'debe retomar el progreso, no la selección');
		await waitFor(() => (plugin.modal.contentEl.textContent ?? '').includes('Tu PDF está listo'));
		plugin.modal.close();
	});
	await test('error de la API (401) con el modal abierto → mensaje claro y botón «Volver»', async () => {
		mode = '401';
		plugin.openModal();
		const el: HTMLElement = plugin.modal.contentEl;
		button(el, 'Generar PDF').click();
		await waitFor(() => (el.textContent ?? '').includes('No se pudo completar la síntesis'));
		assert.match(el.textContent ?? '', /clave de API no es válida/);
		button(el, 'Volver').click();
		assert.ok(el.querySelector('.synthesis-search'), 'debe volver a la selección de notas');
		plugin.modal.close();
	});
	await test('cancelar una síntesis en curso', async () => {
		mode = 'hang';
		plugin.openModal();
		const el: HTMLElement = plugin.modal.contentEl;
		button(el, 'Generar PDF').click();
		await waitFor(() => /tokens redactados/.test(el.textContent ?? ''));
		button(el, 'Cancelar síntesis').click();
		await waitFor(() => (el.textContent ?? '').includes('Síntesis cancelada'));
		assert.match(el.textContent ?? '', /No se generó ningún PDF/);
		plugin.modal.close();
	});

	await srv.close();
	const failed = results.filter((r) => !r).length;
	console.log(`\n${results.length - failed}/${results.length} pruebas de interfaz correctas`);
	process.exit(failed ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
