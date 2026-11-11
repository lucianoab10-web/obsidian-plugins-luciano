// Reemplazo mínimo de la API de Obsidian: solo lo que usan collect.ts y run.ts en tiempo de ejecución.
export class TFile {
	path = '';
	name = '';
	basename = '';
	extension = '';
	parent: { path: string } | null = null;
	stat = { mtime: 0, ctime: 0, size: 0 };
}

export class MarkdownView {}

export function normalizePath(p: string): string {
	return p
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/|\/$/g, '');
}

// Simula requestUrl con el fetch real de Node (las pruebas pueden reemplazar globalThis.fetch por uno que falle).
export function requestUrl(req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) {
	const g = globalThis as any;
	g.__requestUrlCalls = (g.__requestUrlCalls ?? 0) + 1;
	const realFetch: typeof fetch = g.__realFetch ?? g.fetch;
	return realFetch(req.url, { method: req.method, headers: req.headers, body: req.body }).then(async (r) => ({
		status: r.status,
		headers: Object.fromEntries(r.headers.entries()),
		arrayBuffer: await r.arrayBuffer(),
	}));
}
