import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { TFile } from 'obsidian';
import { cleanText, collectNotes, estimateNotes, splitByFences, stripFrontmatter, tokenizeText } from '../src/collect';
import { FINAL_INSTRUCTION } from '../src/prompt';
import { ActiveRun, cleanModelOutput, executeRun } from '../src/run';
import { markdownToPdf } from '../src/pdf';
import { DEFAULT_SETTINGS, type SynthesisSettings } from '../src/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OUT = '/tmp/synthesis-out';
fs.mkdirSync(OUT, { recursive: true });

/* ───────────── Mini ejecutor de pruebas ───────────── */

const results: { name: string; ok: boolean }[] = [];
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
		console.log(`  ✓ ${name}`);
	} catch (err) {
		results.push({ name, ok: false });
		console.log(`  ✗ ${name}\n      ${String((err as Error).message).split('\n').join('\n      ')}`);
	}
}

/* ───────────── Vault simulado ───────────── */

function mkFile(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split('/').pop() as string;
	f.extension = f.name.includes('.') ? (f.name.split('.').pop() as string).toLowerCase() : '';
	f.basename = f.name.replace(/\.[^.]+$/, '');
	f.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
	return f;
}

class FakeVault {
	files = new Map<string, { file: TFile; data: string | ArrayBuffer }>();
	folders = new Set<string>();
	created: { path: string; data: string | ArrayBuffer }[] = [];
	add(path: string, data: string | ArrayBuffer): TFile {
		const file = mkFile(path);
		this.files.set(path, { file, data });
		return file;
	}
	getAbstractFileByPath(p: string): any {
		return this.files.get(p)?.file ?? (this.folders.has(p) ? { path: p } : null);
	}
	async read(f: TFile): Promise<string> {
		return this.files.get(f.path)?.data as string;
	}
	async readBinary(f: TFile): Promise<ArrayBuffer> {
		return this.files.get(f.path)?.data as ArrayBuffer;
	}
	async createFolder(p: string): Promise<void> {
		this.folders.add(p);
	}
	async createBinary(p: string, data: ArrayBuffer): Promise<TFile> {
		this.created.push({ path: p, data });
		return this.add(p, data);
	}
	async create(p: string, data: string): Promise<TFile> {
		this.created.push({ path: p, data });
		return this.add(p, data);
	}
}

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function makeApp() {
	const vault = new FakeVault();
	const img1 = fs.readFileSync('test/fixtures/diagrama-equilibrio.png');
	const img2 = fs.readFileSync('test/fixtures/esquema ciclo.png');
	vault.add('Equilibrio/diagrama-equilibrio.png', toAB(img1));
	vault.add('Termo/assets/esquema ciclo.png', toAB(img2));
	vault.add('Nota incrustada.md', 'otra nota');

	const noteA = vault.add(
		'Equilibrio/Equilibrio químico.md',
		[
			'---',
			'tags: [quim]',
			'created: 2026-09-01',
			'---',
			'# Equilibrio químico',
			'',
			'El **equilibrio químico** se alcanza cuando la velocidad directa iguala a la inversa. ==Kc== depende solo de la temperatura.',
			'',
			'![[diagrama-equilibrio.png|400]]',
			'',
			'## Principio de Le Chatelier',
			'Si se perturba el sistema, este se desplaza para contrarrestar la perturbación. Ver [[Cinética química|cinética]] y [[Termodinámica#Entalpía]].',
			'',
			'Fórmula: $K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}$',
			'',
			'%% comentario privado que no debe enviarse %%',
			'',
			'```python',
			'# este bloque conserva ![[no-es-imagen.png]] como código',
			'print("hola")',
			'```',
			'',
			'![imagen remota](https://example.com/foto.png)',
			'![[Nota incrustada]]',
			'![[no-existe.png]]',
		].join('\n'),
	);
	const noteB = vault.add(
		'Termo/Historia de la termodinámica.md',
		[
			'# Historia',
			'En 1803 Berthollet propuso la reversibilidad; en 1884 Le Chatelier formuló su principio.',
			'',
			'![Esquema del ciclo](assets/esquema%20ciclo.png "título")',
		].join('\n'),
	);

	const app: any = {
		vault,
		workspace: { getActiveViewOfType: () => null },
		metadataCache: {
			getFirstLinkpathDest(link: string) {
				for (const { file } of vault.files.values()) {
					if (file.path === link || file.name === link || file.path === `${link}.md` || (file.extension === 'md' && file.basename === link)) {
						return file;
					}
				}
				return null;
			},
		},
	};
	return { app, vault, noteA, noteB };
}

const fakePrepare = async (data: ArrayBuffer) => {
	const b = Buffer.from(data);
	const base64 = b.toString('base64');
	return {
		mediaType: 'image/png' as const,
		base64,
		dataUrl: `data:image/png;base64,${base64}`,
		width: b.readUInt32BE(16),
		height: b.readUInt32BE(20),
	};
};

/* ───────────── Servidor simulado de la API (SSE) ───────────── */

async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void) {
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			let body: any = null;
			try {
				body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			} catch {
				/* sin cuerpo JSON */
			}
			handler(req, res, body);
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}`,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((r) => server.close(() => r()));
		},
	};
}

const ev = (res: http.ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function sseStart(res: http.ServerResponse) {
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
	ev(res, 'message_start', {
		type: 'message_start',
		message: {
			id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [],
			stop_reason: null, stop_sequence: null, usage: { input_tokens: 4321, output_tokens: 1 },
		},
	});
	ev(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
}

function streamText(res: http.ServerResponse, text: string, stop = 'end_turn') {
	sseStart(res);
	for (let i = 0; i < text.length; i += 120) {
		ev(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 120) } });
	}
	ev(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
	ev(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 987 } });
	ev(res, 'message_stop', { type: 'message_stop' });
	res.end();
}

/* ───────────── Texto que "devolvería" Claude ───────────── */

const SAMPLE_OUTPUT = `# Equilibrio químico y su historia

> **Idea clave:** Un sistema está en equilibrio cuando la velocidad de la reacción directa iguala a la de la inversa; las concentraciones dejan de cambiar, pero la reacción no se detiene.

## Conceptos clave

- **Equilibrio químico:** estado en que v₁ = v₂ (Equilibrio químico).
- **Constante de equilibrio (K_c):** depende solo de la temperatura.
  - Si Kc ≫ 1, predominan los productos.
  - Si Kc ≪ 1, predominan los reactivos.
- **Principio de Le Chatelier:** el sistema se desplaza para contrarrestar la perturbación.

> **Definición:** **Cociente de reacción (Q):** misma expresión que Kc pero con las concentraciones en cualquier instante.

> **Fórmula:** Kc = [C]ᶜ[D]ᵈ / ([A]ᵃ[B]ᵇ), para aA + bB ⇌ cC + dD

## Proceso: aplicar Le Chatelier

1. Identificar la perturbación (concentración, presión o temperatura).
2. Predecir el sentido del desplazamiento: A + B → C + D, o C + D → A + B.
3. Verificar comparando Q con Kc.

> **Proceso:** si Q < Kc la reacción avanza hacia los productos (→); si Q > Kc, hacia los reactivos (←).

![Diagrama del equilibrio dinámico](imagen:1)

## Relaciones

| Concepto | Relación | Concepto |
|---|---|---|
| Temperatura | modifica el valor de | Kc |
| Q | se compara con | Kc |
| Concentración | desplaza el equilibrio sin cambiar | Kc |

## Cronología

| Año | Hecho |
|---|---|
| 1803 | Berthollet propone la reversibilidad de las reacciones |
| 1884 | Le Chatelier formula su principio |

> **Ojo:** las notas no indican las unidades de Kc.

![Esquema del ciclo termodinámico](imagen:2)

## Puntos por revisar

- Caracteres especiales: a < b & c > d; H₂O, CO₃²⁻, ΔG = ΔH − T·ΔS, α, β, π ≈ 3,14; x ∈ A ∪ B.
`;

const settingsWith = (patch: Partial<SynthesisSettings> = {}): SynthesisSettings => ({
	...DEFAULT_SETTINGS,
	apiKeySecret: 'test',
	saveMarkdown: true,
	...patch,
});

/* ───────────── Pruebas ───────────── */

async function main() {
	console.log('\nMarkdown de las notas');
	await test('tokenizeText reconoce ![[…]] y ![](…) con alias, tamaño y rutas con espacios', () => {
		const segs = tokenizeText('a ![[img.png|texto|300]] b ![[x.png|400]] c ![alt](ruta/a%20b.png "t") d ![](<mi ruta/z.png>)');
		const imgs = segs.filter((s) => s.kind !== 'text') as any[];
		assert.equal(imgs.length, 4);
		assert.deepEqual([imgs[0].target, imgs[0].alt], ['img.png', 'texto']);
		assert.deepEqual([imgs[1].target, imgs[1].alt], ['x.png', '']);
		assert.deepEqual([imgs[2].url, imgs[2].alt], ['ruta/a%20b.png', 'alt']);
		assert.equal(imgs[3].url, 'mi ruta/z.png');
	});
	await test('cleanText quita comentarios %%…%% y deja los wikilinks legibles', () => {
		assert.equal(cleanText('x %%oculto%% y [[A|alias]] z [[B#Sección]] w [[C#^bloque]]'), 'x  y alias z B › Sección w C');
	});
	await test('stripFrontmatter y splitByFences', () => {
		assert.equal(stripFrontmatter('---\na: 1\n---\n# T'), '# T');
		const parts = splitByFences('antes\n```js\n![[x.png]]\n```\ndespués');
		assert.deepEqual(parts.map((p) => p.code), [false, true, false]);
	});

	console.log('\nRecolección de notas');
	await test('collectNotes intercala imágenes, limpia el texto y avisa de lo que falta', async () => {
		const { app, noteA, noteB } = makeApp();
		const r = await collectNotes(app, [noteA, noteB], { includeImages: true, maxImages: 30, maxImageSide: 2000 }, undefined, { prepareImage: fakePrepare });
		const text = r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
		assert.equal(r.images.length, 2, 'debe haber 2 imágenes (la remota y la inexistente no cuentan)');
		assert.deepEqual(r.images.map((i) => i.name), ['diagrama-equilibrio.png', 'esquema ciclo.png']);
		assert.ok(text.includes('<nota n="1" titulo="Equilibrio químico">'));
		assert.ok(!text.includes('created: 2026-09-01'), 'el frontmatter no debe enviarse');
		assert.ok(!text.includes('comentario privado'), 'los comentarios %% no deben enviarse');
		assert.ok(text.includes('![[no-es-imagen.png]]') && text.includes('print("hola")'), 'el código se conserva intacto');
		assert.ok(text.includes('cinética') && text.includes('Termodinámica › Entalpía'));
		assert.ok(text.includes('[Imagen remota no incluida: imagen remota]'));
		assert.ok(text.includes('[Contenido incrustado «Nota incrustada»: no se incluye aquí]'));
		assert.ok(text.includes('[Imagen no encontrada: no-existe.png]'));
		assert.ok(r.warnings.some((w) => w.includes('no-existe.png')));
		// Orden: texto con «[Imagen 1: …]» y justo después el bloque de imagen.
		const idx = r.content.findIndex((b) => b.type === 'image');
		assert.ok((r.content[idx - 1] as any).text.trimEnd().endsWith('texto alternativo: «diagrama-equilibrio.png»]') === false);
		assert.ok((r.content[idx - 1] as any).text.includes('[Imagen 1: «diagrama-equilibrio.png»]'));
		assert.equal((r.content[idx] as any).source.media_type, 'image/png');
	});
	await test('collectNotes respeta el máximo de imágenes y la opción de no enviarlas', async () => {
		const { app, noteA, noteB } = makeApp();
		const lim = await collectNotes(app, [noteA, noteB], { includeImages: true, maxImages: 1, maxImageSide: 2000 }, undefined, { prepareImage: fakePrepare });
		assert.equal(lim.images.length, 1);
		assert.ok(lim.warnings.some((w) => w.includes('máximo de 1 imágenes')));
		const off = await collectNotes(app, [noteA], { includeImages: false, maxImages: 30, maxImageSide: 2000 }, undefined, { prepareImage: fakePrepare });
		assert.equal(off.images.length, 0);
		assert.equal(off.content.filter((b) => b.type === 'image').length, 0);
	});
	await test('estimateNotes cuenta imágenes sin leerlas', async () => {
		const { app, noteA, noteB } = makeApp();
		const e = await estimateNotes(app, [noteA, noteB]);
		assert.equal(e.images, 3); // diagrama, no-existe.png y esquema (la remota no cuenta; la del bloque de código tampoco)
		assert.ok(e.textTokens > 50);
	});

	console.log('\nPetición a la API (servidor simulado)');
	await test('executeRun: payload correcto, PDF y .md guardados en el vault', async () => {
		let captured: any = null;
		let headers: http.IncomingHttpHeaders = {};
		const srv = await startServer((req, res, body) => {
			captured = body;
			headers = req.headers;
			streamText(res, SAMPLE_OUTPUT);
		});
		try {
			const { app, vault, noteA, noteB } = makeApp();
			const run = new ActiveRun();
			const stages = new Set<string>();
			run.subscribe((s) => stages.add(s.stage));
			await executeRun(app, settingsWith(), 'sk-ant-test', [noteA, noteB], run, { baseURL: srv.url, prepareImage: fakePrepare, now: new Date('2026-10-08T12:00:00') });

			assert.equal(run.state.stage, 'done', `estado final: ${run.state.stage} ${run.state.error ?? ''}`);
			assert.ok(['collect', 'claude', 'pdf', 'save', 'done'].every((s) => stages.has(s)), `etapas: ${[...stages]}`);

			// Cabeceras y parámetros
			assert.equal(headers['x-api-key'], 'sk-ant-test');
			assert.ok(headers['anthropic-version']);
			assert.equal(captured.model, 'claude-sonnet-5-5');
			assert.equal(captured.stream, true);
			assert.equal(captured.max_tokens, 32000);
			for (const k of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice', 'thinking', 'output_config']) {
				assert.ok(!(k in captured), `no debe enviarse «${k}»`);
			}
			// Prompt de sistema
			assert.ok(captured.system.includes('EXCLUSIVAMENTE') && captured.system.includes('fidelidad estricta'));
			// Contenido
			const blocks = captured.messages[0].content as any[];
			assert.equal(captured.messages.length, 1);
			assert.equal(blocks[0].type, 'text');
			assert.ok(blocks[0].text.includes('2 notas'));
			assert.equal(blocks.filter((b) => b.type === 'image').length, 2);
			assert.equal(blocks[blocks.length - 1].text, FINAL_INSTRUCTION);
			assert.ok(blocks.every((b) => b.type !== 'text' || b.text.trim().length > 0), 'no debe haber bloques de texto vacíos');

			// Resultado
			const res = run.state.result;
			assert.ok(res);
			assert.equal(res.inputTokens, 4321);
			assert.equal(res.outputTokens, 987);
			assert.equal(res.truncated, false);
			assert.equal(res.title, 'Equilibrio químico y su historia');
			assert.ok(res.pdf.path.startsWith('Synthesis/Síntesis - Equilibrio químico y su historia (2026-10-08)'));
			const pdf = vault.created.find((c) => c.path.endsWith('.pdf'));
			assert.ok(pdf);
			const bytes = Buffer.from(pdf.data as ArrayBuffer);
			assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
			fs.writeFileSync(`${OUT}/sintesis.pdf`, bytes);
			assert.ok(vault.created.some((c) => c.path.endsWith('.md')), 'debe guardar también el .md');
		} finally {
			await srv.close();
		}
	});
	await test('executeRun: esfuerzo y modelo elegidos viajan en la petición; truncado se avisa', async () => {
		let captured: any = null;
		const srv = await startServer((_req, res, body) => {
			captured = body;
			streamText(res, SAMPLE_OUTPUT, 'max_tokens');
		});
		try {
			const { app, noteA } = makeApp();
			const run = new ActiveRun();
			await executeRun(app, settingsWith({ effort: 'medium', model: 'claude-opus-5-5', maxOutputTokens: 5000 }), 'k', [noteA], run, { baseURL: srv.url, prepareImage: fakePrepare });
			assert.equal(run.state.stage, 'done', run.state.error);
			assert.deepEqual(captured.output_config, { effort: 'medium' });
			assert.equal(captured.model, 'claude-opus-5-5');
			assert.equal(captured.max_tokens, 5000);
			assert.ok(run.state.result?.truncated);
			assert.ok(run.state.result?.warnings.some((w) => w.includes('máximo de tokens')));
		} finally {
			await srv.close();
		}
	});
	await test('executeRun: clave inválida (401) → mensaje claro', async () => {
		const srv = await startServer((_req, res) => {
			res.writeHead(401, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
		});
		try {
			const { app, noteA } = makeApp();
			const run = new ActiveRun();
			await executeRun(app, settingsWith(), 'mala', [noteA], run, { baseURL: srv.url, prepareImage: fakePrepare });
			assert.equal(run.state.stage, 'error');
			assert.ok(/clave de API no es válida/.test(run.state.error ?? ''), run.state.error);
		} finally {
			await srv.close();
		}
	});
	await test('executeRun: sin saldo (400) → indica dónde comprar créditos', async () => {
		const srv = await startServer((_req, res) => {
			res.writeHead(400, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }));
		});
		try {
			const { app, noteA } = makeApp();
			const run = new ActiveRun();
			await executeRun(app, settingsWith(), 'k', [noteA], run, { baseURL: srv.url, prepareImage: fakePrepare });
			assert.equal(run.state.stage, 'error');
			assert.ok(/no tiene saldo/.test(run.state.error ?? '') && /Billing/.test(run.state.error ?? ''), run.state.error);
		} finally {
			await srv.close();
		}
	});
	await test('executeRun: cancelar a mitad de la respuesta → estado «cancelled», sin PDF', async () => {
		const srv = await startServer((_req, res) => {
			sseStart(res);
			ev(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '# Parcial' } });
			// …y la conexión queda abierta, como una respuesta larga en curso.
		});
		try {
			const { app, vault, noteA } = makeApp();
			const run = new ActiveRun();
			const p = executeRun(app, settingsWith(), 'k', [noteA], run, { baseURL: srv.url, prepareImage: fakePrepare });
			await new Promise((r) => setTimeout(r, 500));
			assert.equal(run.state.stage, 'claude');
			assert.ok(run.state.approxTokens > 0, 'debe reportar tokens en curso');
			run.abort.abort();
			await p;
			assert.equal(run.state.stage, 'cancelled');
			assert.equal(vault.created.length, 0);
		} finally {
			await srv.close();
		}
	});

	await test('collectNotes: si una imagen no se puede procesar, la omite, avisa y sigue con el resto', async () => {
		const { app, noteA } = makeApp();
		const boom = async () => {
			throw new Error('formato de imagen no compatible');
		};
		const r = await collectNotes(app, [noteA], { includeImages: true, maxImages: 30, maxImageSide: 2000 }, undefined, { prepareImage: boom });
		const text = r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
		assert.equal(r.images.length, 0);
		assert.ok(r.warnings.some((w) => w.includes('No se pudo procesar la imagen «diagrama-equilibrio.png»')));
		assert.ok(text.includes('[Imagen no legible: diagrama-equilibrio.png]'));
		assert.ok(text.includes('Principio de Le Chatelier'), 'el resto de la nota se conserva');
	});
	await test('executeRun: límite de uso (429) → mensaje con el detalle de la API', async () => {
		const srv = await startServer((_req, res) => {
			res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
			res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'This request would exceed the rate limit for your organization of 30,000 input tokens per minute.' } }));
		});
		try {
			const { app, noteA } = makeApp();
			const run = new ActiveRun();
			await executeRun(app, settingsWith(), 'k', [noteA], run, { baseURL: srv.url, prepareImage: fakePrepare });
			assert.equal(run.state.stage, 'error');
			assert.ok(/límite de uso/.test(run.state.error ?? '') && /30,000 input tokens per minute/.test(run.state.error ?? ''), run.state.error);
		} finally {
			await srv.close();
		}
	});

	await test('executeRun: si fetch falla (p. ej. bloqueo CORS) reintenta con requestUrl de Obsidian', async () => {
		const srv = await startServer((_req, res) => streamText(res, SAMPLE_OUTPUT));
		const g = globalThis as any;
		const realFetch = g.fetch;
		g.__realFetch = realFetch;
		g.__requestUrlCalls = 0;
		g.fetch = async () => {
			throw new TypeError('Failed to fetch');
		};
		try {
			const { app, noteA } = makeApp();
			const run = new ActiveRun();
			await executeRun(app, settingsWith(), 'k', [noteA], run, { baseURL: srv.url, prepareImage: fakePrepare });
			assert.equal(run.state.stage, 'done', `${run.state.stage}: ${run.state.error ?? ''}`);
			assert.ok(g.__requestUrlCalls >= 1, 'debe haber usado requestUrl');
			assert.equal(run.state.result?.title, 'Equilibrio químico y su historia');
		} finally {
			g.fetch = realFetch;
			await srv.close();
		}
	});
	await test('executeRun: sin conexión de ningún tipo → mensaje de conexión', async () => {
		const g = globalThis as any;
		const realFetch = g.fetch;
		g.__realFetch = async () => {
			throw new TypeError('fetch failed');
		};
		g.fetch = async () => {
			throw new TypeError('Failed to fetch');
		};
		try {
			const { app, noteA } = makeApp();
			const run = new ActiveRun();
			await executeRun(app, settingsWith(), 'k', [noteA], run, { baseURL: 'http://127.0.0.1:9', prepareImage: fakePrepare });
			assert.equal(run.state.stage, 'error');
			assert.match(run.state.error ?? '', /No se pudo conectar con api\.anthropic\.com/);
		} finally {
			g.fetch = realFetch;
			g.__realFetch = realFetch;
		}
	});

	console.log('\nPDF');
	await test('cleanModelOutput quita bloque envolvente y preámbulo, pero conserva estructura', () => {
		assert.equal(cleanModelOutput('```markdown\n# T\n\ntexto\n```'), '# T\n\ntexto');
		assert.equal(cleanModelOutput('Aquí tienes el resumen:\n\n# T\n\ntexto'), '# T\n\ntexto');
		assert.equal(cleanModelOutput('Intro\n\n- punto\n\n# T'), 'Intro\n\n- punto\n\n# T');
	});
	await test('markdownToPdf: documento con figuras, tablas y recuadros (A4 y Carta)', async () => {
		const img = await fakePrepare(toAB(fs.readFileSync('test/fixtures/diagrama-equilibrio.png')));
		const img2 = await fakePrepare(toAB(fs.readFileSync('test/fixtures/esquema ciclo.png')));
		for (const size of ['LETTER', 'A4'] as const) {
			const r = await markdownToPdf(SAMPLE_OUTPUT, {
				fallbackTitle: 'x',
				sources: ['Equilibrio químico', 'Historia de la termodinámica'],
				images: new Map([[1, { id: 1, name: 'a.png', ...img }], [2, { id: 2, name: 'b.png', ...img2 }]]),
				pageSize: size,
				modelLabel: 'Claude Sonnet 5.5',
				generatedAt: new Date('2026-10-08T12:00:00'),
			});
			fs.writeFileSync(`${OUT}/muestra-${size}.pdf`, Buffer.from(r.buffer));
			assert.equal(r.title, 'Equilibrio químico y su historia');
		}
	});
	await test('markdownToPdf: sin títulos huérfanos al pie de página (36 desplazamientos distintos)', async () => {
		const section = (i: number) =>
			`## Sección ${i}: conceptos y procesos\n\nEste párrafo introduce la sección ${i} con **términos clave** y una *aclaración* que ocupa un par de líneas, para simular contenido real de estudio sin ser demasiado largo.\n\n` +
			`### Subtema ${i}.1\n\n- Primer punto de la lista ${i}\n- Segundo punto con \`código\`\n  - Detalle anidado\n- Tercer punto\n\n` +
			`> **Definición:** término ${i}: descripción breve del término.\n\n### Subtema ${i}.2\n\n1. Paso uno\n2. Paso dos\n3. Paso tres\n\n` +
			`| Año | Hecho |\n|---|---|\n| 18${i}0 | Ocurre algo importante en la sección ${i} |\n| 19${i}0 | Ocurre otra cosa |\n\n`;
		const body = [1, 2, 3, 4, 5, 6].map(section).join('');
		const headings = new Set(body.split('\n').filter((l) => /^#{2,4} /.test(l)).map((l) => l.replace(/^#+\s+/, '').trim()));
		const bad: string[] = [];
		let maxPages = 0;
		for (let k = 0; k < 36; k++) {
			const md = `# Prueba de paginación\n\n${Array.from({ length: k }, () => 'Línea de relleno para desplazar el contenido.').join('\n\n')}\n\n${body}`;
			const r = await markdownToPdf(md, { fallbackTitle: 'x', sources: [], images: new Map(), pageSize: 'LETTER', modelLabel: 'm' });
			const file = `${OUT}/paginacion.pdf`;
			fs.writeFileSync(file, Buffer.from(r.buffer));
			const txt = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout;
			const pages = txt.split('\f').filter((p) => p.trim());
			maxPages = Math.max(maxPages, pages.length);
			pages.forEach((p, i) => {
				const lines = p.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Synthesis ·') && !/^\d+ \/ \d+$/.test(l) && !/\d+ \/ \d+$/.test(l));
				const last = lines[lines.length - 1];
				if (last && headings.has(last)) bad.push(`relleno ${k}, página ${i + 1}: «${last}»`);
			});
		}
		assert.ok(maxPages >= 4, `las pruebas deben abarcar varias páginas (máx. ${maxPages})`);
		assert.equal(bad.length, 0, `títulos huérfanos:\n${bad.join('\n')}`);
	});

	const failed = results.filter((r) => !r.ok).length;
	console.log(`\n${results.length - failed}/${results.length} pruebas correctas`);
	process.exit(failed ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
