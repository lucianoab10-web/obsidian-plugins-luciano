# Plantillas por etiqueta — Mineral Template 1.1.0

## Activar la nueva versión

Reinicia Obsidian o desactiva y vuelve a activar **Mineral Template** en Ajustes → Plugins de la comunidad. Después abre **Ajustes → Mineral Template**.

## Configurar una asociación

1. Pulsa **Añadir regla**.
2. Escribe la etiqueta, con o sin `#`. Ejemplos: `#minerales`, `#reunión` o `#clase/geología`.
3. Pulsa **Elegir archivo** y busca un archivo Markdown de cualquier carpeta de esta bóveda. El selector muestra su ruta completa para distinguir archivos con nombres iguales. También puedes escribir una ruta relativa como `Templates/mi-plantilla.md`.
4. Deja activada la regla. Los ajustes se guardan automáticamente.

La regla inicial asocia `#minerales` con `Templates/minerales-platilla.md`, si ese es el nombre existente. También reconoce `Templates/minerales-plantilla.md` para la configuración inicial.

## Usar una regla

Añade la etiqueta a una nota, en el texto o en la propiedad `tags`, y deja que Obsidian la guarde e indexe. Se aplica la primera regla que coincida si añades varias etiquetas a la vez.

- **Reemplazar el contenido** es la opción inicial: sustituye la nota por el archivo completo de la plantilla, incluidas sus propiedades.
- **Añadir al final** conserva el contenido previo y pega la plantilla al final. Las propiedades de la plantilla se copian como texto en esa posición.
- La etiqueta activadora se añade al final para conservarla, aunque también figure dentro de la plantilla.
- En una nota abierta en modo edición puedes usar **Deshacer** para revertir el cambio.
- Las propias plantillas configuradas quedan excluidas de las transformaciones.

Las notas que ya contienen una etiqueta no se modifican al arrancar Obsidian ni al cambiar los ajustes. Para aplicar una regla a una de esas notas, quita la etiqueta, espera a que se guarde e indexe y vuelve a añadirla.

Cada etiqueta debe tener una sola regla activa. Los errores de configuración aparecen debajo de cada regla; las reglas incompletas, desactivadas o repetidas no se ejecutan.

Si renombras o mueves un archivo de plantilla dentro de Obsidian, su ruta configurada se actualiza. Si lo eliminas, elige otro archivo desde los ajustes.

## Instalar desde el ZIP

Con Obsidian cerrado, copia `main.js` y `manifest.json` dentro de la carpeta `plugins/mineral-template` del directorio de configuración de tu bóveda. Para esta instalación, el directorio es `.obsidian-laptop`. Conserva cualquier `data.json` existente: contiene tus asociaciones guardadas.

Para restaurar la versión anterior, cierra Obsidian y recupera `main.js` y `manifest.json` desde el ZIP de respaldo.
