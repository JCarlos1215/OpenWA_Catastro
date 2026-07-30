# Flujo de Chat con Drive y Google Sheets

Plugin de OpenWA para crear menús conversacionales. Cada opción puede responder con texto, enviar un archivo cargado directamente por WhatsApp y registrar la selección en Google Sheets.

## Configuración

1. Instala o copia esta carpeta en el directorio de plugins de OpenWA y habilita el plugin para la sesión de WhatsApp deseada.
2. Crea una cuenta de servicio en Google Cloud, habilita **Google Sheets API** y descarga su clave JSON.
3. Crea la hoja de cálculo y comparte la hoja con el valor `client_email` de la cuenta de servicio, con permiso de **Editor**.
4. En la configuración del plugin, pega el JSON, el ID de la hoja (el texto entre `/d/` y `/edit` en su URL) y el nombre de la pestaña. Si no se configuran ambos valores de Google Sheets, el menú sigue funcionando pero no registra filas.
5. Crea el saludo y las opciones. En cada opción usa el selector de archivo para cargar adjuntos de hasta 10 MB. El archivo se guarda en la configuración del plugin y se envía directamente por WhatsApp.

El selector admite imágenes, PDFs, documentos de Office, hojas de cálculo, archivos comprimidos, audio, video y otros archivos. Las imágenes se envían como imagen; el audio y video se envían de forma nativa; los demás tipos se envían como documento. El tipo MIME real del archivo se conserva para que WhatsApp lo interprete correctamente.

## Registro en Sheets

Cada selección agrega una fila con estas columnas, en este orden:

`fecha ISO`, `sesión`, `chat`, `nombre`, `clave elegida`, `texto de respuesta`, `ruta del menú`, `archivo o enlace`.

El plugin neutraliza valores que Google Sheets podría interpretar como fórmulas. Los errores de registro se escriben en el log del plugin y no interrumpen la respuesta al usuario.

## Ejemplo de menú

Saludo:

```text
Hola. Responde con una opción:
1. Catálogo
2. Solicitar soporte
```

Opción `1`: texto `Aquí tienes el catálogo.` y el PDF, imagen o archivo del catálogo. Opción `2`: texto con los datos de contacto o subopciones.

El texto de respuesta es opcional. Por ejemplo, una opción puede enviar solo una imagen, PDF u otro archivo sin texto.

## Volver al menú principal

Al estar dentro de un submenú, el plugin agrega la opción `0. Volver al menú principal`. La persona también puede escribir `volver`, `menu`, `menú` o `inicio`. Cualquiera de esas entradas borra la ruta actual y reenvía el mensaje de bienvenida.

## Consulta de seguimiento

Por defecto, al elegir la opción `2` desde cualquier submenú se activa la consulta de seguimiento. El bot valida primero el `No. Orden`, solicita después la `Clave Catastral sin guiones` y busca una coincidencia conjunta en la pestaña `servicios` de `todos_los_servicios`. Según el texto del seguimiento elegido también valida la columna `Movimiento` (por ejemplo, `TRANSMISION`, `AVALUO CATASTRAL`, `MANIFESTACION OFICIAL` o `ASIGNACION DE CLAVES`) antes de responder primero con `Situación Actual` y enseguida con `Estatus`. La clave con guiones se rechaza y se solicita nuevamente. Para comparar, se ignoran espacios, mayúsculas/minúsculas y otros separadores de los valores almacenados.

Comparte esa hoja con el `client_email` de la cuenta de servicio configurada en el plugin, como mínimo con acceso de Lector. En la configuración, `* > 2` representa la opción `2` dentro de cualquier submenú; también puedes agregar rutas exactas adicionales, por ejemplo `1 > 3`.

## Consideraciones

- Los adjuntos se envían sin requerir que el cliente abra un enlace. WhatsApp puede aplicar sus propios límites o restricciones a ciertos formatos.
- El estado de cada conversación expira después de 15 minutos.
- En grupos, el estado es independiente por participante. La respuesta se publica en el grupo.
