/**
 * Prepara las imágenes de las notas para enviarlas a Claude y para incrustarlas en el PDF.
 * Claude acepta JPEG, PNG, GIF y WebP; pdfmake solo PNG y JPEG. Para unificar, toda imagen se
 * redibuja en un canvas (también reduce el peso) y se exporta como PNG o JPEG.
 * Funciona en escritorio y en móvil (solo usa APIs del navegador).
 */

export interface PreparedImage {
	mediaType: 'image/jpeg' | 'image/png';
	/** Contenido en base64, sin el prefijo "data:". */
	base64: string;
	/** Data URL completo (para pdfmake). */
	dataUrl: string;
	width: number;
	height: number;
}

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
	svg: 'image/svg+xml',
	avif: 'image/avif',
};

interface Decoded {
	source: CanvasImageSource;
	width: number;
	height: number;
	dispose: () => void;
}

async function decode(blob: Blob): Promise<Decoded> {
	try {
		const bmp = await createImageBitmap(blob);
		return { source: bmp, width: bmp.width, height: bmp.height, dispose: () => bmp.close() };
	} catch {
		// Algunos formatos (p. ej. SVG) solo se pueden decodificar con <img>.
	}
	const url = URL.createObjectURL(blob);
	const img = new Image();
	try {
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('formato de imagen no compatible'));
			img.src = url;
		});
	} catch (e) {
		URL.revokeObjectURL(url);
		throw e;
	}
	return {
		source: img,
		width: img.naturalWidth || 1024,
		height: img.naturalHeight || 768,
		dispose: () => URL.revokeObjectURL(url),
	};
}

export async function prepareImage(data: ArrayBuffer, ext: string, maxSide: number): Promise<PreparedImage> {
	const e = ext.toLowerCase();
	const blob = new Blob([data], { type: MIME[e] ?? 'application/octet-stream' });
	const dec = await decode(blob);
	try {
		const scale = Math.min(1, maxSide / Math.max(dec.width, dec.height));
		const width = Math.max(1, Math.round(dec.width * scale));
		const height = Math.max(1, Math.round(dec.height * scale));

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('el canvas no está disponible');
		// Fondo blanco: las transparencias se verían negras para Claude y en el PDF.
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(dec.source, 0, 0, width, height);

		const isJpeg = e === 'jpg' || e === 'jpeg';
		let mediaType: PreparedImage['mediaType'] = isJpeg ? 'image/jpeg' : 'image/png';
		let dataUrl = canvas.toDataURL(mediaType, 0.9);
		// Un PNG muy pesado (fotos, capturas enormes) se pasa a JPEG.
		if (!isJpeg && dataUrl.length > 6_000_000) {
			mediaType = 'image/jpeg';
			dataUrl = canvas.toDataURL(mediaType, 0.88);
		}
		return { mediaType, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl, width, height };
	} finally {
		dec.dispose();
	}
}
