# DeepL Translate — Plugin de Obsidian

Traduce el texto seleccionado en una nota usando la API de DeepL, directamente
desde el menú de clic derecho. Muestra una vista previa (editable) de la
traducción antes de reemplazar el texto original.

## Funcionalidad

- Al seleccionar texto en una nota y hacer clic derecho, aparece la opción
  **"Traducir con DeepL"**.
- También disponible como comando (`Traducir selección con DeepL`), asignable
  a un atajo de teclado desde Ajustes → Atajos de teclado.
- Se abre un modal con el texto original y la traducción (editable).
- Botones: **Reemplazar texto** (sustituye la selección en la nota),
  **Copiar** (copia la traducción al portapapeles) y **Cancelar**.

## Instalación (modo desarrollo)

1. Necesitas Node.js 18+ instalado.
2. Copia esta carpeta dentro de `TU_VAULT/.obsidian/plugins/deepl-translate/`.
3. Dentro de la carpeta, instala dependencias y compila:

   ```bash
   npm install
   npm run build
   ```

   Esto genera `main.js` a partir de `main.ts`. Para desarrollo con
   recompilación automática usa `npm run dev`.

4. En Obsidian: Ajustes → Community plugins → activa "DeepL Translate".
5. Ve a Ajustes → DeepL Translate e ingresa tu **API key de DeepL**
   (la obtienes gratis en https://www.deepl.com/pro-api).
   - Si tu key termina en `:fx`, es una cuenta **Free**.
   - Si no, es una cuenta **Pro**.
6. Elige el idioma de destino (por defecto Español) y, opcionalmente, un
   idioma de origen fijo (por defecto detección automática).

## Archivos del proyecto

- `main.ts` — código fuente del plugin (TypeScript).
- `manifest.json` — metadatos que Obsidian necesita para reconocer el plugin.
- `styles.css` — estilos del modal de vista previa.
- `esbuild.config.mjs` / `tsconfig.json` / `package.json` — configuración de
  compilación estándar de plugins de Obsidian.
- `versions.json` — mapa de compatibilidad de versiones.

## Notas técnicas

- Las llamadas a la API se hacen con `requestUrl` de Obsidian en vez de
  `fetch`, para evitar bloqueos de CORS dentro del entorno Electron.
- El endpoint usado depende del plan configurado:
  - Free: `https://api-free.deepl.com/v2/translate`
  - Pro: `https://api.deepl.com/v2/translate`
- La API key se guarda con `saveData()` de Obsidian, en
  `.obsidian/plugins/deepl-translate/data.json` dentro del vault (no se sube
  a ningún servidor externo salvo DeepL).

## Posibles mejoras futuras

- Selector de idioma de destino "rápido" desde el propio modal (sin entrar a
  Ajustes).
- Historial de traducciones recientes.
- Soporte para traducir notas completas, no solo selecciones.
