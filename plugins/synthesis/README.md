# Synthesis — PDF de estudio con Claude para Obsidian

Elige una o varias notas de tu vault y Synthesis genera un **PDF resumen para estudiar** con la API de Claude:
conceptos, ideas, procesos, relaciones entre ellos y fechas o datos históricos. Claude trabaja **solo con el texto
y las imágenes de las notas seleccionadas**: no agrega información externa y no tiene ninguna herramienta de búsqueda.

## Uso

1. Pulsa el ícono del birrete en la barra lateral izquierda (o ejecuta «Synthesis: Crear PDF de estudio con Claude»
   desde la paleta de comandos; en el móvil es la forma más cómoda).
2. La **nota abierta aparece preseleccionada**. Busca y suma más notas si quieres; verás una estimación de tokens.
3. Pulsa **Generar PDF**. No hace falta escribir ningún comentario: Claude ya sabe qué hacer.
   Puedes ocultar la ventana mientras trabaja; te avisará al terminar.
4. El PDF queda en la carpeta `Synthesis/` del vault (configurable) y se abre con el visor de Obsidian.

La extensión del PDF depende del material: pocas notas dan un resumen breve; muchas, uno más largo. No hay un
número fijo de páginas.

## Qué contiene el PDF

- Título, fuentes (las notas usadas), fecha y numeración de páginas.
- Recuadros de color: **Definición**, **Idea clave**, **Proceso**, **Relación**, **Dato**, **Fórmula** y **Ojo**
  (este último marca vacíos, ambigüedades o contradicciones del material).
- Tablas para cronologías y relaciones; listas ordenadas para procesos.
- Las imágenes imprescindibles (esquemas, gráficos), no todas.
- Si el material lo justifica, una sección final «Puntos por revisar».

## Instalación

1. Copia la carpeta `synthesis` (con `manifest.json`, `main.js` y `styles.css`) a
   `<tu-vault>/.obsidian/plugins/synthesis/`.
2. En Obsidian: **Ajustes → Complementos de la comunidad →** activa **Synthesis**. Requiere Obsidian 1.11.4 o superior.

Para compilar desde el código fuente: `npm install` y luego `npm run build`.

## Obtener y configurar la clave de API

La API de Claude se factura **aparte** de cualquier plan de Claude.ai. Pasos:

1. Entra en <https://platform.claude.com> con tu cuenta.
2. **Settings → Billing**: compra créditos (la API es prepago). Conviene fijar también un límite de gasto mensual.
3. **Settings → API keys → Create key**. Copia la clave: se muestra una sola vez.
4. En Obsidian: **Ajustes → Synthesis → Clave de API de Claude**. El campo usa el llavero de Obsidian: crea un
   secreto nuevo con tu clave (o elige uno existente).
5. Pulsa **Probar conexión**: comprueba la clave, el saldo y el modelo con una petición mínima.

La clave **no se guarda dentro del vault** (solo el nombre del secreto), así que no viaja con iCloud, Obsidian Sync,
git ni Quartz. La contrapartida: en cada dispositivo donde uses el plugin hay que ingresarla de nuevo.

### Costo aproximado

Con Claude Sonnet 5.5 (el modelo por defecto): US$2 por millón de tokens de entrada y US$10 por millón de salida.
Por ejemplo, 20 000 tokens de notas y un resumen de 3 000 tokens cuestan unos US$0,07. Las imágenes consumen tokens de
entrada, y el razonamiento interno del modelo cuenta como salida. Cancelar detiene la generación, pero lo ya
procesado puede cobrarse. Los límites por minuto dependen del nivel de tu cuenta (los ves en la Consola de Claude);
si una selección enorme los supera, el plugin lo indica con el detalle de la API.

## Fidelidad a las notas

Claude no se «entrena»: se le instruye. Synthesis lo hace de dos maneras: un prompt de sistema estricto (solo el
material entregado; no completar vacíos; señalar contradicciones e ilegibilidades) y **ninguna herramienta
habilitada**, de modo que no puede buscar nada. Aun así, ningún prompt garantiza fidelidad del 100 %: revisa el PDF,
sobre todo en datos y fechas. Activa «Guardar también el resumen en Markdown» si quieres cotejarlo. El prompt completo
está en `src/prompt.ts`; los ajustes permiten sumar preferencias propias (sin anular la regla de fidelidad).

## Qué se envía y qué no

A `api.anthropic.com` se envía únicamente el texto (sin propiedades YAML ni comentarios `%%…%%`) y las imágenes del
vault de las notas que seleccionaste, reducidas a 2000 px de lado. No se envía nada más. Las imágenes de internet,
los PDF, el audio y las notas incrustadas (`![[otra nota]]`) no se incluyen.

## Ajustes

Modelo (Sonnet 5.5, Opus 5.5, Haiku 5.5 u otro ID), esfuerzo de razonamiento, máximo de tokens de salida, carpeta de
los PDF, tamaño de hoja (Carta o A4), guardar el `.md`, imágenes (enviar o no, máximo y resolución) e instrucciones
adicionales.

## Limitaciones conocidas

- Las fórmulas LaTeX se transcriben a texto Unicode (ΔG = ΔH − T·ΔS, H₂O, x²); no hay composición tipográfica de
  ecuaciones complejas.
- Un GIF animado se envía con su primer cuadro. Formatos de imagen: png, jpg, jpeg, gif, webp, bmp, svg, avif (según
  lo que decodifique el navegador de Obsidian). Si una imagen falla, se omite y se avisa en el resultado.
- Si el navegador de Obsidian bloquea la conexión directa con la API (CORS), Synthesis reintenta con `requestUrl` de
  Obsidian; en ese modo no hay contador de progreso en vivo.

## Desarrollo

```
npm run dev      # compila en modo vigilancia
npm run build    # verifica tipos y genera main.js de producción
npm test         # lógica + interfaz (DOM simulado) contra una API simulada; también prueba main.js
```

Estructura: `src/main.ts` (plugin), `modal.ts` (interfaz), `settings.ts`, `collect.ts` (lectura de notas e imágenes),
`claude.ts` (API), `prompt.ts`, `pdf.ts` (maquetación), `run.ts` (orquestación). `tools/make-symbols-font.py`
regenera la fuente de símbolos incrustada.

## Licencias de terceros

`@anthropic-ai/sdk`, `pdfmake` y `marked` (MIT); fuente Roboto incluida en pdfmake (Apache 2.0); subconjunto de
DejaVu Sans renombrado «Synthesis Symbols» (licencia Bitstream Vera).
