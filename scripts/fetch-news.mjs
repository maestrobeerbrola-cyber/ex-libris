// Recoge novedades literarias de los feeds de feeds.json y actualiza news.json.
// Se ejecuta a diario desde GitHub Actions (Node 20, sin dependencias).
import fs from 'node:fs/promises';

const MAX_DIAS = 10, MAX_ITEMS = 150, MAX_POR_FUENTE = 12;
const cfg = JSON.parse(await fs.readFile('feeds.json', 'utf8'));
let prev = { items: [] };
try { prev = JSON.parse(await fs.readFile('news.json', 'utf8')); } catch {}

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LIBRO = /\b(libro|libros|novela|novelas|poesia|poemario|ensayo|editorial|editoriales|escritor|escritora|autor|autora|literari|lectura|lector|librer|cuentos?|relatos?|biografia|memorias|comic|novela grafica|traduccion|premio)/;
const MUSICA = /\b(music|musica|musico|rock|punk|jazz|flamenco|pop\b|banda|cantante|cantautor|disco|guitarr|concierto|rapero|trap|metal|reggaeton|beatles|bowie|dylan)/;
const PREMIO = /\bpremio|galardon|finalista|jurado/;
const NOVEDAD = /\b(publica|nueva novela|nuevo libro|llega a las librerias|lanza|presenta|novedad|sale a la venta|edita|reedita)/;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', iexcl: '¡', iquest: '¿', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = s => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = s => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return m ? m[1] : ''; };
const attr = (xml, name, a) => { const m = new RegExp(`<${name}[^>]*\\s${a}="([^"]*)"`, 'i').exec(xml); return m ? decode(m[1]) : ''; };
const corta = (s, n) => s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1) > n * 0.6 ? s.lastIndexOf(' ', n - 1) : n - 1) + '…';
const ymd = d => d.toISOString().slice(0, 10);

function parse(xml) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = strip(tag(b, 'link')) || attr(b, 'link', 'href');
    const fecha = strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    out.push({
      titulo: strip(tag(b, 'title')),
      url: link,
      fecha: fecha ? new Date(fecha) : null,
      desc: strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')),
      source: strip(tag(b, 'source')),
    });
  }
  return out;
}
function categoria(t, forced) {
  const c = clasifica(t);
  return c === 'Noticias' && forced ? forced : c;
}
function clasifica(t) {
  const n = norm(t);
  if (PREMIO.test(n)) return 'Premios';
  if (MUSICA.test(n) && LIBRO.test(n)) return 'Libros de música';
  if (NOVEDAD.test(n)) return 'Novedades editoriales';
  return 'Noticias';
}
async function get(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0 (ExLibris; lector de novedades personal)', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

const limite = Date.now() - MAX_DIAS * 864e5;
const nuevos = [], usadas = [];
for (const f of cfg.fuentes) {
  const url = f.rss || `https://news.google.com/rss/search?q=${encodeURIComponent(f.google + ' when:7d')}&hl=es&gl=ES&ceid=ES:es`;
  const nombre = f.nombre || 'Google Noticias';
  try {
    const items = parse(await get(url));
    let n = 0;
    for (const it of items) {
      if (!it.titulo || !/^https:\/\//.test(it.url)) continue;
      if (it.fecha && (isNaN(it.fecha) || it.fecha < limite)) continue;
      let titulo = it.titulo, fuente = nombre;
      if (f.google) { // «Titular - Medio»
        const i = titulo.lastIndexOf(' - ');
        fuente = it.source || (i > 0 ? titulo.slice(i + 3) : 'Google Noticias');
        if (i > 0) titulo = titulo.slice(0, i);
      }
      const texto = norm(titulo + ' ' + it.desc);
      if (f.filtro === 'libros' && !LIBRO.test(texto)) continue;
      if (f.filtro === 'musica' && !(MUSICA.test(texto) && LIBRO.test(texto))) continue;
      let resumen = f.google ? '' : corta(it.desc, 220);
      if (norm(resumen).startsWith(norm(titulo).slice(0, 40))) resumen = '';
      nuevos.push({ titulo: corta(titulo, 160), fuente: corta(fuente, 60), url: it.url, fecha: ymd(it.fecha && !isNaN(it.fecha) ? it.fecha : new Date()), categoria: categoria(titulo + ' ' + it.desc, f.categoria), resumen });
      if (++n >= MAX_POR_FUENTE) break;
    }
    console.log(`✓ ${nombre} (${f.rss ? 'rss' : 'google: ' + f.google}): ${n}`);
    if (n) usadas.push(fuente_unica(f, nombre));
  } catch (e) {
    console.log(`✗ ${nombre} (${f.rss || f.google}): ${e.message}`);
  }
}
function fuente_unica(f, nombre) { return f.rss ? nombre : 'Google Noticias'; }

const visto = new Set(), out = [];
for (const it of [...nuevos, ...(prev.items || [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))) {
  const k1 = it.url.replace(/[?#].*$/, ''), k2 = norm(it.titulo).replace(/[^a-z0-9]/g, '').slice(0, 70);
  if (visto.has(k1) || visto.has(k2)) continue;
  visto.add(k1); visto.add(k2); out.push(it);
  if (out.length >= MAX_ITEMS) break;
}
const data = { actualizado: new Date().toISOString(), fuentes: [...new Set(usadas)].length ? [...new Set(usadas)] : (prev.fuentes || []), items: out };
await fs.writeFile('news.json', JSON.stringify(data, null, 1) + '\n');
console.log(`news.json: ${out.length} noticias (${nuevos.length} recogidas hoy)`);
