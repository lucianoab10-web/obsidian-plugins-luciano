# Editor visual de marca

Un plugin complementario de Deck HTML. Abre un panel al lado de la guía y transforma tus elecciones en una nota Markdown limpia. No necesita API ni envía información a servicios externos.

## Instalación

1. Copia la carpeta `brand-guide-editor`, con `main.js`, `manifest.json` y `styles.css`, a la carpeta de plugins de tu vault.
2. En tu configuración de portátil esa carpeta es `.obsidian-laptop/plugins/`. En una instalación estándar es `.obsidian/plugins/`.
3. Reinicia Obsidian y activa **Editor visual de marca** en Ajustes → Plugins de la comunidad.

## Uso

Abre `Brand/guia-de-marca.md`. El panel **Estudio de marca** aparecerá a la derecha. También puedes abrirlo con el icono de paleta o el comando **Editor visual de marca: Editar guía de marca**.

- Escribe tu identidad y elige una paleta, o activa colores por separado y pulsa sus muestras de color.
- Selecciona o escribe las fuentes; puedes indicar también su peso, por ejemplo `Montserrat Bold`. Para que se vean en la vista previa deben estar instaladas. El plugin no descarga fuentes.
- Selecciona tu logo entre las imágenes del vault y completa las reglas que necesites.
- Los campos vacíos y los colores desactivados se omiten del Markdown. Las reglas existentes siguen presentes hasta que las borres en el formulario.
- Pulsa **Revisar y guardar** para ver el Markdown final y luego **Guardar guía**.
- Crea tu presentación con Deck HTML y activa **Aplicar guía de marca**. Ambos plugins deben apuntar a la misma nota en sus ajustes.

La vista 16:9 ilustra los colores, fuentes y logo; no es la presentación final de Claude. Los campos de estilo y las reglas se envían como instrucciones de marca, sin pretender reproducir todas sus combinaciones en esta vista.

## Guardado y recuperación

El archivo original no se toca hasta que guardas. Cada guardado crea una copia en `Historial de marca`, junto a tu guía. Puedes abrir esas notas y copiar su contenido de vuelta a la guía si necesitas recuperar una versión.

Los cambios del formulario se conservan como borrador local en los datos del plugin. Si la nota cambia externamente, el plugin impide sobrescribirla: conserva tu borrador y permite recargar la versión del archivo. Si ese borrador ya no coincide con el archivo al volver a abrir, permanece en `data.json` para recuperación manual.

Las propiedades iniciales de la nota y el contenido no reconocido se conservan. Este último aparece en **Notas adicionales**. Revisa esa sección antes de guardar una guía que tenga un formato distinto del de Deck HTML.

El panel también reconoce notas con `tipo: guia-de-marca`. La ruta configurada sigue siendo la guía predeterminada. Cambiar a otra nota no cambia automáticamente la ruta de Deck HTML.

## Compatibilidad

Preparado para Obsidian 1.7.2 o posterior. Comprobado contra la lectura de guía e imágenes de Deck HTML 1.0.0: conserva la nota completa, los tokens `brand` y `![[ruta-del-logo]]`. No modifica Deck HTML ni genera presentaciones por sí solo.

Incluye pruebas de lectura, limpieza, conservación, conflictos y controles de interfaz con una simulación del API de Obsidian. La validación dentro de la aplicación real y una generación con Claude requieren activar el plugin y usar tu API.

## Código fuente

El archivo ZIP de código fuente incluye `src/`, pruebas y un archivo de dependencias. Ejecuta `npm ci`, `npm test` y `npm run build` para reconstruirlo.

Referencia del API: https://docs.obsidian.md/Plugins/Events
