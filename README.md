# Ex Libris · Mi biblioteca

App personal para catalogar tus libros, llevar los préstamos, elegir la próxima lectura y seguir las novedades literarias. Es una app web instalable (PWA): se instala en Android y en el PC desde Chrome o Edge, funciona sin conexión y se sincroniza entre dispositivos a través de un archivo en tu Google Drive.

## Qué hace

- **Biblioteca**: título, autor, año, editorial, número de edición, ISBN, género, fecha de adquisición, valoración, tipo de edición, leído/no leído, notas y portada. Orden por cualquier campo, agrupación por género, editorial o tipo de edición, filtros y búsqueda.
- **Portadas**: cámara propia con marco 2:3 (o imagen desde archivo) y encuadre arrastrando y ampliando; se guardan a 300×450.
- **Fichas automáticas**: escáner de código de barras con la cámara en directo (también desde una foto), y búsqueda por ISBN, título o autor en el catálogo de la Biblioteca Nacional de España (SRU público, con número de edición y editorial de la edición española), Google Books y Open Library (portadas). Modo «Escanear» para dar de alta muchos libros seguidos.
- **Préstamos**: los que prestas y los que te prestan, con fechas, avisos de retraso e historial.
- **¿Qué leo ahora?**: una lectura pendiente al azar, filtrable por género.
- **Novedades**: noticias de webs literarias, editoriales y libros de música, actualizadas cada mañana por GitHub Actions (`scripts/fetch-news.mjs`, fuentes en `feeds.json`).
- **Copias**: exportar/importar CSV (Excel, Google Sheets) y copia completa en JSON.

## Puesta en marcha

1. **GitHub Pages**: en el repositorio, *Settings → Pages → Build and deployment → Source: GitHub Actions*. El flujo `.github/workflows/publicar.yml` publica la web en cada cambio y actualiza las novedades a diario. La app queda en `https://<usuario>.github.io/ex-libris/`.
2. **Google Drive** (opcional, para sincronizar):
   - En Google Cloud, crea un proyecto y habilita *Google Drive API*.
   - En *Google Auth Platform*, configura la app (público *Externo*) y añade tu correo como usuario de prueba.
   - En *Clientes → Crear cliente*, elige *Aplicación web* y añade como origen autorizado de JavaScript `https://<usuario>.github.io`.
   - Copia el ID de cliente en `config.js` (`googleClientId`) o pégalo en *Ajustes* dentro de la app.
   - La app usa el permiso `drive.file`: solo puede ver el archivo `ExLibris-biblioteca.json` que ella misma crea.
3. **Instalar**: abre la web en Chrome (Android) o Chrome/Edge (PC) y elige *Instalar aplicación*.

## Notas

- Los datos viven en cada dispositivo (IndexedDB) y se fusionan con el archivo de Drive registro a registro; gana el cambio más reciente.
- La app comparte dominio con otras apps de la misma cuenta de GitHub (Farma·Lab). Por eso el manifiesto lleva un `id` propio (`/ex-libris/`), el service worker solo toca cachés que empiezan por `exlibris-` y los datos locales usan nombres con prefijo `exlibris`. No borres los datos del sitio desde el navegador: afectaría a todas las apps del dominio.
- Para publicar una versión nueva de la app, cambia `VERSION` en `sw.js` para que los dispositivos descarguen los archivos nuevos.
- Lector de códigos de barras: [ZXing](https://github.com/zxing-js/library) (Apache 2.0), incluido en `vendor/`.
