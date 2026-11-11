import Anthropic from '@anthropic-ai/sdk';
import { requestUrl } from 'obsidian';
import type { EffortSetting } from './types';

export class CancelledError extends Error {
	constructor() {
		super('Síntesis cancelada.');
		this.name = 'CancelledError';
	}
}

export interface ClaudeRequest {
	apiKey: string;
	model: string;
	maxTokens: number;
	effort: EffortSetting;
	system: string;
	content: Anthropic.ContentBlockParam[];
	signal?: AbortSignal;
	/** Solo para pruebas con un servidor simulado. */
	baseURL?: string;
	/** Se llama con la cantidad de caracteres generados hasta ahora. */
	onText?: (charsSoFar: number) => void;
}

export interface ClaudeResult {
	text: string;
	stopReason: string | null;
	inputTokens: number;
	outputTokens: number;
}

/** Traduce los errores del SDK a mensajes que un usuario nuevo en la API pueda entender. */
function friendly(e: unknown, model: string): Error {
	if (e instanceof Anthropic.APIUserAbortError) return new CancelledError();
	if (e instanceof Anthropic.AuthenticationError) {
		return new Error('La clave de API no es válida o fue revocada (error 401). Revísala en Ajustes → Synthesis.');
	}
	if (e instanceof Anthropic.PermissionDeniedError) {
		return new Error('Tu clave no tiene permiso para usar este modelo o función (error 403).');
	}
	if (e instanceof Anthropic.NotFoundError) {
		return new Error(`El modelo «${model}» no existe o no está disponible para tu cuenta (error 404).`);
	}
	if (e instanceof Anthropic.RateLimitError) {
		const retry = e.headers?.get('retry-after');
		return new Error(
			`Se superó un límite de uso de tu cuenta (error 429)${retry ? `; reintenta en unos ${retry} s` : ''}. ` +
				'Si seleccionaste muchas notas o imágenes, prueba con menos. ' +
				`Detalle de la API: ${e.message.slice(0, 300)}`,
		);
	}
	if (e instanceof Anthropic.BadRequestError) {
		if (/credit balance|billing|too low/i.test(e.message)) {
			return new Error(
				'Tu cuenta de la API no tiene saldo. Compra créditos en platform.claude.com → Settings → Billing y vuelve a intentarlo.',
			);
		}
		return new Error(`La API rechazó la solicitud: ${e.message}`);
	}
	if (e instanceof Anthropic.InternalServerError) {
		return new Error('El servicio de Claude está con problemas o sobrecargado (error 5xx). Reintenta en unos minutos.');
	}
	if (e instanceof Anthropic.APIConnectionError) {
		return new Error('No se pudo conectar con api.anthropic.com. Revisa tu conexión a internet.');
	}
	return e instanceof Error ? e : new Error(String(e));
}

/**
 * `fetch` construido sobre `requestUrl` de Obsidian, que no está sujeto a CORS. Solo se usa de respaldo:
 * no hay streaming (la respuesta llega completa) y, al cancelar, la petición ya enviada no se puede detener.
 */
function obsidianFetch(signal?: AbortSignal): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			if (key !== 'content-length' && key !== 'host') headers[key] = value;
		});
		const abortError = () => new DOMException('Aborted', 'AbortError');
		if (signal?.aborted) throw abortError();
		const pending = requestUrl({
			url,
			method: init?.method ?? 'GET',
			headers,
			body: typeof init?.body === 'string' ? init.body : undefined,
			throw: false,
		});
		pending.catch(() => undefined); // evita «unhandled rejection» si pierde la carrera con el abort
		const aborted = new Promise<never>((_, reject) => {
			signal?.addEventListener('abort', () => reject(abortError()), { once: true });
		});
		const res = await Promise.race([pending, aborted]);
		return new Response(res.arrayBuffer, { status: res.status, headers: res.headers });
	}) as typeof fetch;
}

function newClient(apiKey: string, baseURL: string | undefined, maxRetries: number, fetchImpl?: typeof fetch): Anthropic {
	// dangerouslyAllowBrowser: Obsidian se ejecuta en un entorno de navegador. La clave sale solo desde
	// tu equipo hacia api.anthropic.com y se guarda en el llavero del sistema (SecretStorage).
	return new Anthropic({ apiKey, baseURL, dangerouslyAllowBrowser: true, maxRetries, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

/**
 * Ejecuta la llamada con el `fetch` del navegador (streaming, cancelable). Si ni siquiera se logra establecer
 * la conexión (p. ej. por un bloqueo CORS), reintenta una vez con `requestUrl` de Obsidian.
 */
async function withFallback<T>(
	apiKey: string,
	baseURL: string | undefined,
	maxRetries: number,
	signal: AbortSignal | undefined,
	run: (client: Anthropic) => Promise<T>,
): Promise<T> {
	try {
		return await run(newClient(apiKey, baseURL, maxRetries));
	} catch (e) {
		if (!(e instanceof Anthropic.APIConnectionError) || signal?.aborted) throw e;
		return await run(newClient(apiKey, baseURL, 0, obsidianFetch(signal)));
	}
}

export async function generateSummary(req: ClaudeRequest): Promise<ClaudeResult> {
	// Sin `tools`: Claude no puede buscar en la web ni usar nada que no sea el material recibido.
	// Sin `temperature`/`top_p`: los modelos 5.x rechazan valores distintos del predeterminado.
	const params: Anthropic.MessageStreamParams = {
		model: req.model,
		max_tokens: req.maxTokens,
		system: req.system,
		messages: [{ role: 'user', content: req.content }],
		...(req.effort !== 'default' ? { output_config: { effort: req.effort } } : {}),
	};
	try {
		const message = await withFallback(req.apiKey, req.baseURL, 2, req.signal, async (client) => {
			const stream = client.messages.stream(params, { signal: req.signal });
			stream.on('text', (_delta, snapshot) => req.onText?.(snapshot.length));
			return stream.finalMessage();
		});
		const text = message.content
			.map((b) => (b.type === 'text' ? b.text : ''))
			.join('')
			.trim();
		const stop = message.stop_reason as string | null;
		if (stop === 'refusal') {
			throw new Error('Claude se negó a procesar este contenido (stop_reason: refusal).');
		}
		if (!text) {
			throw new Error(
				stop === 'max_tokens'
					? 'Claude agotó el máximo de tokens antes de escribir la síntesis (el razonamiento interno también cuenta). Sube «Máximo de tokens de salida» en los ajustes.'
					: 'Claude no devolvió texto. Inténtalo de nuevo.',
			);
		}
		return {
			text,
			stopReason: stop,
			inputTokens: message.usage.input_tokens,
			outputTokens: message.usage.output_tokens,
		};
	} catch (e) {
		throw friendly(e, req.model);
	}
}

/** Petición mínima para comprobar que la clave, el saldo y el modelo funcionan. */
export async function testConnection(apiKey: string, model: string, baseURL?: string): Promise<void> {
	try {
		await withFallback(apiKey, baseURL, 1, undefined, (client) =>
			client.messages.create({
				model,
				max_tokens: 64,
				messages: [{ role: 'user', content: 'Responde solo con la palabra: ok' }],
			}),
		);
	} catch (e) {
		throw friendly(e, model);
	}
}
