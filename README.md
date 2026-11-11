# Plugins de Obsidian — Luciano

Colección de los plugins cuya autoría figura como **Luciano**, **Luciano Astudillo** o **Luciano Astudillo Baeza** en sus archivos `manifest.json`.

Esta copia se preparó el **10 de noviembre de 2026** a partir de las carpetas de plugins instalados. Incluye los archivos disponibles para su instalación y, cuando estaban presentes, sus fuentes y documentación.

| Plugin | Versión | Carpeta |
| --- | --- | --- |
| Autosort | 1.0.0 | `plugins/autosort/` |
| Editor visual de marca | 1.0.0 | `plugins/brand-guide-editor/` |
| Deck HTML | 1.1.0 | `plugins/deck-html/` |
| DeepL Translate | 1.0.0 | `plugins/deepl-translate/` |
| Markdown Analyzer | 1.0.0 | `plugins/markdown-analyzer/` |
| Mineral Template | 1.1.0 | `plugins/mineral-template/` |
| Paper Review | 1.0.0 | `plugins/paper-review-plugin/` |
| PDF Input Tags | 0.2.0 | `plugins/pdf-input-tags/` |
| Synthesis | 1.0.0 | `plugins/synthesis/` |
| Wikilinked | 1.0.0 | `plugins/wikilinked/` |

## Instalación manual

1. Abre la carpeta de tu bóveda de Obsidian.
2. Copia la carpeta del plugin que quieras instalar dentro de `.obsidian/plugins/`.
3. Comprueba que `manifest.json` y `main.js` queden directamente dentro de esa carpeta. Conserva `styles.css` cuando exista.
4. Reinicia Obsidian o recarga sus plugins y actívalo desde **Ajustes → Plugins de la comunidad**.
5. Configura el plugin desde Obsidian. Si utiliza una API, introduce tu propia clave en sus ajustes.

No reemplaces una instalación existente sin respaldar antes sus ajustes. El identificador de Paper Review en su manifiesto es `paper-review`; la carpeta de este respaldo conserva el nombre original `paper-review-plugin`.

## Archivos y credenciales

Los archivos `data*.json` de los plugins, incluidos sus duplicados, contienen ajustes personales y se excluyeron de esta copia. También se excluyeron las dependencias instaladas en `node_modules`, archivos de entorno, registros e historiales de Git anteriores.

La revisión local de credenciales entrega únicamente categorías, ubicaciones y cantidades. No publica sus valores. El archivo `.gitignore` ayuda a evitar que se agreguen ajustes y credenciales en futuras modificaciones; no sustituye la revisión de los cambios antes de subirlos.

Conserva tus claves fuera del repositorio. Al compartir un ejemplo de configuración, utiliza valores vacíos o ficticios.

## Código fuente

Las carpetas **DeepL Translate** y **Synthesis** contienen fuentes TypeScript y archivos de desarrollo. Los demás plugins se conservaron en la forma instalada disponible, principalmente `main.js`, su manifiesto y, en algunos casos, estilos o documentación. Este repositorio no reconstruye fuentes que no estaban en la copia original.

Se conservan los avisos de terceros que estaban presentes. No se ha añadido una licencia nueva al trabajo del autor.
