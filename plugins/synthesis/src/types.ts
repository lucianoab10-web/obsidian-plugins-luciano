export type EffortSetting = 'default' | 'low' | 'medium' | 'high';
export type PageSize = 'LETTER' | 'A4';

export interface SynthesisSettings {
	/** ID del secreto en el llavero de Obsidian. La clave en sí NUNCA se guarda en el vault. */
	apiKeySecret: string;
	/** ID del modelo de Claude. */
	model: string;
	/** Esfuerzo de razonamiento: 'default' no envía el parámetro y usa el valor por defecto del modelo. */
	effort: EffortSetting;
	/** Tope de tokens de salida (el razonamiento interno también cuenta). */
	maxOutputTokens: number;
	/** Carpeta del vault donde se guardan los PDF. */
	outputFolder: string;
	pageSize: PageSize;
	includeImages: boolean;
	/** Máximo de imágenes que se envían a Claude por síntesis. */
	maxImages: number;
	/** Lado máximo (px) al que se reduce cada imagen antes de enviarla. */
	maxImageSide: number;
	/** Guardar también el resumen en Markdown junto al PDF. */
	saveMarkdown: boolean;
	/** Preferencias extra que se añaden al prompt (no pueden contradecir la fidelidad a las notas). */
	extraInstructions: string;
}

export const DEFAULT_SETTINGS: SynthesisSettings = {
	apiKeySecret: '',
	model: 'claude-sonnet-5-5',
	effort: 'default',
	maxOutputTokens: 32000,
	outputFolder: 'Synthesis',
	pageSize: 'LETTER',
	includeImages: true,
	maxImages: 30,
	maxImageSide: 2000,
	saveMarkdown: false,
	extraInstructions: '',
};

export const MODEL_CHOICES: { id: string; name: string; hint: string }[] = [
	{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', hint: 'recomendado: preciso y económico' },
	{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', hint: 'el más capaz, más caro' },
	{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', hint: 'el más rápido y barato' },
];

export function modelLabel(id: string): string {
	return MODEL_CHOICES.find((m) => m.id === id)?.name ?? id;
}
