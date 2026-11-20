/* Ex Libris · biblioteca personal
   Datos locales en IndexedDB, sincronización opcional con un archivo en tu Google Drive,
   fichas desde Google Books y Open Library, novedades desde news.json (GitHub Actions). */
'use strict';
{
const VERSION='1.4.3';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const coll=new Intl.Collator('es',{sensitivity:'base',numeric:true});
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=()=>ymd(new Date());
const parseD=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||'');return m?new Date(+m[1],m[2]-1,+m[3]):null};
const addDays=(s,n)=>{const d=parseD(s)||new Date();d.setDate(d.getDate()+n);return ymd(d)};
const fmtD=s=>{const d=parseD(s);return d?d.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'}).replace(/\./g,''):''};
const fmtDT=s=>{const d=new Date(s);return isNaN(d)?'':d.toLocaleString('es-ES',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})};
const ago=t=>{if(!t)return '';const m=Math.round((Date.now()-t)/6e4);if(m<1)return 'ahora mismo';if(m<60)return `hace ${m} min`;const h=Math.round(m/60);if(h<24)return `hace ${h} h`;return fmtDT(t)};
const diff=(a,b)=>Math.round((parseD(a)-parseD(b))/864e5);
const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const ic=n=>`<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const plural=(n,a,b)=>`${n} ${n===1?a:b}`;
const okImg=s=>typeof s==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(s);
const okUrl=s=>typeof s==='string'&&/^https:\/\//.test(s);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CFG=window.EXLIBRIS_CONFIG||{};

const GENEROS=['Novela','Relato','Poesía','Teatro','Ensayo','Biografía y memorias','Música','Historia','Filosofía','Ciencia','Arte y fotografía','Cómic y novela gráfica','Novela negra','Ciencia ficción y fantasía','Clásicos','Viajes','Infantil y juvenil','Otro'];
const FORMATOS=['Tapa dura','Tapa blanda','Rústica con solapas','Bolsillo','Edición especial','Otro'];
const SORTS=[['titulo','Título'],['autor','Autor'],['anio','Año de publicación'],['fechaAdq','Fecha de adquisición'],['valoracion','Valoración'],['editorial','Editorial'],['genero','Género'],['formato','Tipo de edición']];
const GROUPED=new Set(['genero','editorial','formato']);
const CLOTH=['#1e2b63','#7b2331','#2d5a4f','#a24d27','#3b3950','#6f5a1d','#1f4f6b','#5a2c5c','#26262b','#94352f','#4d5b2e','#6a4636'];
const SPINE=['#e8e6df','#c4492f','#6f86d6','#9a3346','#4f8a7b','#d7cfc0','#8a6fb3','#3b4260','#b9774a','#a6b4e8'];
const TABS=['biblioteca','prestamos','que-leo','novedades'];

/* ================= almacenamiento local ================= */
const KV={db:null,
  open(){return new Promise((res,rej)=>{try{const r=indexedDB.open('exlibris',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>{this.db=r.result;res()};r.onerror=()=>rej(r.error)}catch(e){rej(e)}})},
  get(k){if(!this.db){try{return Promise.resolve(JSON.parse(localStorage.getItem('exlibris-'+k)||'null'))}catch(e){return Promise.resolve(null)}}
    return new Promise((res,rej)=>{const q=this.db.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result??null);q.onerror=()=>rej(q.error)})},
  set(k,v){if(!this.db){try{localStorage.setItem('exlibris-'+k,JSON.stringify(v));return Promise.resolve()}catch(e){return Promise.reject(e)}}
    return new Promise((res,rej)=>{const t=this.db.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}};
let store={books:{},loans:{},meta:{rev:0}};
const S={books:[],loans:[],news:null,loaded:false,tab:'biblioteca',q:'',sort:'titulo',dir:1,view:'grid',fGen:'',fFmt:'',fLeido:'all',ltab:'prestado',rGen:'',rRcb:true,recK:null,nCat:''};
try{const p=JSON.parse(localStorage.getItem('exlibris-prefs')||'{}');for(const k of ['sort','dir','view','rRcb'])if(k in p)S[k]=p[k]}catch(e){}
if(!SORTS.some(s=>s[0]===S.sort))S.sort='titulo';
const savePrefs=()=>{try{localStorage.setItem('exlibris-prefs',JSON.stringify({sort:S.sort,dir:S.dir,view:S.view,rRcb:S.rRcb}))}catch(e){}};
function refresh(){S.books=Object.values(store.books).filter(r=>r&&!r.deleted);S.loans=Object.values(store.loans).filter(r=>r&&!r.deleted)}
let saveT;
function persist(){clearTimeout(saveT);saveT=setTimeout(()=>KV.set('state',store).catch(()=>toast('No se ha podido guardar en este dispositivo.')),120)}
function commit(){store.meta.rev=(store.meta.rev||0)+1;refresh();persist();render();Sync.schedule()}
function saveRec(c,rec){const r={...rec,id:rec.id||uid(),actualizado:Date.now()};delete r.deleted;store[c][r.id]=r;commit();return r}
function patchRec(c,id,p){const r=store[c][id];if(!r||r.deleted)return;store[c][id]={...r,...p,actualizado:Date.now()};commit()}
function delRec(c,id){store[c][id]={id,deleted:true,actualizado:Date.now()};commit()}
function mergeColl(a={},b={}){const out={...a};for(const [id,r] of Object.entries(b||{})){if(!r||typeof r!=='object')continue;const l=out[id];if(!l||(+r.actualizado||0)>(+l.actualizado||0))out[id]={...r,id}}return out}
function pruneTomb(c){const lim=Date.now()-180*864e5;let n=0;for(const [id,r] of Object.entries(c))if(r?.deleted&&(+r.actualizado||0)<lim){delete c[id];n++}return n}
function localNewer(loc,rem){for(const [id,r] of Object.entries(loc||{})){const o=rem?.[id];if(!o||(+r.actualizado||0)>(+o.actualizado||0))return true}return false}
function snapshot(){return {app:'exlibris',version:1,actualizado:new Date().toISOString(),books:store.books,loans:store.loans}}

/* ================= helpers de interfaz ================= */
let tt;
function toast(m,act){const t=$('#toast');t.innerHTML=`<span>${esc(m)}</span>`+(act?`<button type="button">${esc(act.label)}</button>`:'');if(act)t.querySelector('button').onclick=()=>{t.classList.remove('on');act.fn()};t.classList.add('on');clearTimeout(tt);if(!act?.keep)tt=setTimeout(()=>t.classList.remove('on'),act?6000:2600)}
function banner(m){const b=$('#banner');b.textContent=m||'';b.hidden=!m}
const clr=b=>CLOTH[hash((b.titulo||'')+'|'+(b.autor||''))%CLOTH.length];
function stars(v){v=Math.max(0,Math.min(5,Math.round(+v||0)));return v?`<span class="stars" aria-label="${v} de 5">${'★'.repeat(v)}<i>${'★'.repeat(5-v)}</i></span>`:''}
function activeLoans(t){return S.loans.filter(l=>l.tipo===t&&!l.devuelto&&!l.adquirido)}
function lentMap(){const m=new Map();for(const l of activeLoans('prestado'))if(l.bookId)m.set(l.bookId,l);return m}
function coverSrc(b){return okImg(b.portada)?b.portada:okUrl(b.portadaUrl)?b.portadaUrl:''}
function cover(b,cls='',lent){const src=coverSrc(b);
  return `<div class="cv ${cls}${src?' ph':''}" style="--c:${clr(b)}"><span class="ct">${esc(b.titulo||'Sin título')}</span><span class="ca">${esc(b.autor||'')}</span>${src?`<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('ph');this.remove()">`:''}${b.leido?`<span class="rd" title="Leído">${ic('check')}</span>`:''}${lent?'<span class="stamp">Prestado</span>':''}</div>`}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}

/* ================= ISBN y catálogos ================= */
const cleanIsbn=s=>String(s||'').toUpperCase().replace(/[^0-9X]/g,'');
function isbnOK(s){s=cleanIsbn(s);if(/^\d{13}$/.test(s)){let t=0;for(let i=0;i<12;i++)t+=(+s[i])*(i%2?3:1);return (10-t%10)%10===+s[12]}
  if(/^\d{9}[\dX]$/.test(s)){let t=0;for(let i=0;i<10;i++)t+=(s[i]==='X'?10:+s[i])*(10-i);return t%11===0}return false}
function to13(s){s=cleanIsbn(s);if(s.length!==10)return s;const b='978'+s.slice(0,9);let t=0;for(let i=0;i<12;i++)t+=(+b[i])*(i%2?3:1);return b+((10-t%10)%10)}
const bookland=s=>/^97[89]\d{10}$/.test(s)&&isbnOK(s);
function mapGenre(cats,title){const t=norm((cats||[]).join(' ')+' '+(title||''));
  const R=[[/science fiction|fantasy|ciencia ficcion|fantas/,'Ciencia ficción y fantasía'],[/mystery|crime|thriller|detective|policiac|negra/,'Novela negra'],[/comic|graphic novel|novela grafica|manga/,'Cómic y novela gráfica'],[/music|musica/,'Música'],[/biograph|biograf|memoir|memorias/,'Biografía y memorias'],[/poetry|poesia/,'Poesía'],[/drama|teatro/,'Teatro'],[/juvenile|young adult|infantil|juvenil|para ninos/,'Infantil y juvenil'],[/histor/,'Historia'],[/philosoph|filosof/,'Filosofía'],[/science|ciencia|nature|mathemat/,'Ciencia'],[/art\b|arte|photograph|fotograf|design/,'Arte y fotografía'],[/travel|viaje/,'Viajes'],[/literary criticism|essay|social science|political|ensayo|language arts/,'Ensayo'],[/short stories|relato|cuento/,'Relato'],[/fiction|novela|ficcion/,'Novela']];
  for(const [re,g] of R)if(re.test(t))return g;return ''}
async function getJSON(url,ms=8000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw new Error('http '+r.status);return await r.json()}finally{clearTimeout(t)}}
function gbRec(it){const v=it.volumeInfo||{};const ids=v.industryIdentifiers||[];let isbn=ids.find(x=>x.type==='ISBN_13')?.identifier||'';if(!isbn){const i10=ids.find(x=>x.type==='ISBN_10')?.identifier;if(i10)isbn=to13(i10)}
  const img=(v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'').replace(/^http:/,'https:').replace('&edge=curl','');
  return {titulo:[v.title,v.subtitle].filter(Boolean).join(': ').slice(0,300),autor:(v.authors||[]).join(', '),anio:parseInt(v.publishedDate)||null,editorial:v.publisher||'',isbn,genero:mapGenre(v.categories,v.title),portadaUrl:okUrl(img)?img:''}}
async function gbSearch(q,max=10){const j=await getJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${max}&printType=books`);return (j.items||[]).map(gbRec).filter(r=>r.titulo)}
async function olIsbn(isbn){const j=await getJSON(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);const d=j['ISBN:'+isbn];if(!d)return null;
  return {titulo:[d.title,d.subtitle].filter(Boolean).join(': '),autor:(d.authors||[]).map(a=>a.name).join(', '),anio:parseInt(String(d.publish_date||'').match(/\d{4}/)?.[0])||null,editorial:d.publishers?.[0]?.name||'',isbn,genero:mapGenre((d.subjects||[]).slice(0,6).map(s=>s.name),d.title),portadaUrl:d.cover?.medium||d.cover?.large||''}}
async function olSearch(q){const j=await getJSON(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=title,author_name,first_publish_year,publisher,isbn,cover_i`);
  return (j.docs||[]).map(d=>{const i13=(d.isbn||[]).find(x=>/^97[89]\d{10}$/.test(x))||'';return {titulo:d.title||'',autor:(d.author_name||[]).join(', '),anio:d.first_publish_year||null,editorial:d.publisher?.[0]||'',isbn:i13,genero:'',portadaUrl:d.cover_i?`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`:''}}).filter(r=>r.titulo)}
/* ---- Biblioteca Nacional de España (SRU del catálogo, sin clave y con CORS) ---- */
const BNE_SRU='https://catalogo.bne.es/view/sru/34BNE_INST';
const ORDS={primera:1,segunda:2,tercera:3,cuarta:4,quinta:5,sexta:6,septima:7,octava:8,novena:9,decima:10};
function edicionTxt(s){let t=String(s||'').replace(/\s+/g,' ').trim().replace(/[\s.,;:/]+$/,'');if(!t)return '';
  let m=norm(t).match(/^(primera|segunda|tercera|cuarta|quinta|sexta|septima|octava|novena|decima)\s+edicion\b\s*[:,.]?\s*(.*)$/);
  if(m){const rest=m[2]?t.slice(t.length-m[2].length):'';return `${ORDS[m[1]]}.ª`+(rest?` (${rest})`:'')}
  m=t.match(/^(\d+)\s*[ªa]?\.?\s*ed(?:\.|ición|icion)?\s*(.*)$/i);
  if(m){const rest=m[2].trim();return `${m[1]}.ª`+(rest?(rest.startsWith(',')?rest:' '+rest):'')}
  return t.slice(0,60)}
function formatoTxt(q,editorial,serie){const t=norm(q);
  if(/cartone|tapa dura|\benc\b|encuadernad|hardcover|\btela\b|piel/.test(t))return 'Tapa dura';
  if(/solapa/.test(t))return 'Rústica con solapas';
  if(/bolsillo/.test(t)||/debolsillo|bolsillo/.test(norm(editorial+' '+serie)))return 'Bolsillo';
  if(/rust|tapa blanda|paperback/.test(t))return 'Tapa blanda';
  return ''}
function cduGenero(cdus){for(const c of cdus){const s=String(c).replace(/\s/g,'');
    if(/^741\.5/.test(s))return 'Cómic y novela gráfica';
    if(/^8\d/.test(s)){const k=(s.match(/-(\d+)/)||[])[1]||'';
      if(k.startsWith('31'))return 'Novela';if(k.startsWith('32')||k.startsWith('34'))return 'Relato';if(k.startsWith('94')||k.startsWith('92'))return 'Biografía y memorias';
      if(k.startsWith('1'))return 'Poesía';if(k.startsWith('2'))return 'Teatro';if(k.startsWith('4'))return 'Ensayo'}
    if(/^929/.test(s))return 'Biografía y memorias';if(/^78/.test(s))return 'Música';if(/^91[0-9]/.test(s))return 'Viajes';
    if(/^9/.test(s))return 'Historia';if(/^1/.test(s))return 'Filosofía';if(/^[56]/.test(s))return 'Ciencia';if(/^7/.test(s))return 'Arte y fotografía'}
  return ''}
function marcRec(rec){
  const dfs=[...rec.getElementsByTagNameNS('*','datafield')];
  const df=tag=>dfs.filter(d=>d.getAttribute('tag')===tag);
  const sf=(d,code)=>[...d.getElementsByTagNameNS('*','subfield')].filter(s=>s.getAttribute('code')===code).map(s=>s.textContent.trim()).filter(Boolean);
  const first=(tags,code)=>{for(const tag of tags)for(const d of df(tag)){const v=sf(d,code)[0];if(v)return v}return ''};
  const clean=s=>String(s||'').replace(/\[|\]/g,'').replace(/\s+/g,' ').replace(/^[\s:;,/.=]+|[\s:;,/=]+$/g,'').replace(/\s+:/g,':').trim();
  const pub=df('264').find(d=>d.getAttribute('ind2')==='1')||df('264')[0]||df('260')[0];
  let titulo=clean(first(['245'],'a'));const sub=clean(first(['245'],'b'));if(sub&&titulo)titulo=`${titulo.replace(/[:.]$/,'')}: ${sub}`;
  let autor=first(['100','110'],'a').replace(/[,.]$/,'');const inv=autor.match(/^([^,]+),\s*(.+)$/);if(inv)autor=`${inv[2]} ${inv[1]}`;
  if(!autor)autor=clean(first(['245'],'c'));
  let editorial=pub?clean(sf(pub,'b')[0]||''):'';if(/^s\.\s?n\.?$/i.test(editorial))editorial='';
  if(editorial&&editorial===editorial.toUpperCase())editorial=editorial.toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
  const anio=parseInt(((pub?sf(pub,'c').join(' '):'').match(/\d{4}/)||[])[0])||null;
  const isbns=[],quals=[];for(const d of df('020')){for(const a of sf(d,'a')){const c=cleanIsbn(a.replace(/\(.*$/,''));if(c.length>=10)isbns.push(isbnOK(c)?to13(c):c);const q=a.match(/\(([^)]+)\)/);if(q)quals.push(q[1])}quals.push(...sf(d,'q'))}
  const otros=df('020').flatMap(d=>sf(d,'z')).map(z=>to13(cleanIsbn(z)));
  const serie=clean(first(['490','830'],'a'));
  const online=/recurso en l[ií]nea|online|electr[oó]nic/i.test(first(['300'],'a')+' '+first(['338','337'],'a'));
  const generos=df('655').flatMap(d=>sf(d,'a'));
  const genero=mapGenre(generos,'')||cduGenero(df('080').flatMap(d=>sf(d,'a')));
  return {titulo:titulo.slice(0,300),autor:autor.slice(0,200),anio,editorial,edicion:edicionTxt(first(['250'],'a')),formato:formatoTxt(quals.join(' '),editorial,serie),genero,isbn:isbns[0]||'',isbns,otros,online,serie,fuente:'BNE'}}
async function bneQuery(cql,max=10){const c=new AbortController();const t=setTimeout(()=>c.abort(),12000);
  try{const r=await fetch(`${BNE_SRU}?version=1.2&operation=searchRetrieve&recordSchema=marcxml&maximumRecords=${max}&query=${encodeURIComponent(cql)}`,{signal:c.signal});if(!r.ok)throw new Error('http '+r.status);
    const x=new DOMParser().parseFromString(await r.text(),'application/xml');
    return [...x.getElementsByTagNameNS('*','record')].filter(e=>/marc/i.test(e.namespaceURI||'')).map(marcRec).filter(r=>r.titulo)}finally{clearTimeout(t)}}
async function bneIsbn(isbn){const rs=await bneQuery(`alma.isbn=${isbn}`,5);if(!rs.length)return null;
  const isbn10=isbn.startsWith('978')?isbn.slice(3,12):'';
  const score=r=>(r.isbns.includes(isbn)?4:0)+(r.otros.includes(isbn)?1:0)+(r.online?-3:0)+(r.edicion?1:0);
  const best=rs.sort((a,b)=>score(b)-score(a))[0];return {...best,isbn}}
async function bneSearch(q){const esc=s=>s.replace(/["\\]/g,' ').trim();let rs=await bneQuery(`alma.title all "${esc(q)}"`,20);
  if(!rs.length)rs=await bneQuery(`alma.all_for_ui all "${esc(q)}"`,20);
  const rank=r=>(/^97[89]84|^84/.test(r.isbn)?3:0)+(r.isbn?2:0)+(r.online?-5:0);
  return rs.filter(r=>!r.online&&r.isbn).sort((a,b)=>rank(b)-rank(a)||(b.anio||0)-(a.anio||0)).slice(0,12)}
const settle=(p,ms)=>new Promise(res=>{const t=setTimeout(()=>res({status:'rejected',reason:'timeout'}),ms);p.then(v=>{clearTimeout(t);res({status:'fulfilled',value:v})},e=>{clearTimeout(t);res({status:'rejected',reason:e})})});
async function lookupIsbn(isbn){const pB=bneIsbn(isbn),pG=gbSearch('isbn:'+isbn,1),pO=olIsbn(isbn);
  const b=await settle(pB,12000);const B=b.status==='fulfilled'?b.value:null;
  // Con la ficha de la BNE solo esperamos un momento a Google/Open Library (portada); sin ella, lo que tarden
  const extra=B?2500:9000;const [g,o]=await Promise.all([settle(pG,extra),settle(pO,extra)]);
  const G=g.status==='fulfilled'?g.value[0]:null,O=o.status==='fulfilled'?o.value:null;
  if(!B&&!G&&!O){if([b,g,o].every(x=>x.status==='rejected'))throw new Error('net');return null}
  const pick=k=>(B&&B[k])||(G&&G[k])||(O&&O[k])||'';
  return {titulo:pick('titulo'),autor:pick('autor'),anio:pick('anio')||null,editorial:pick('editorial'),edicion:B?.edicion||'',formato:B?.formato||'',genero:pick('genero'),isbn,
    portadaUrl:(G&&G.portadaUrl)||(O&&O.portadaUrl)||`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`,fuente:B?'BNE':G?'Google Books':'Open Library'}}
async function searchCatalog(q){const pB=bneSearch(q),pG=gbSearch(q,10);
  const b=await settle(pB,12000);const B=b.status==='fulfilled'?b.value:[];
  const g=await settle(pG,B.length?2500:9000);const G=g.status==='fulfilled'?g.value.map(r=>({...r,fuente:'Google Books'})):[];
  const cov=new Map(G.filter(r=>r.portadaUrl&&r.isbn).map(r=>[r.isbn,r.portadaUrl]));
  let rs=B.map(r=>({...r,portadaUrl:cov.get(r.isbn)||`https://covers.openlibrary.org/b/isbn/${r.isbn}-S.jpg?default=false`}));const seen=new Set(rs.map(r=>r.isbn));
  for(const r of G){if(r.isbn&&seen.has(r.isbn))continue;if(r.isbn)seen.add(r.isbn);rs.push(r)}
  if(!rs.length){const o=await settle(olSearch(q),9000);if(o.status==='fulfilled')rs=o.value.map(r=>({...r,fuente:'Open Library'}));else if(b.status==='rejected'&&g.status==='rejected')throw new Error('net')}
  return rs.slice(0,20)}

/* ================= imágenes y escáner ================= */
function loadImg(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file);const im=new Image();im.onload=()=>res(im);im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('img'))};im.src=u})}
function scaled(im,max){const w=im.naturalWidth||im.videoWidth,h=im.naturalHeight||im.videoHeight;const r=Math.min(1,max/Math.max(w,h));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*r));c.height=Math.max(1,Math.round(h*r));c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c}
async function thumb(file){const im=await loadImg(file);return scaled(im,300).toDataURL('image/jpeg',.72)}
let zx=null;
function loadZX(){return zx||(zx=new Promise((res,rej)=>{if(window.ZXing)return res(window.ZXing);const s=document.createElement('script');s.src='vendor/zxing-0.21.3.min.js';s.onload=()=>window.ZXing?res(window.ZXing):rej(new Error('zx'));s.onerror=()=>{zx=null;rej(new Error('zx'))};document.head.appendChild(s)}))}
async function hasDetector(){try{return 'BarcodeDetector' in window&&(await BarcodeDetector.getSupportedFormats()).includes('ean_13')}catch(e){return false}}
function zxHints(Z){const h=new Map();h.set(Z.DecodeHintType.POSSIBLE_FORMATS,[Z.BarcodeFormat.EAN_13]);h.set(Z.DecodeHintType.TRY_HARDER,true);return h}
async function decodePhoto(file){const im=await loadImg(file);
  if(await hasDetector()){try{const det=new BarcodeDetector({formats:['ean_13']});for(const w of [1600,1000]){const r=await det.detect(scaled(im,w));const hit=r.map(x=>cleanIsbn(x.rawValue)).find(bookland);if(hit)return hit}}catch(e){}}
  const Z=await loadZX();const rd=new Z.BrowserMultiFormatReader(zxHints(Z));
  for(const w of [1400,900,2200]){try{const res=await rd.decodeFromImageUrl(scaled(im,w).toDataURL('image/jpeg',.92));const t=cleanIsbn(res.getText());if(bookland(t))return t}catch(e){}}
  return null}
const Scan={stream:null,reader:null,timer:0,on:false,multi:false,onCode:null,seen:new Map(),
  async open(onCode,multi=false){this.onCode=onCode;this.multi=multi;this.seen.clear();this.on=true;
    const el=$('#scan');el.hidden=false;document.body.classList.add('lock');$('#sclist').innerHTML='';$('#scdone').hidden=!multi;$('#sctorch').hidden=true;
    this.msg(multi?'Escanea los libros uno tras otro; los voy añadiendo a tu biblioteca':'Apunta al código de barras del libro');
    if(!navigator.mediaDevices?.getUserMedia){this.msg('Este navegador no deja usar la cámara en directo. Usa una foto.');return}
    try{this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false})}
    catch(e){this.msg(e?.name==='NotAllowedError'?'No tengo permiso para usar la cámara. Actívalo en el navegador o usa una foto.':'No he podido abrir la cámara. Usa una foto.');return}
    if(!this.on){this.stop();return}
    const v=$('#scv');const track=this.stream.getVideoTracks()[0];
    try{if(track.getCapabilities?.().torch)$('#sctorch').hidden=false}catch(e){}
    if(await hasDetector()){v.srcObject=this.stream;await v.play().catch(()=>{});const det=new BarcodeDetector({formats:['ean_13']});
      const loop=async()=>{if(!this.on)return;try{if(v.readyState>=2){const r=await det.detect(v);for(const x of r)this.hit(cleanIsbn(x.rawValue))}}catch(e){}this.timer=setTimeout(loop,140)};loop()}
    else{try{const Z=await loadZX();if(!this.on)return;this.reader=new Z.BrowserMultiFormatReader(zxHints(Z),250);this.reader.decodeFromStream(this.stream,v,(res)=>{if(res)this.hit(cleanIsbn(res.getText()))})}catch(e){this.msg('No he podido cargar el lector de códigos. Usa una foto.')}}},
  hit(code){if(!this.on||!bookland(code))return;const t=this.seen.get(code);if(t&&Date.now()-t<4000)return;this.seen.set(code,Date.now());
    try{navigator.vibrate?.(60)}catch(e){}
    if(!this.multi){this.close();this.onCode(code)}else this.onCode(code)},
  msg(t){$('#scmsg').textContent=t},
  item(html,cls=''){const d=document.createElement('div');d.className='scitem '+cls;d.innerHTML=html;$('#sclist').prepend(d);return d},
  stop(){clearTimeout(this.timer);try{this.reader?.reset()}catch(e){}this.reader=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;const v=$('#scv');v.srcObject=null},
  close(){this.on=false;this.stop();$('#scan').hidden=true;if($('#scrim').hidden)document.body.classList.remove('lock')}};
$('#scx').addEventListener('click',()=>Scan.close());
$('#scdone').addEventListener('click',()=>Scan.close());
$('#sctorch').addEventListener('click',async e=>{const tr=Scan.stream?.getVideoTracks()[0];if(!tr)return;const on=!e.currentTarget.classList.contains('on');try{await tr.applyConstraints({advanced:[{torch:on}]});e.currentTarget.classList.toggle('on',on)}catch(x){}});
$('#scfile').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;Scan.msg('Leyendo la foto…');let code=null;try{code=await decodePhoto(f)}catch(x){}
  if(code){Scan.msg(Scan.multi?'Escanea los libros uno tras otro; los voy añadiendo a tu biblioteca':'Código leído');Scan.hit(code)}else Scan.msg('No he podido leer el código en la foto. Prueba con más luz y el código centrado.')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#scan').hidden)Scan.close()});
async function quickAdd(code){const dup=S.books.find(b=>b.isbn===code);
  if(dup){Scan.item(`<div><b>${esc(dup.titulo)}</b><p>Ya está en tu biblioteca</p></div>`);return}
  const row=Scan.item(`<span class="spin"></span><div><b>${esc(code)}</b><p>Buscando en los catálogos…</p></div>`);
  let r=null;try{r=await lookupIsbn(code)}catch(e){}
  if(r&&r.titulo){const {fuente,...datos}=r;saveRec('books',{...datos,fechaAdq:today(),valoracion:0,leido:false,notas:'',portada:null,creado:Date.now()});
    row.innerHTML=`<div><b>${esc(r.titulo)}</b><p>${esc(r.autor||'Autor desconocido')}${r.anio?' · '+r.anio:''} · añadido</p></div>`}
  else{row.classList.add('miss');row.innerHTML=`<div><b>${esc(code)}</b><p>${r===null?'No aparece en los catálogos':'Sin conexión con los catálogos'}</p></div><button type="button" class="btn sm">A mano</button>`;
    row.querySelector('button').onclick=()=>{Scan.close();bookForm(null,{isbn:code})}}}
$('#scanmany').addEventListener('click',()=>Scan.open(quickAdd,true));
/* ================= foto de portada (cámara 2:3 y archivo, con encuadre) ================= */
const Cover={stream:null,src:null,iw:0,ih:0,s:1,min:1,x:0,y:0,W:0,H:0,onDone:null,from:'camera',ptrs:new Map(),pinch:null,
  el:k=>$('#cam'+k),
  mode(m){$('#cam').dataset.m=m;$('#camv').hidden=m!=='camera';$('#camf').hidden=m!=='camera';$('#crop').hidden=m!=='crop';$('#camrow1').hidden=m!=='camera';$('#camrow2').hidden=m!=='crop'},
  msg(t){$('#cammsg').textContent=t},
  show(onDone){this.onDone=onDone;$('#cam').hidden=false;document.body.classList.add('lock')},
  async camera(onDone){if(onDone)this.show(onDone);this.from='camera';this.mode('camera');$('#camtorch').hidden=true;$('#camshot').disabled=true;
    this.msg('Encaja la portada en el marco y pulsa el botón');
    if(!navigator.mediaDevices?.getUserMedia){this.msg('Este navegador no deja usar la cámara aquí. Sube una foto desde archivo.');return}
    try{this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false})}
    catch(e){this.msg(e?.name==='NotAllowedError'?'No tengo permiso para usar la cámara. Actívalo en el navegador o sube una foto desde archivo.':'No he podido abrir la cámara. Sube una foto desde archivo.');return}
    if($('#cam').hidden){this.stop();return}
    const v=$('#camv');v.srcObject=this.stream;await v.play().catch(()=>{});$('#camshot').disabled=false;
    try{if(this.stream.getVideoTracks()[0].getCapabilities?.().torch)$('#camtorch').hidden=false}catch(e){}},
  shoot(){const v=$('#camv');if(!v.videoWidth)return;const box=$('#cam').getBoundingClientRect(),fr=$('#camf').getBoundingClientRect();
    const k=Math.max(box.width/v.videoWidth,box.height/v.videoHeight),ox=(box.width-v.videoWidth*k)/2,oy=(box.height-v.videoHeight*k)/2;
    const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);
    try{navigator.vibrate?.(40)}catch(e){}
    this.stop();this.crop(c,{x:(fr.left-box.left-ox)/k,y:(fr.top-box.top-oy)/k,w:fr.width/k})},
  async fromFile(file,onDone){if(onDone)this.show(onDone);this.stop();this.from='file';
    try{const im=await loadImg(file);this.crop(scaled(im,2200),null)}catch(e){this.close();toast('No he podido abrir esa imagen.')}},
  crop(canvas,rect){this.mode('crop');this.msg('Arrastra y amplía para encuadrar la portada');
    const box=$('#cropbox');box.replaceChildren(canvas);canvas.className='cropimg';this.src=canvas;this.iw=canvas.width;this.ih=canvas.height;
    $('#camagain').hidden=this.from!=='camera';$('#camother').hidden=this.from==='camera';
    requestAnimationFrame(()=>{this.W=box.clientWidth;this.H=box.clientHeight;this.min=Math.max(this.W/this.iw,this.H/this.ih);
      if(rect&&rect.w>0){this.s=this.W/rect.w;this.x=-rect.x*this.s;this.y=-rect.y*this.s}else{this.s=this.min;this.x=(this.W-this.iw*this.s)/2;this.y=(this.H-this.ih*this.s)/2}
      this.clamp();this.render()})},
  clamp(){this.s=Math.min(Math.max(this.s,this.min),this.min*6);this.x=Math.min(0,Math.max(this.W-this.iw*this.s,this.x));this.y=Math.min(0,Math.max(this.H-this.ih*this.s,this.y))},
  render(){if(!this.src)return;this.src.style.transform=`translate(${this.x}px,${this.y}px) scale(${this.s})`;$('#camzoom').value=String(Math.round(this.s/this.min*100)/100)},
  zoomTo(ns,cx,cy){const px=(cx-this.x)/this.s,py=(cy-this.y)/this.s;this.s=Math.min(Math.max(ns,this.min),this.min*6);this.x=cx-px*this.s;this.y=cy-py*this.s;this.clamp();this.render()},
  use(){if(!this.src)return;const out=document.createElement('canvas');out.width=300;out.height=450;const g=out.getContext('2d');g.imageSmoothingQuality='high';
    g.drawImage(this.src,-this.x/this.s,-this.y/this.s,this.W/this.s,this.H/this.s,0,0,300,450);const url=out.toDataURL('image/jpeg',.76);const cb=this.onDone;this.close();cb&&cb(url)},
  stop(){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;const v=$('#camv');if(v)v.srcObject=null},
  close(){this.stop();$('#cam').hidden=true;this.src=null;$('#cropbox').replaceChildren();this.ptrs.clear();if($('#scrim').hidden&&$('#scan').hidden)document.body.classList.remove('lock')}};
{const box=$('#cropbox');const pt=(e)=>{const r=box.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}};
  box.addEventListener('pointerdown',e=>{box.setPointerCapture(e.pointerId);Cover.ptrs.set(e.pointerId,pt(e));Cover.pinch=null});
  box.addEventListener('pointermove',e=>{if(!Cover.ptrs.has(e.pointerId))return;const p=pt(e),prev=Cover.ptrs.get(e.pointerId);Cover.ptrs.set(e.pointerId,p);
    if(Cover.ptrs.size===1){Cover.x+=p.x-prev.x;Cover.y+=p.y-prev.y;Cover.clamp();Cover.render();return}
    const [a,b]=[...Cover.ptrs.values()];const d=Math.hypot(a.x-b.x,a.y-b.y),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    if(Cover.pinch)Cover.zoomTo(Cover.s*d/Cover.pinch,mid.x,mid.y);Cover.pinch=d});
  const up=e=>{Cover.ptrs.delete(e.pointerId);Cover.pinch=null};box.addEventListener('pointerup',up);box.addEventListener('pointercancel',up);
  box.addEventListener('wheel',e=>{e.preventDefault();const p=pt(e);Cover.zoomTo(Cover.s*Math.exp(-e.deltaY*0.0015),p.x,p.y)},{passive:false});
  $('#camzoom').addEventListener('input',e=>Cover.zoomTo(Cover.min*(+e.target.value||1),Cover.W/2,Cover.H/2));
  $('#camshot').addEventListener('click',()=>Cover.shoot());
  $('#camuse').addEventListener('click',()=>Cover.use());
  $('#camagain').addEventListener('click',()=>{Cover.src=null;$('#cropbox').replaceChildren();Cover.camera()});
  $('#camx').addEventListener('click',()=>Cover.close());
  for(const id of ['#camfile','#camfile2'])$(id).addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)Cover.fromFile(f)});
  $('#camtorch').addEventListener('click',async e=>{const tr=Cover.stream?.getVideoTracks()[0];if(!tr)return;const on=!e.currentTarget.classList.contains('on');try{await tr.applyConstraints({advanced:[{torch:on}]});e.currentTarget.classList.toggle('on',on)}catch(x){}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#cam').hidden){e.stopImmediatePropagation();Cover.close()}},true);
  addEventListener('resize',()=>{if(!$('#cam').hidden&&Cover.src){const b=$('#cropbox');const ow=Cover.W;Cover.W=b.clientWidth;Cover.H=b.clientHeight;if(ow){const f=Cover.W/ow;Cover.x*=f;Cover.y*=f;Cover.s*=f}Cover.min=Math.max(Cover.W/Cover.iw,Cover.H/Cover.ih);Cover.clamp();Cover.render()}})}


/* ================= hoja modal ================= */
let sheetBusy=false;
function openSheet(html,mount){const sc=$('#scrim'),sh=$('#sheet');sh.innerHTML=html;sh.scrollTop=0;sc.hidden=false;document.body.classList.add('lock');requestAnimationFrame(()=>sc.classList.add('on'));mount&&mount(sh)}
function closeSheet(force){if(sheetBusy&&!force)return;sheetBusy=false;const sc=$('#scrim');sc.classList.remove('on');sc.hidden=true;$('#sheet').innerHTML='';if($('#scan').hidden&&$('#cam').hidden)document.body.classList.remove('lock')}
$('#scrim').addEventListener('click',e=>{if(e.target.id==='scrim'||e.target.closest('[data-close]'))closeSheet()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#scrim').hidden&&$('#scan').hidden&&$('#cam').hidden)closeSheet()});
const head=t=>`<div class="sh-head"><h2>${esc(t)}</h2><button type="button" class="x" data-close aria-label="Cerrar">${ic('x')}</button></div>`;
function confirmFoot(foot,q,fn){const old=foot.innerHTML;foot.innerHTML=`<span style="font-weight:600">${esc(q)}</span><span class="sp"></span><button type="button" class="btn" data-no>Cancelar</button><button type="button" class="btn warn" data-yes>Eliminar</button>`;
  foot.querySelector('[data-no]').onclick=e=>{e.stopPropagation();foot.innerHTML=old};foot.querySelector('[data-yes]').onclick=e=>{e.stopPropagation();fn()}}

/* ================= cabecera ================= */
let spinesSig='';
function renderTop(){
  const n=S.books.length,por=S.books.filter(b=>!b.leido).length,pr=activeLoans('prestado').length,rc=activeLoans('recibido').length;
  $('#stats').textContent=!S.loaded?'Abriendo tu biblioteca…':n?`${plural(n,'libro','libros')} · ${por} por leer · ${plural(pr,'prestado','prestados')}${rc?` · ${rc} que te han dejado`:''}`:'Tu biblioteca, lista para empezar';
  const bs=S.books.slice().sort((a,b)=>(a.creado||0)-(b.creado||0)).slice(-150);const sig=bs.map(b=>b.id).join();
  if(sig===spinesSig&&$('#spines').childElementCount)return;spinesSig=sig;
  $('#spines').innerHTML=bs.map(b=>{const h=hash(b.id+b.titulo);return `<i style="--c:${SPINE[h%SPINE.length]};height:${28+h%24}px;width:${9+(h>>5)%9}px"></i>`}).join('')+Array.from({length:Math.max(0,90-bs.length)},(_,i)=>`<i class="ghost" style="height:${26+(i*7)%22}px;width:${10+(i*5)%8}px"></i>`).join('')}

/* ================= biblioteca ================= */
$('#sort').innerHTML=SORTS.map(([k,l])=>`<option value="${k}">${l}</option>`).join('');
$('#ffmt').innerHTML=`<option value="">Cualquier tipo de edición</option>`+FORMATOS.map(f=>`<option>${f}</option>`).join('');
function filtered(){
  const q=norm(S.q),qd=cleanIsbn(S.q);
  const arr=S.books.filter(b=>(!q||norm([b.titulo,b.autor,b.editorial,b.genero,b.isbn].join(' ')).includes(q)||(qd.length>3&&(b.isbn||'').includes(qd)))&&(!S.fGen||(b.genero||'')===S.fGen)&&(!S.fFmt||b.formato===S.fFmt)&&(S.fLeido==='all'||(S.fLeido==='si')===!!b.leido));
  const k=S.sort,d=S.dir;const val=b=>k==='anio'?(+b.anio||null):k==='valoracion'?(+b.valoracion||0):(b[k]||null);
  return arr.sort((a,b)=>{const va=val(a),vb=val(b);if(va===vb||va==null&&vb==null)return coll.compare(a.titulo||'',b.titulo||'');if(va==null)return 1;if(vb==null)return -1;return (typeof va==='number'?va-vb:coll.compare(String(va),String(vb)))*d})}
function card(b,lm){return `<button type="button" class="bk" data-id="${esc(b.id)}">${cover(b,'',lm.get(b.id))}<span class="bt">${esc(b.titulo||'Sin título')}</span><span class="ba">${esc(b.autor||'Autor desconocido')}${b.anio?' · '+esc(b.anio):''}</span>${stars(b.valoracion)}</button>`}
function rowL(b,lm){const l=lm.get(b.id);return `<tr data-id="${esc(b.id)}"><td class="cvc">${cover(b,'mini')}</td><td class="t">${esc(b.titulo||'Sin título')}</td><td>${esc(b.autor)}</td><td class="num">${esc(b.anio||'')}</td><td>${esc(b.editorial)}</td><td>${esc(b.formato)}</td><td>${stars(b.valoracion)}</td><td>${l?'<span class="tag red">Prestado</span>':b.leido?'<span class="tag">Leído</span>':'<span class="tag">Por leer</span>'}</td></tr>`}
const EMPTY_SVG=`<svg viewBox="0 0 260 120" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 104h240" stroke-width="5"/><rect x="40" y="40" width="22" height="64" rx="2"/><rect x="66" y="28" width="18" height="76" rx="2"/><path d="m92 104 34-58 16 9-34 58"/><path d="M48 52h6M71 40h8"/><rect x="190" y="54" width="20" height="50" rx="2" stroke-dasharray="5 5"/><rect x="214" y="46" width="16" height="58" rx="2" stroke-dasharray="5 5"/></svg>`;
function renderShelf(){
  $('#sort').value=S.sort;$('#dirtxt').textContent=S.sort==='anio'||S.sort==='fechaAdq'?(S.dir>0?'Antiguos':'Recientes'):S.sort==='valoracion'?(S.dir>0?'Menos':'Más'):(S.dir>0?'A–Z':'Z–A');
  $('#vgrid').setAttribute('aria-pressed',S.view==='grid');$('#vlist').setAttribute('aria-pressed',S.view==='list');
  const gens=[...new Set(S.books.map(b=>b.genero).filter(Boolean))].sort(coll.compare);
  $('#fgen').innerHTML=[['','Todos'],...gens.map(g=>[g,g])].map(([v,l])=>`<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${S.fGen===v}">${esc(l)}</button>`).join('');
  $('#ffmt').value=S.fFmt;$$('#fleido button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===S.fLeido));
  const nf=(S.fGen?1:0)+(S.fFmt?1:0)+(S.fLeido!=='all'?1:0);$('#fcount').textContent=nf?` (${nf})`:'';
  const el=$('#shelf');
  if(!S.loaded){$('#count').textContent='';el.innerHTML=`<div class="grid sk">${Array.from({length:12},()=>'<div class="bk"><div class="cv"></div></div>').join('')}</div>`;return}
  if(!S.books.length){$('#count').textContent='';el.innerHTML=`<div class="empty">${EMPTY_SVG}<h2>Tu estantería está vacía</h2><p>Escanea los códigos de barras de tus libros uno tras otro, busca por título o importa la hoja de cálculo donde ya los tuvieras.</p><div class="trow"><button type="button" class="btn pri" data-do="scan">${ic('barcode')}Escanear libros</button><button type="button" class="btn" data-do="add">${ic('plus')}Añadir a mano</button><button type="button" class="btn" data-do="settings">${ic('up')}Importar</button></div></div>`;return}
  const arr=filtered(),lm=lentMap();
  $('#count').textContent=arr.length===S.books.length?plural(arr.length,'libro','libros'):`${arr.length} de ${S.books.length} libros`;
  if(!arr.length){el.innerHTML=`<div class="empty"><h2>Ningún libro coincide</h2><p>Prueba con otra búsqueda o quita los filtros.</p><div class="trow"><button type="button" class="btn" data-do="clear">Quitar filtros</button></div></div>`;return}
  const groups=[];if(GROUPED.has(S.sort)){let cur=null;for(const b of arr){const g=b[S.sort]||'Sin indicar';if(!cur||cur.g!==g)groups.push(cur={g,items:[]});cur.items.push(b)}}else groups.push({g:null,items:arr});
  el.innerHTML=groups.map(({g,items})=>(g?`<h3 class="gh">${esc(g)}<span>${items.length}</span></h3>`:'')+(S.view==='grid'?`<div class="grid">${items.map(b=>card(b,lm)).join('')}</div>`:`<table class="lt stack"><thead><tr><th class="cvc"><span class="vh">Portada</span></th><th>Título</th><th>Autor</th><th class="num">Año</th><th>Editorial</th><th>Tipo de edición</th><th>Valoración</th><th>Estado</th></tr></thead><tbody>${items.map(b=>rowL(b,lm)).join('')}</tbody></table>`)).join('')}
$('#q').addEventListener('input',e=>{S.q=e.target.value;renderShelf()});
$('#sort').addEventListener('change',e=>{S.sort=e.target.value;S.dir=(S.sort==='valoracion'||S.sort==='fechaAdq')?-1:1;savePrefs();renderShelf()});
$('#dir').addEventListener('click',()=>{S.dir*=-1;savePrefs();renderShelf()});
$('#vgrid').addEventListener('click',()=>{S.view='grid';savePrefs();renderShelf()});
$('#vlist').addEventListener('click',()=>{S.view='list';savePrefs();renderShelf()});
$('#ftog').addEventListener('click',()=>{const f=$('#filters');f.hidden=!f.hidden;$('#ftog').setAttribute('aria-expanded',!f.hidden)});
$('#fgen').addEventListener('click',e=>{const c=e.target.closest('.chip');if(c){S.fGen=c.dataset.v;renderShelf()}});
$('#ffmt').addEventListener('change',e=>{S.fFmt=e.target.value;renderShelf()});
$('#fleido').addEventListener('click',e=>{const b=e.target.closest('button');if(b){S.fLeido=b.dataset.v;renderShelf()}});
const clearF=()=>{S.fGen='';S.fFmt='';S.fLeido='all';S.q='';$('#q').value='';renderShelf()};
$('#fclear').addEventListener('click',clearF);
$('#shelf').addEventListener('click',e=>{const d=e.target.closest('[data-do]');if(d){const a=d.dataset.do;if(a==='add')bookForm();else if(a==='scan')Scan.open(quickAdd,true);else if(a==='settings')settingsSheet();else clearF();return}const t=e.target.closest('[data-id]');if(t)openDetail(t.dataset.id)});
$('#addtop').addEventListener('click',()=>bookForm());

/* ================= ficha ================= */
function openDetail(id){
  const b=store.books[id];if(!b||b.deleted)return;const lent=lentMap().get(b.id);
  const row=(k,v)=>v?`<dt>${k}</dt><dd>${esc(v)}</dd>`:'';
  openSheet(head(b.titulo||'Sin título')+`<div class="det">${cover(b,'',lent)}<div>
    <p class="det-a">${esc(b.autor||'Autor desconocido')}</p>
    <dl class="meta">${row('Año',b.anio)}${row('Editorial',b.editorial)}${row('Edición',b.edicion)}${row('ISBN',b.isbn)}${row('Género',b.genero)}${row('Tipo',b.formato)}${row('Adquirido',fmtD(b.fechaAdq))}</dl>
    <span class="lbl">Tu valoración</span><div class="sin" id="dsin">${[1,2,3,4,5].map(v=>`<button type="button" data-v="${v}" class="${v<=(+b.valoracion||0)?'on':''}" aria-label="${v} de 5">★</button>`).join('')}</div>
    <label class="sw"><input type="checkbox" id="dleido" ${b.leido?'checked':''}> Leído</label>
    ${lent?`<p class="lentnote">Prestado a ${esc(lent.persona)} desde el ${fmtD(lent.fechaPrestamo)}</p>`:''}
    ${b.notas?`<p class="notes">${esc(b.notas)}</p>`:''}</div></div>
    <div class="sh-foot" id="dfoot"><button type="button" class="btn" data-a="del">Eliminar</button><span class="sp"></span>${lent?'':'<button type="button" class="btn" data-a="lend">Prestar</button>'}<button type="button" class="btn pri" data-a="edit">${ic('book')}Editar</button></div>`,sh=>{
    let rating=+b.valoracion||0;
    sh.querySelector('#dsin').addEventListener('click',e=>{const x=e.target.closest('button');if(!x)return;const v=+x.dataset.v;rating=v===rating?0:v;$$('#dsin button',sh).forEach(s=>s.classList.toggle('on',+s.dataset.v<=rating));patchRec('books',b.id,{valoracion:rating})});
    sh.querySelector('#dleido').addEventListener('change',e=>{patchRec('books',b.id,{leido:e.target.checked});toast(e.target.checked?'Marcado como leído':'Marcado como por leer')});
    sh.querySelector('#dfoot').addEventListener('click',e=>{const a=e.target.closest('[data-a]')?.dataset.a;if(!a)return;
      if(a==='edit')bookForm(store.books[b.id]);else if(a==='lend')loanForm(null,{tipo:'prestado',bookId:b.id});
      else if(a==='del')confirmFoot(sh.querySelector('#dfoot'),`¿Eliminar «${b.titulo}»?`,()=>{delRec('books',b.id);closeSheet(true);toast('Libro eliminado',{label:'Deshacer',fn:()=>saveRec('books',b)})})})})}

/* ================= formulario de libro ================= */
function bookForm(b,preset={}){
  const e=b||{...preset},isNew=!b,manual=new Set();
  if(!isNew)for(const k of ['titulo','autor','anio','editorial','edicion','genero','isbn','formato'])if(e[k])manual.add(k);
  let portada=okImg(e.portada)?e.portada:null,portadaUrl=okUrl(e.portadaUrl)?e.portadaUrl:'',rating=+e.valoracion||0,warned='';
  const opts=arr=>arr.map(v=>`<option value="${esc(v)}">`).join('');
  const uniq=k=>[...new Set(S.books.map(x=>x[k]).filter(Boolean))].sort(coll.compare);
  openSheet(head(isNew?'Añadir libro':'Editar libro')+`<form id="bf" novalidate>
   <div class="auto">
     <p class="auto-h">Rellenar automáticamente</p>
     <div class="arow"><button type="button" class="btn" id="bscan">${ic('barcode')}Escanear código de barras</button></div>
     <div class="irow"><label class="f"><span>ISBN, título o autor</span><input id="fq" autocomplete="off" enterkeyhint="search" placeholder="978… o «Rayuela Cortázar»"></label><button type="button" class="btn" id="bq">${ic('search')}Buscar</button></div>
     <div class="res" id="fres"></div>
     <p class="amsg" id="amsg" aria-live="polite"></p>
   </div>
   <div class="fg">
     <label class="f full"><span>Título *</span><input data-k="titulo" value="${esc(e.titulo)}" autocomplete="off"></label>
     <label class="f full"><span>Autor</span><input data-k="autor" value="${esc(e.autor)}" list="dla" autocomplete="off"></label>
     <label class="f"><span>Año de publicación</span><input data-k="anio" inputmode="numeric" maxlength="4" value="${esc(e.anio??'')}"></label>
     <label class="f"><span>Número de edición</span><input data-k="edicion" placeholder="1.ª" value="${esc(e.edicion)}"></label>
     <label class="f"><span>Editorial</span><input data-k="editorial" value="${esc(e.editorial)}" list="dle" autocomplete="off"></label>
     <label class="f"><span>ISBN</span><input data-k="isbn" inputmode="numeric" autocomplete="off" value="${esc(e.isbn)}"></label>
     <label class="f"><span>Género</span><input data-k="genero" value="${esc(e.genero)}" list="dlg" autocomplete="off"></label>
     <label class="f"><span>Fecha de adquisición</span><input type="date" data-k="fechaAdq" value="${esc(e.fechaAdq??(isNew?today():''))}"></label>
     <div class="f full"><span>Tipo de edición</span><div class="opts">${FORMATOS.map(f=>`<label class="opt"><input type="radio" name="formato" data-k="formato" value="${f}" ${e.formato===f?'checked':''}><span>${f}</span></label>`).join('')}</div></div>
     <div class="f"><span>Valoración personal</span><div class="sin" id="fsin">${[1,2,3,4,5].map(v=>`<button type="button" data-v="${v}" aria-label="${v} de 5">★</button>`).join('')}</div></div>
     <div class="f"><span>Estado</span><label class="sw"><input type="checkbox" id="fleidoc" ${e.leido?'checked':''}> Leído</label></div>
     <div class="f full"><span>Portada</span><div class="pc" id="pc"></div></div>
     <label class="f full"><span>Notas</span><textarea data-k="notas" placeholder="Dedicatoria, de quién fue, dónde lo compraste…">${esc(e.notas)}</textarea></label>
   </div>
   <datalist id="dla">${opts(uniq('autor'))}</datalist><datalist id="dle">${opts(uniq('editorial'))}</datalist><datalist id="dlg">${opts([...new Set([...GENEROS,...uniq('genero')])])}</datalist>
   <p class="err" id="ferr"></p>
   <div class="sh-foot" id="ffoot">${isNew?'':'<button type="button" class="btn" data-a="del">Eliminar</button>'}<span class="sp"></span><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn pri" id="bsave">Guardar</button></div>
  </form>`,sh=>{
    const F=k=>sh.querySelector(`[data-k="${k}"]`),V=k=>(F(k)?.value||'').trim();
    const drawStars=()=>$$('#fsin button',sh).forEach(s=>s.classList.toggle('on',+s.dataset.v<=rating));drawStars();
    sh.querySelector('#fsin').addEventListener('click',ev=>{const x=ev.target.closest('button');if(!x)return;const v=+x.dataset.v;rating=v===rating?0:v;drawStars()});
    const drawPc=()=>{const pc=sh.querySelector('#pc');const src=portada||portadaUrl;
      pc.innerHTML=(src?`<div class="cv ph" style="--c:#3b4260"><img src="${esc(src)}" alt="Portada" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('ph');this.remove()"></div>`:'')+`<button type="button" class="btn sm" id="incam">${ic('camera')}${portada?'Repetir foto':'Hacer foto'}</button><label class="btn sm">${ic('up')}Subir archivo<input type="file" accept="image/*" class="vh" id="incv"></label>`+(src?'<button type="button" class="btn sm" id="rmcv">Quitar</button>':'');
      const done=url=>{portada=url;drawPc()};
      pc.querySelector('#incam').addEventListener('click',()=>Cover.camera(done));
      pc.querySelector('#incv').addEventListener('change',ev=>{const f=ev.target.files[0];ev.target.value='';if(f)Cover.fromFile(f,done)});
      pc.querySelector('#rmcv')?.addEventListener('click',()=>{portada=null;portadaUrl='';drawPc()})};drawPc();
    sh.addEventListener('input',ev=>{const k=ev.target.dataset?.k;if(k)manual.add(k)});
    const amsg=(t,busy)=>{sh.querySelector('#amsg').innerHTML=(busy?'<span class="spin"></span>':'')+esc(t)};
    const fill=r=>{let n=0;if(!r)return 0;
      for(const k of ['titulo','autor','anio','editorial','edicion','genero','isbn']){const v=r[k];if(v==null||v===''||manual.has(k))continue;F(k).value=String(v).slice(0,300);n++}
      if(r.formato&&FORMATOS.includes(r.formato)&&!manual.has('formato')){const o=sh.querySelector(`[name=formato][value="${r.formato}"]`);if(o){o.checked=true;n++}}
      if(r.portadaUrl&&!portada){portadaUrl=r.portadaUrl;drawPc()}return n};
    async function byIsbn(code){
      if(!isbnOK(code))return amsg('Ese ISBN no cuadra: el último dígito de control no coincide. Revísalo.');
      code=to13(code);const dup=S.books.find(x=>x.id!==e.id&&x.isbn===code);
      amsg('Buscando en la Biblioteca Nacional, Google Books y Open Library…',true);
      try{const r=await lookupIsbn(code);
        if(!r){if(!manual.has('isbn'))F('isbn').value=code;amsg('Este ISBN no aparece en los catálogos gratuitos. Rellena los datos a mano (el ISBN ya está puesto).');return}
        const n=fill(r);const src=r.fuente==='BNE'?'la Biblioteca Nacional de España':r.fuente;const falta=[!r.edicion&&'el número de edición',!r.formato&&'el tipo de edición'].filter(Boolean);
        amsg((dup?`Ojo: ya tienes este ISBN («${dup.titulo}»). `:'')+`He rellenado ${plural(n,'campo','campos')} con los datos de ${src}.`+(falta.length?` Revisa ${falta.join(' y ')}, que el catálogo no indica.`:''))}
      catch(x){amsg('No hay conexión con los catálogos. Puedes rellenarlo a mano y guardarlo igualmente.')}}
    async function byText(q){amsg('Buscando…',true);sh.querySelector('#fres').innerHTML='';
      try{const rs=await searchCatalog(q);if(!rs.length){amsg('No he encontrado nada con esa búsqueda.');return}
        amsg(`${plural(rs.length,'resultado','resultados')}. Toca tu edición (mira la editorial, el año y el ISBN) para rellenar la ficha.`);
        sh.querySelector('#fres').innerHTML=rs.map((r,i)=>`<button type="button" class="ri" data-i="${i}">${cover(r)}<span><b>${esc(r.titulo)}</b><span>${esc([r.autor,r.editorial,r.anio,r.edicion&&'ed. '+r.edicion].filter(Boolean).join(' · '))}</span><span class="rs">${esc([r.isbn&&'ISBN '+r.isbn,r.fuente==='BNE'?'Biblioteca Nacional':r.fuente].filter(Boolean).join(' · '))}</span></span></button>`).join('');
        sh.querySelector('#fres').onclick=ev=>{const x=ev.target.closest('.ri');if(!x)return;const r=rs[+x.dataset.i];sh.querySelector('#fres').innerHTML='';const n=fill(r);amsg(`He rellenado ${plural(n,'campo','campos')}. Revisa que la edición coincida con tu ejemplar.`)}}
      catch(x){amsg('No hay conexión con los catálogos. Puedes rellenarlo a mano.')}}
    const go=()=>{const q=sh.querySelector('#fq').value.trim();if(!q)return amsg('Escribe un ISBN, un título o un autor.');const c=cleanIsbn(q);if(/^(\d{13}|\d{9}[\dX])$/.test(c))byIsbn(c);else byText(q)};
    sh.querySelector('#bq').addEventListener('click',go);
    sh.querySelector('#fq').addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();go()}});
    sh.querySelector('#bscan').addEventListener('click',()=>Scan.open(code=>{sh.querySelector('#fq').value=code;manual.delete('isbn');byIsbn(code)}));
    sh.querySelector('#ffoot').addEventListener('click',ev=>{if(ev.target.closest('[data-a="del"]'))confirmFoot(sh.querySelector('#ffoot'),'¿Eliminar este libro?',()=>{const old=store.books[e.id];delRec('books',e.id);closeSheet(true);toast('Libro eliminado',{label:'Deshacer',fn:()=>saveRec('books',old)})})});
    sh.querySelector('#bf').addEventListener('submit',ev=>{ev.preventDefault();const err=sh.querySelector('#ferr');err.textContent='';
      const titulo=V('titulo');if(!titulo){err.textContent='Falta el título.';F('titulo').focus();return}
      let isbn=cleanIsbn(V('isbn'));if(isbn&&isbnOK(isbn))isbn=to13(isbn);
      if(isbn&&!isbnOK(isbn)&&warned!=='isbn'){warned='isbn';err.textContent='El ISBN no parece correcto. Pulsa Guardar otra vez si quieres dejarlo así.';return}
      const dup=isbn&&S.books.find(x=>x.id!==e.id&&x.isbn===isbn);
      if(dup&&warned!=='dup'){warned='dup';err.textContent=`Ya tienes este ISBN («${dup.titulo}»). Pulsa Guardar otra vez para añadir otro ejemplar.`;return}
      const anio=parseInt(V('anio'));
      saveRec('books',{...(isNew?{}:store.books[e.id]),id:isNew?undefined:e.id,titulo,autor:V('autor'),anio:anio>0?anio:null,editorial:V('editorial'),edicion:V('edicion'),isbn,genero:V('genero'),fechaAdq:V('fechaAdq'),valoracion:rating,formato:sh.querySelector('[name=formato]:checked')?.value||'',leido:sh.querySelector('#fleidoc').checked,notas:V('notas'),portada:portada||null,portadaUrl:portada?'':portadaUrl,creado:e.creado||Date.now()});
      closeSheet(true);toast(isNew?'Libro añadido a tu biblioteca':'Cambios guardados')});
    if(isNew&&preset.isbn){sh.querySelector('#fq').value=preset.isbn;byIsbn(preset.isbn)}
    else if(isNew&&matchMedia('(pointer:fine)').matches)sh.querySelector('#fq').focus()})}

/* ================= préstamos ================= */
const cerrado=l=>!!(l.devuelto||l.adquirido);
function loanStatus(l){if(l.adquirido)return ['',`En tu colección desde el ${fmtD(l.adquirido)}`];if(l.devuelto)return ['',`Devuelto el ${fmtD(l.devuelto)}`];if(!l.fechaDevolucion)return ['','Sin fecha de devolución'];const d=diff(l.fechaDevolucion,today());
  if(d<0)return ['late',`Retrasado ${plural(-d,'día','días')}`];if(d===0)return ['soon','Vence hoy'];if(d<=7)return ['soon',`Vence en ${plural(d,'día','días')}`];return ['',`Quedan ${d} días`]}
const loanBook=l=>l.tipo==='prestado'&&l.bookId&&store.books[l.bookId]&&!store.books[l.bookId].deleted?store.books[l.bookId]:l;
function renderLoans(){
  $$('#ltab button').forEach(b=>{const n=activeLoans(b.dataset.v).length;b.setAttribute('aria-pressed',b.dataset.v===S.ltab);b.textContent=(b.dataset.v==='prestado'?'Los que presto':'Los que me prestan')+(n?` (${n})`:'')});
  const el=$('#loans');if(!S.loaded){el.innerHTML='<p class="count">Cargando…</p>';return}
  const all=S.loans.filter(l=>l.tipo===S.ltab),act=all.filter(l=>!cerrado(l)).sort((a,b)=>(a.fechaDevolucion||'9999').localeCompare(b.fechaDevolucion||'9999')),hist=all.filter(cerrado).sort((a,b)=>String(b.devuelto||b.adquirido).localeCompare(String(a.devuelto||a.adquirido)));
  const yo=S.ltab==='prestado';
  const cards=act.map(l=>{const[c,t]=loanStatus(l);const bk=loanBook(l);const meta=[bk.editorial,bk.anio,bk.edicion&&'ed. '+bk.edicion].filter(Boolean).map(esc).join(' · ');
    return `<article class="loan ${c==='late'?'late':''}"><div class="lh">${cover(bk,'mini')}<div><h3>${esc(l.titulo)}</h3>${l.autor?`<p class="la">${esc(l.autor)}</p>`:''}${meta?`<p class="lm">${meta}</p>`:''}</div></div>
    <p class="lp">${yo?'Lo tiene':'Me lo dejó'} <b>${esc(l.persona)}</b></p>
    <dl class="ld"><div><dt>Prestado</dt><dd>${fmtD(l.fechaPrestamo)||'—'}</dd></div><div><dt>Devolución</dt><dd>${fmtD(l.fechaDevolucion)||'—'}</dd></div></dl>
    ${l.notas?`<p class="la">${esc(l.notas)}</p>`:''}
    <div class="lst"><span class="pill ${c}">${t}</span></div>
    <div class="lf"><button type="button" class="btn sm" data-ed="${esc(l.id)}">Editar</button>${yo?'':`<button type="button" class="btn sm" data-own="${esc(l.id)}">${ic('book')}Añadir a mi colección</button>`}<button type="button" class="btn sm pri" data-ret="${esc(l.id)}">${ic('check')}Devuelto</button></div></article>`}).join('');
  el.innerHTML=(act.length?`<div class="lgrid">${cards}</div>`:`<div class="empty"><h2>${yo?'No tienes libros prestados':'Nadie te ha dejado libros ahora mismo'}</h2><p>${yo?'Cuando prestes uno, apúntalo aquí con la fecha y te avisaré si se retrasa la devolución.':'Añade un préstamo nuevo y escanea el código de barras del libro: se crea su ficha aquí, sin añadirlo a tu colección, y te recuerda cuándo devolverlo.'}</p></div>`)
   +(hist.length?`<details class="hist"><summary>Historial (${hist.length})</summary>${hist.map(l=>`<div class="hrow">${cover(loanBook(l),'mini')}<div><b>${esc(l.titulo)}</b><p>${yo?'A':'De'} ${esc(l.persona)} · ${fmtD(l.fechaPrestamo)} → ${l.adquirido?'pasó a tu colección el '+fmtD(l.adquirido):'devuelto el '+fmtD(l.devuelto)}</p></div><button type="button" class="btn sm" data-ed="${esc(l.id)}">Editar</button></div>`).join('')}</details>`:'')}
$('#ltab').addEventListener('click',e=>{const b=e.target.closest('button');if(b){S.ltab=b.dataset.v;renderLoans()}});
$('#addloan').addEventListener('click',()=>loanForm());
function makeOwn(id){const l=store.loans[id];if(!l||l.deleted)return;
  const dup=l.isbn&&S.books.find(b=>b.isbn===l.isbn);
  if(dup){patchRec('loans',id,{adquirido:today(),bookId:dup.id});toast(`Ya tenías «${dup.titulo}» en tu colección; el préstamo queda cerrado`);return}
  const nota=`Me lo dejó ${l.persona}${l.fechaPrestamo?' el '+fmtD(l.fechaPrestamo):''} y se quedó en mi biblioteca.`;
  const b=saveRec('books',{titulo:l.titulo,autor:l.autor||'',anio:l.anio||null,editorial:l.editorial||'',edicion:l.edicion||'',isbn:l.isbn||'',genero:l.genero||'',formato:l.formato||'',portada:okImg(l.portada)?l.portada:null,portadaUrl:okUrl(l.portadaUrl)?l.portadaUrl:'',fechaAdq:today(),valoracion:0,leido:!!l.leido,notas:[l.notas,nota].filter(Boolean).join('\n'),creado:Date.now()});
  patchRec('loans',id,{adquirido:today(),bookId:b.id});
  toast(`«${l.titulo}» pasa a tu colección`,{label:'Deshacer',fn:()=>{delRec('books',b.id);patchRec('loans',id,{adquirido:null,bookId:null})}})}
$('#loans').addEventListener('click',e=>{const r=e.target.closest('[data-ret]'),ed=e.target.closest('[data-ed]'),own=e.target.closest('[data-own]');
  if(ed)return loanForm(store.loans[ed.dataset.ed]);
  if(own)return makeOwn(own.dataset.own);
  if(r){const id=r.dataset.ret;patchRec('loans',id,{devuelto:today()});toast('Marcado como devuelto',{label:'Deshacer',fn:()=>patchRec('loans',id,{devuelto:null})})}});
function loanForm(l,preset={}){
  const e=l?{...l}:{...(preset.ficha||{})},isNew=!l;let tipo=e.tipo||preset.tipo||S.ltab;
  const label=b=>`${b.titulo}${b.autor?' — '+b.autor:''}`;const bk=S.books.find(b=>b.id===(e.bookId||preset.bookId));
  const people=[...new Set(S.loans.map(x=>x.persona).filter(Boolean))].sort(coll.compare);
  const manual=new Set();if(!isNew)for(const k of ['titulo','autor','anio','editorial','edicion','genero','isbn','formato'])if(e[k])manual.add(k);
  let portada=okImg(e.portada)?e.portada:null,portadaUrl=okUrl(e.portadaUrl)?e.portadaUrl:'';
  const uniq=k=>[...new Set(S.books.map(x=>x[k]).filter(Boolean))].sort(coll.compare);
  openSheet(head(isNew?'Nuevo préstamo':'Editar préstamo')+`<form id="lf" novalidate>
   <div class="opts" role="radiogroup" aria-label="Tipo" style="margin-bottom:16px"><label class="opt"><input type="radio" name="tipo" value="prestado" ${tipo==='prestado'?'checked':''}><span>Yo lo presto</span></label><label class="opt"><input type="radio" name="tipo" value="recibido" ${tipo==='recibido'?'checked':''}><span>Me lo prestan</span></label></div>
   <div class="auto" id="lauto">
     <p class="auto-h">Ficha del libro prestado</p>
     <p class="note-s">Se guarda solo en Préstamos, sin añadirlo a tu colección.</p>
     <div class="arow"><button type="button" class="btn pri" id="lscan">${ic('barcode')}Escanear código de barras</button></div>
     <div class="irow"><label class="f"><span>ISBN, título o autor</span><input id="lq" autocomplete="off" enterkeyhint="search"></label><button type="button" class="btn" id="lbq">${ic('search')}Buscar</button></div>
     <div class="res" id="lres"></div>
     <p class="amsg" id="lmsg" aria-live="polite"></p>
   </div>
   <div class="fg">
    <label class="f full"><span>Libro *</span><input id="llib" data-k="titulo" list="dlb" autocomplete="off" value="${esc(bk?label(bk):(e.titulo||''))}"></label>
    <label class="f full"><span>Autor</span><input id="laut" data-k="autor" value="${esc(bk?bk.autor:(e.autor||''))}"></label>
    <div id="lextra" class="sub">
      <label class="f"><span>Editorial</span><input data-k="editorial" list="dle2" value="${esc(e.editorial)}" autocomplete="off"></label>
      <label class="f"><span>Año de publicación</span><input data-k="anio" inputmode="numeric" maxlength="4" value="${esc(e.anio??'')}"></label>
      <label class="f"><span>Número de edición</span><input data-k="edicion" value="${esc(e.edicion)}"></label>
      <label class="f"><span>ISBN</span><input data-k="isbn" inputmode="numeric" value="${esc(e.isbn)}"></label>
      <label class="f full"><span>Género</span><input data-k="genero" list="dlg2" value="${esc(e.genero)}" autocomplete="off"></label>
      <div class="f full"><span>Tipo de edición</span><div class="opts">${FORMATOS.map(f=>`<label class="opt"><input type="radio" name="lformato" data-k="formato" value="${f}" ${e.formato===f?'checked':''}><span>${f}</span></label>`).join('')}</div></div>
      <div class="f full"><span>Portada</span><div class="pc" id="lpc"></div></div>
    </div>
    <label class="f full"><span id="lperl"></span><input id="lper" list="dlp" autocomplete="off" value="${esc(e.persona)}"></label>
    <label class="f"><span>Fecha de préstamo</span><input type="date" id="lfp" value="${esc(e.fechaPrestamo||today())}"></label>
    <label class="f"><span>Devolución prevista</span><input type="date" id="lfd" value="${esc(isNew?addDays(today(),30):(e.fechaDevolucion||''))}"></label>
    ${e.devuelto?`<label class="f"><span>Devuelto el</span><input type="date" id="ldv" value="${esc(e.devuelto)}"></label>`:''}
    <label class="f full"><span>Notas</span><textarea id="lnot">${esc(e.notas)}</textarea></label>
   </div>
   <datalist id="dlb">${S.books.map(b=>`<option value="${esc(label(b))}">`).join('')}</datalist><datalist id="dlp">${people.map(p=>`<option value="${esc(p)}">`).join('')}</datalist>
   <datalist id="dle2">${uniq('editorial').map(v=>`<option value="${esc(v)}">`).join('')}</datalist><datalist id="dlg2">${[...new Set([...GENEROS,...uniq('genero')])].map(v=>`<option value="${esc(v)}">`).join('')}</datalist>
   <p class="err" id="lerr"></p>
   <div class="sh-foot" id="lfoot">${isNew?'':'<button type="button" class="btn" data-a="del">Eliminar</button>'}${!isNew&&e.tipo==='recibido'&&!cerrado(e)?`<button type="button" class="btn" data-a="own">${ic('book')}Añadir a mi colección</button>`:''}<span class="sp"></span><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn pri">Guardar</button></div></form>`,sh=>{
    const F=k=>sh.querySelector(`#lf [data-k="${k}"]`),V=k=>(F(k)?.value||'').trim();
    const sync=()=>{tipo=sh.querySelector('[name=tipo]:checked').value;const rec=tipo==='recibido';sh.querySelector('#lperl').textContent=rec?'¿Quién te lo presta? *':'¿A quién se lo prestas? *';sh.querySelector('#llib').placeholder=rec?'Título del libro':'Busca en tu biblioteca';
      sh.querySelector('#llib').setAttribute('list',rec?'':'dlb');sh.querySelector('#lauto').hidden=!rec;sh.querySelector('#lextra').hidden=!rec};sync();
    sh.querySelectorAll('[name=tipo]').forEach(r=>r.addEventListener('change',sync));
    sh.querySelector('#llib').addEventListener('change',ev=>{if(tipo!=='prestado')return;const m=S.books.find(b=>label(b)===ev.target.value);if(m)sh.querySelector('#laut').value=m.autor||''});
    sh.addEventListener('input',ev=>{const k=ev.target.dataset?.k;if(k)manual.add(k)});
    const drawPc=()=>{const pc=sh.querySelector('#lpc');const src=portada||portadaUrl;
      pc.innerHTML=(src?`<div class="cv ph" style="--c:#3b4260"><img src="${esc(src)}" alt="Portada" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('ph');this.remove()"></div>`:'')+`<button type="button" class="btn sm" id="lcam">${ic('camera')}Hacer foto</button><label class="btn sm">${ic('up')}Subir archivo<input type="file" accept="image/*" class="vh" id="lfile"></label>`+(src?'<button type="button" class="btn sm" id="lrm">Quitar</button>':'');
      const done=url=>{portada=url;drawPc()};pc.querySelector('#lcam').addEventListener('click',()=>Cover.camera(done));
      pc.querySelector('#lfile').addEventListener('change',ev=>{const f=ev.target.files[0];ev.target.value='';if(f)Cover.fromFile(f,done)});
      pc.querySelector('#lrm')?.addEventListener('click',()=>{portada=null;portadaUrl='';drawPc()})};drawPc();
    const msg=(t,busy)=>{sh.querySelector('#lmsg').innerHTML=(busy?'<span class="spin"></span>':'')+esc(t)};
    const fill=r=>{let n=0;if(!r)return 0;for(const k of ['titulo','autor','anio','editorial','edicion','genero','isbn']){const v=r[k];if(v==null||v===''||manual.has(k))continue;F(k).value=String(v).slice(0,300);n++}
      if(r.formato&&FORMATOS.includes(r.formato)&&!manual.has('formato')){const o=sh.querySelector(`[name=lformato][value="${r.formato}"]`);if(o){o.checked=true;n++}}
      if(r.portadaUrl&&!portada){portadaUrl=r.portadaUrl;drawPc()}return n};
    async function byIsbn(code){if(!isbnOK(code))return msg('Ese ISBN no cuadra: revisa los dígitos.');code=to13(code);msg('Buscando en la Biblioteca Nacional, Google Books y Open Library…',true);
      try{const r=await lookupIsbn(code);if(!r){if(!manual.has('isbn'))F('isbn').value=code;return msg('Este ISBN no aparece en los catálogos; completa la ficha a mano.')}
        const n=fill(r);msg(`He rellenado ${plural(n,'campo','campos')} con los datos de ${r.fuente==='BNE'?'la Biblioteca Nacional de España':r.fuente}.`)}catch(x){msg('No hay conexión con los catálogos; puedes rellenarlo a mano.')}}
    async function byText(q){msg('Buscando…',true);sh.querySelector('#lres').innerHTML='';
      try{const rs=await searchCatalog(q);if(!rs.length)return msg('No he encontrado nada con esa búsqueda.');msg(`${plural(rs.length,'resultado','resultados')}. Toca la edición que te han dejado.`);
        sh.querySelector('#lres').innerHTML=rs.map((r,i)=>`<button type="button" class="ri" data-i="${i}">${cover(r)}<span><b>${esc(r.titulo)}</b><span>${esc([r.autor,r.editorial,r.anio].filter(Boolean).join(' · '))}</span><span class="rs">${esc([r.isbn&&'ISBN '+r.isbn,r.fuente==='BNE'?'Biblioteca Nacional':r.fuente].filter(Boolean).join(' · '))}</span></span></button>`).join('');
        sh.querySelector('#lres').onclick=ev=>{const x=ev.target.closest('.ri');if(!x)return;sh.querySelector('#lres').innerHTML='';const n=fill(rs[+x.dataset.i]);msg(`He rellenado ${plural(n,'campo','campos')}.`)}}catch(x){msg('No hay conexión con los catálogos.')}}
    const go=()=>{const q=sh.querySelector('#lq').value.trim();if(!q)return msg('Escribe un ISBN, un título o un autor.');const c=cleanIsbn(q);if(/^(\d{13}|\d{9}[\dX])$/.test(c))byIsbn(c);else byText(q)};
    sh.querySelector('#lbq').addEventListener('click',go);sh.querySelector('#lq').addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();go()}});
    sh.querySelector('#lscan').addEventListener('click',()=>Scan.open(code=>{sh.querySelector('#lq').value=code;manual.delete('isbn');byIsbn(code)}));
    if(preset.ficha&&isNew){const n=fill({...preset.ficha});if(preset.aviso)msg(preset.aviso);else if(n)msg(`Ficha creada con los datos de ${preset.ficha.fuente==='BNE'?'la Biblioteca Nacional de España':preset.ficha.fuente||'los catálogos'}. Indica quién te lo presta.`);setTimeout(()=>sh.querySelector('#lper').focus(),50)}
    sh.querySelector('#lfoot').addEventListener('click',ev=>{const a=ev.target.closest('[data-a]')?.dataset.a;
      if(a==='del')confirmFoot(sh.querySelector('#lfoot'),'¿Eliminar este préstamo?',()=>{delRec('loans',e.id);closeSheet(true);toast('Préstamo eliminado')});
      if(a==='own'){closeSheet(true);makeOwn(e.id)}});
    sh.querySelector('#lf').addEventListener('submit',ev=>{ev.preventDefault();const err=sh.querySelector('#lerr');
      const txt=sh.querySelector('#llib').value.trim(),persona=sh.querySelector('#lper').value.trim();
      if(!txt){err.textContent='Indica el libro.';return}if(!persona){err.textContent='Indica la persona.';return}
      let bookId=null,titulo=txt,autor=sh.querySelector('#laut').value.trim(),extra={};
      if(tipo==='prestado'){const m=S.books.find(b=>label(b)===txt)||S.books.find(b=>norm(b.titulo)===norm(txt));if(m){bookId=m.id;titulo=m.titulo;autor=m.autor||autor}
        const busy=bookId&&S.loans.find(x=>x.id!==e.id&&x.tipo==='prestado'&&!cerrado(x)&&x.bookId===bookId);if(busy){err.textContent=`Ese libro ya lo tiene ${busy.persona}.`;return}}
      else{let isbn=cleanIsbn(V('isbn'));if(isbn&&isbnOK(isbn))isbn=to13(isbn);const anio=parseInt(V('anio'));
        extra={editorial:V('editorial'),anio:anio>0?anio:null,edicion:V('edicion'),isbn,genero:V('genero'),formato:sh.querySelector('[name=lformato]:checked')?.value||'',portada:portada||null,portadaUrl:portada?'':portadaUrl};bookId=e.adquirido?e.bookId:null}
      saveRec('loans',{...(isNew?{}:store.loans[e.id]),...extra,id:isNew?undefined:e.id,tipo,bookId,titulo,autor,persona,fechaPrestamo:sh.querySelector('#lfp').value||today(),fechaDevolucion:sh.querySelector('#lfd').value||'',devuelto:sh.querySelector('#ldv')?.value||e.devuelto||null,notas:sh.querySelector('#lnot').value.trim(),leido:!!e.leido,creado:e.creado||Date.now()});
      closeSheet(true);S.ltab=tipo;toast(isNew?'Préstamo anotado':'Préstamo actualizado');if(S.tab!=='prestamos')location.hash='prestamos';else renderLoans()})})}

/* ================= qué leo ================= */
function recPool(gen=S.rGen){const lent=new Set(activeLoans('prestado').map(l=>l.bookId).filter(Boolean));
  let p=S.books.filter(b=>!b.leido&&!lent.has(b.id)).map(b=>({k:'b:'+b.id,b,g:b.genero||''}));
  if(S.rRcb)p=p.concat(activeLoans('recibido').filter(l=>!l.leido).map(l=>({k:'l:'+l.id,l,b:{titulo:l.titulo,autor:l.autor,anio:l.anio,editorial:l.editorial,genero:l.genero,portada:l.portada,portadaUrl:l.portadaUrl},g:'Prestados'})));
  return gen?p.filter(x=>x.g===gen):p}
const pickR=(p,not)=>{const c=p.length>1?p.filter(x=>x.k!==not):p;return c[Math.floor(Math.random()*c.length)]};
function renderRec(anim){
  const gens=[...new Set(recPool('').map(x=>x.g).filter(Boolean))].sort(coll.compare);if(S.rGen&&!gens.includes(S.rGen))S.rGen='';
  $('#rgen').innerHTML=[['','Todo lo pendiente'],...gens.map(g=>[g,g])].map(([v,l])=>`<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${S.rGen===v}">${esc(l)}</button>`).join('');
  $('#rrcb').checked=S.rRcb;
  const p=recPool();let cur=p.find(x=>x.k===S.recK);if(!cur&&p.length){cur=pickR(p);S.recK=cur.k}
  $('#rcount').textContent=p.length?`Elegida al azar entre ${plural(p.length,'libro pendiente','libros pendientes')}.`:'';
  if(!S.loaded){$('#rpic').innerHTML='';$('#rinfo').innerHTML='<p class="count">Cargando…</p>';return}
  if(!cur){$('#rpic').innerHTML=`<p class="empty-c">${S.books.length?'Has leído todo lo que tienes. Hora de ir a la librería.':'Aún no hay libros en tu estantería.'}</p>`;$('#rinfo').innerHTML=`<p class="kick">Tu próxima lectura</p><h2>${S.books.length?'Nada pendiente':'Empieza por añadir libros'}</h2><p class="rm">Aquí aparecerá, al azar, uno de los libros que tienes sin leer.</p>`;return}
  const b=cur.b,meta=[b.anio,b.editorial,b.genero].filter(Boolean).map(esc).join(' · ');
  $('#rpic').innerHTML=cover(b,anim?'deal':'');
  $('#rinfo').innerHTML=`<p class="kick">Tu próxima lectura</p><h2>${esc(b.titulo||'Sin título')}</h2><p class="ra">${esc(b.autor||'')}</p>${meta?`<p class="rm">${meta}</p>`:''}
   ${cur.l?`<p class="lentnote">Te lo prestó ${esc(cur.l.persona)}${cur.l.fechaDevolucion?' · devolver antes del '+fmtD(cur.l.fechaDevolucion):''}</p>`:''}
   <div class="ractions"><button type="button" class="btn pri" data-r="otra" ${p.length<2?'disabled':''}>${ic('dice')}Otra al azar</button>
   ${cur.b.id?`<button type="button" class="btn" data-r="ficha">Ver ficha</button>`:''}
   <button type="button" class="btn" data-r="leido">${ic('check')}Ya lo he leído</button></div>`}
let shuffling=false;
function shuffle(){const p=recPool();if(p.length<2||shuffling)return;const fin=pickR(p,S.recK);
  if(matchMedia('(prefers-reduced-motion:reduce)').matches){S.recK=fin.k;return renderRec(true)}
  shuffling=true;let i=0;const t=setInterval(()=>{const x=p[Math.floor(Math.random()*p.length)];$('#rpic').innerHTML=cover(x.b);if(++i>=6){clearInterval(t);shuffling=false;S.recK=fin.k;renderRec(true)}},70)}
$('#v-que-leo').addEventListener('click',e=>{const a=e.target.closest('[data-r]')?.dataset.r;const c=e.target.closest('.chip');
  if(c){S.rGen=c.dataset.v;S.recK=null;return renderRec(true)}
  if(!a)return;const cur=recPool().find(x=>x.k===S.recK);
  if(a==='otra')shuffle();else if(a==='ficha'&&cur?.b.id)openDetail(cur.b.id);
  else if(a==='leido'&&cur){if(cur.l)patchRec('loans',cur.l.id,{leido:true});else patchRec('books',cur.b.id,{leido:true});toast('¡Uno menos en la pila!');S.recK=null;renderRec(true)}});
$('#rrcb').addEventListener('change',e=>{S.rRcb=e.target.checked;savePrefs();S.recK=null;renderRec(true)});

/* ================= novedades ================= */
let newsLoading=false;
async function loadNews(){if(newsLoading)return;newsLoading=true;try{const j=await getJSON('news.json?t='+Math.floor(Date.now()/36e5),10000);if(j&&Array.isArray(j.items))S.news=j}catch(e){if(!S.news)S.news={items:[],error:true}}finally{newsLoading=false;if(S.tab==='novedades')renderNews()}}
function renderNews(){
  const n=S.news;$('#nupd').textContent=n?.actualizado?`Actualizado el ${fmtDT(n.actualizado)}`:'';
  const el=$('#nlist');if(!n){el.innerHTML='<p class="count">Cargando novedades…</p>';$('#ncats').innerHTML='';loadNews();return}
  const items=(n.items||[]).filter(x=>okUrl(x.url)&&x.titulo).sort((a,b)=>String(b.fecha||'').localeCompare(String(a.fecha||'')));
  const cats=[...new Set(items.map(x=>x.categoria).filter(Boolean))];if(S.nCat&&!cats.includes(S.nCat))S.nCat='';
  $('#ncats').innerHTML=cats.length>1?[['','Todo'],...cats.map(c=>[c,c])].map(([v,l])=>`<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${S.nCat===v}">${esc(l)}</button>`).join(''):'';
  if(!items.length){el.innerHTML=`<div class="empty">${EMPTY_SVG}<h2>${n.error?'No he podido cargar las novedades':'Todavía no hay novedades'}</h2><p>${n.error?'Revisa la conexión; se vuelven a pedir cada vez que abres esta pestaña.':'Se recogen cada mañana de webs literarias y editoriales.'}</p></div>`;return}
  const list=items.filter(x=>!S.nCat||x.categoria===S.nCat);
  el.innerHTML=`<div class="nlist">${list.map(x=>`<article class="ni"><p class="ni-m"><span class="src">${esc(x.fuente)}</span>${x.fecha?' · '+fmtD(x.fecha):''}${x.categoria&&!S.nCat?' · '+esc(x.categoria):''}</p><h3><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.titulo)}</a></h3>${x.resumen?`<p class="s">${esc(x.resumen)}</p>`:''}</article>`).join('')}</div>`+(Array.isArray(n.fuentes)&&n.fuentes.length?`<p class="nsrc">Fuentes de la última actualización: ${n.fuentes.map(esc).join(', ')}.</p>`:'')}
$('#ncats').addEventListener('click',e=>{const c=e.target.closest('.chip');if(c){S.nCat=c.dataset.v;renderNews()}});

/* ================= sincronización con Google Drive ================= */
const FILE_NAME='ExLibris-biblioteca.json',SCOPE='https://www.googleapis.com/auth/drive.file';
const Sync={state:'off',note:'',busy:false,timer:null,client:null,clientFor:'',pending:null,
  clientId(){return (CFG.googleClientId||'').trim()||(localStorage.getItem('exlibris-client')||'').trim()},
  connected(){return localStorage.getItem('exlibris-drive')==='1'},
  token(){try{const t=JSON.parse(localStorage.getItem('exlibris-tok')||'null');if(t&&t.exp>Date.now()+60000)return t.v}catch(e){}return null},
  tokenLeft(){try{const t=JSON.parse(localStorage.getItem('exlibris-tok')||'null');return t?Math.max(0,t.exp-Date.now()):0}catch(e){return 0}},
  email(){return localStorage.getItem('exlibris-email')||''},
  gis(){if(window.google?.accounts?.oauth2)return Promise.resolve();return this._gis||(this._gis=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=()=>res();s.onerror=()=>{this._gis=null;rej(new Error('gis'))};document.head.appendChild(s)}))},
  initClient(){const id=this.clientId();if(!window.google?.accounts?.oauth2||!id)return false;if(this.client&&this.clientFor===id)return true;
    this.client=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPE,callback:r=>{const p=this.pending;this.pending=null;if(!p)return;
      if(r.error||!r.access_token){p.rej(new Error(r.error||'denied'));return}
      if(google.accounts.oauth2.hasGrantedAllScopes&&!google.accounts.oauth2.hasGrantedAllScopes(r,SCOPE)){p.rej(new Error('scope'));return}
      try{localStorage.setItem('exlibris-tok',JSON.stringify({v:r.access_token,exp:Date.now()+(+r.expires_in||3500)*1000}));localStorage.setItem('exlibris-drive','1')}catch(e){}p.res(r.access_token)},
      error_callback:err=>{const p=this.pending;this.pending=null;p?.rej(new Error(err?.type||'popup'))}});this.clientFor=id;return true},
  async getToken(interactive){const t=this.token();if(t)return t;if(!interactive)return null;
    if(!this.initClient()){await this.gis();if(!this.initClient())throw new Error('noclient')}
    const opts={prompt:this.connected()?'':'consent'};if(this.email())opts.login_hint=this.email();
    return new Promise((res,rej)=>{this.pending={res,rej};this.client.requestAccessToken(opts)})},
  async whoami(tok){if(this.email()||this._who)return;this._who=true;try{const r=await this.api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{},tok);const e=(await r.json()).user?.emailAddress;if(e)localStorage.setItem('exlibris-email',e)}catch(x){}},
  async api(url,opt,tok){const r=await fetch(url,{...opt,headers:{...(opt?.headers||{}),Authorization:'Bearer '+tok}});
    if(r.status===401){localStorage.removeItem('exlibris-tok');const e=new Error('auth');e.auth=true;throw e}
    if(!r.ok){const e=new Error('http '+r.status);e.status=r.status;throw e}return r},
  async findFile(tok){const q=encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);const r=await this.api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=5`,{},tok);return (await r.json()).files?.[0]?.id||null},
  async download(id,tok){const r=await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,{},tok);return r.json()},
  async upload(id,data,tok){const body=JSON.stringify(data);
    if(id){await this.api(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':'application/json'},body},tok);return id}
    const b='exlibris'+Math.random().toString(36).slice(2);const meta={name:FILE_NAME,mimeType:'application/json',description:'Ex Libris · tu biblioteca personal (no lo borres: es la copia que sincroniza tus dispositivos)'};
    const mp=`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
    const r=await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+b},body:mp},tok);return (await r.json()).id},
  set(s,note=''){this.state=s;this.note=note;this.ui()},
  ui(){const el=$('#sync');const txt={noconfig:'Activar Drive',off:'Conectar Drive',tap:store.meta.dirty?'Pendiente · toca':'Toca para sincronizar',busy:'Sincronizando…',ok:'Sincronizado',offline:'Sin conexión',error:'Reintentar'}[this.state]||'Drive';
    const s=this.state==='ok'&&store.meta.dirty?'pending':this.state;el.dataset.s=s;$('#synctxt').textContent=this.state==='ok'&&store.meta.dirty?'Pendiente':txt;
    el.title=this.state==='ok'?`Última sincronización: ${ago(store.meta.lastSync)}`:this.note||'Sincronizar con Google Drive';
    const st=$('#drivestate');if(st)st.innerHTML=this.describe()},
  describe(){if(!this.clientId())return 'Falta el ID de cliente de Google (ver abajo).';if(!this.connected())return 'Sin conectar. Tus libros están solo en este dispositivo.';
    const last=store.meta.lastSync?`Última sincronización: ${esc(ago(store.meta.lastSync))}.`:'Aún no se ha sincronizado.';
    return `<span class="ok-t">Conectado a Google Drive${this.email()?' como '+esc(this.email()):''}.</span> ${last}${store.meta.dirty?' Hay cambios pendientes de subir.':''}${this.note?' '+esc(this.note):''} La sincronización es automática: al abrir la app, tras cada cambio y cada pocos minutos. Google pide renovar el permiso cada hora; la app lo renueva sola en cuanto tocas la pantalla (puede verse un instante la ventana de Google).`},
  schedule(){store.meta.dirty=true;persist();if(!this.connected()){this.ui();return}clearTimeout(this.timer);this.timer=setTimeout(()=>this.run(false),2500);this.ui()},
  async run(interactive){
    if(this.busy)return;if(!this.clientId()){this.set('noconfig');return}
    if(!navigator.onLine){this.set('offline');return}
    let tok;try{tok=await this.getToken(interactive)}catch(e){this.set(this.connected()?'tap':'off',e.message==='popup'?'El navegador ha bloqueado la ventana de Google; vuelve a pulsar.':'No se ha completado el inicio de sesión de Google.');return}
    if(!tok){this.set(this.connected()?'tap':'off');return}
    this.busy=true;this.set('busy');const rev=store.meta.rev;this.whoami(tok);
    try{let id=store.meta.driveFileId||await this.findFile(tok),remote=null;
      if(id){try{remote=await this.download(id,tok)}catch(e){if(e.status===404){id=await this.findFile(tok);remote=id?await this.download(id,tok):null}else throw e}}
      let subir=!(remote&&remote.app==='exlibris');
      if(!subir){subir=localNewer(store.books,remote.books)||localNewer(store.loans,remote.loans);store.books=mergeColl(store.books,remote.books);store.loans=mergeColl(store.loans,remote.loans)}
      if(pruneTomb(store.books)+pruneTomb(store.loans))subir=true;
      if(subir)id=await this.upload(id,snapshot(),tok);
      store.meta.driveFileId=id;store.meta.lastSync=Date.now();if(store.meta.rev===rev)store.meta.dirty=false;
      refresh();persist();render();this.busy=false;this.set('ok');
      if(store.meta.dirty)this.schedule()}
    catch(e){this.busy=false;if(e.auth)this.set('tap');else this.set('error',e.status===403?'Google ha denegado el acceso; revisa que la API de Drive esté habilitada.':'No se ha podido sincronizar.')}},
  disconnect(){const t=this.token();try{if(t&&window.google?.accounts?.oauth2)google.accounts.oauth2.revoke(t,()=>{})}catch(e){}
    localStorage.removeItem('exlibris-tok');localStorage.removeItem('exlibris-drive');localStorage.removeItem('exlibris-email');store.meta.driveFileId=null;persist();this.set(this.clientId()?'off':'noconfig')}};
$('#sync').addEventListener('click',()=>{if(!Sync.clientId())settingsSheet();else Sync.run(true)});
$('#gear').addEventListener('click',()=>settingsSheet());
addEventListener('online',()=>{if(Sync.connected())Sync.run(false)});
addEventListener('offline',()=>{if(Sync.connected())Sync.set('offline')});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(Sync.connected()){if(Sync.token())Sync.run(false);else Sync.set('tap')}if(S.tab==='novedades')loadNews()}});
// Sincronización automática: cada 3 minutos mientras la app está abierta…
setInterval(()=>{if(document.visibilityState==='visible'&&Sync.connected()&&Sync.token()&&!Sync.busy)Sync.run(false)},180000);
// …y renovación del permiso de Google aprovechando el primer toque (Google solo deja abrir su ventana tras un gesto)
let lastAutoAuth=0;
document.addEventListener('click',e=>{if(!Sync.connected()||!Sync.clientId()||Sync.busy||Sync.pending||!navigator.onLine)return;
  if(e.target.closest('#sync,input,label,select,textarea'))return;if(!$('#scan').hidden||!$('#cam').hidden)return;
  if(Sync.tokenLeft()>5*60000)return;if(Date.now()-lastAutoAuth<120000)return;lastAutoAuth=Date.now();Sync.run(true)},true);

/* ================= ajustes, copias e instalación ================= */
let installEvt=null;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvt=e;try{if(!localStorage.getItem('exlibris-noinst'))$('#inst').hidden=false}catch(x){$('#inst').hidden=false}});
addEventListener('appinstalled',()=>{installEvt=null;$('#inst').hidden=true;toast('Ex Libris instalada')});
async function doInstall(){if(!installEvt)return false;installEvt.prompt();try{await installEvt.userChoice}catch(e){}installEvt=null;$('#inst').hidden=true;return true}
$('#instgo').addEventListener('click',doInstall);
$('#instno').addEventListener('click',()=>{$('#inst').hidden=true;try{localStorage.setItem('exlibris-noinst','1')}catch(e){}});
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const COLS=[['titulo','Título'],['autor','Autor'],['anio','Año de publicación'],['editorial','Editorial'],['edicion','Número de edición'],['isbn','ISBN'],['genero','Género'],['fechaAdq','Fecha de adquisición'],['valoracion','Valoración'],['formato','Tipo de edición'],['leido','Leído'],['notas','Notas']];
const ALIAS={titulo:['titulo','title','libro','nombre','obra'],autor:['autor','autora','author','autores','escritor'],anio:['ano','anio','ano de publicacion','anio de publicacion','year','publicacion','fecha de publicacion'],editorial:['editorial','publisher','sello','editor'],edicion:['edicion','numero de edicion','n edicion','no edicion','num edicion','edition'],isbn:['isbn','isbn13','isbn 13','isbn10','isbn 10','ean'],genero:['genero','genre','categoria','tema','materia'],fechaAdq:['fecha de adquisicion','fecha adquisicion','adquisicion','adquirido','fecha de compra','comprado','date acquired'],valoracion:['valoracion','puntuacion','nota','rating','estrellas','calificacion'],formato:['tipo de edicion','formato','encuadernacion','format','binding','tipo'],leido:['leido','read','estado','leidos'],notas:['notas','comentarios','observaciones','notes','comentario']};
function toCSV(){const q=v=>{v=v==null?'':String(v);return /[;"\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const rows=[COLS.map(c=>c[1]),...S.books.slice().sort((a,b)=>coll.compare(a.titulo||'',b.titulo||'')).map(b=>COLS.map(([k])=>k==='leido'?(b.leido?'Sí':'No'):k==='valoracion'?(b.valoracion||''):b[k]))];
  return '﻿'+rows.map(r=>r.map(q).join(';')).join('\r\n')}
function parseCSV(text){text=text.replace(/^﻿/,'');const first=text.split(/\r?\n/)[0]||'';const d=[';',',','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
  const rows=[];let row=[],f='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}else if(c==='"')q=true;else if(c===d){row.push(f);f=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}else f+=c}
  if(f||row.length){row.push(f);rows.push(row)}return rows.filter(r=>r.some(x=>x.trim()))}
function csvDate(s){s=String(s||'').trim();let m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;m=/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return `${y}-${pad(m[2])}-${pad(m[1])}`}m=/^(\d{4})$/.exec(s);return m?`${m[1]}-01-01`:''}
function mapRows(rows){const hk=rows[0].map(h=>{const n=norm(h).replace(/[ºª°.#_()\/-]/g,' ').replace(/\s+/g,' ').trim();return Object.keys(ALIAS).find(k=>ALIAS[k].includes(n))||null});
  const have=new Set(S.books.map(b=>b.isbn).filter(Boolean)),haveTA=new Set(S.books.map(b=>norm(b.titulo)+'|'+norm(b.autor)));let skip=0;const out=[];
  for(const r of rows.slice(1)){const o={};hk.forEach((k,i)=>{if(k&&r[i]!=null&&String(r[i]).trim())o[k]=String(r[i]).trim()});if(!o.titulo)continue;
    let isbn=cleanIsbn(o.isbn);if(isbnOK(isbn))isbn=to13(isbn);const ta=norm(o.titulo)+'|'+norm(o.autor);
    if((isbn&&have.has(isbn))||haveTA.has(ta)){skip++;continue}if(isbn)have.add(isbn);haveTA.add(ta);
    let v=parseFloat(String(o.valoracion||'').replace(',','.'))||0;if(v>5)v=v/2;
    const nf=norm(o.formato);const fm=FORMATOS.find(f=>norm(f)===nf)||(/dura|cartone/.test(nf)?'Tapa dura':/bolsillo/.test(nf)?'Bolsillo':/solapa/.test(nf)?'Rústica con solapas':/blanda|rustica/.test(nf)?'Tapa blanda':o.formato?'Otro':'');
    out.push({titulo:o.titulo.slice(0,300),autor:(o.autor||'').slice(0,200),anio:parseInt(o.anio)||null,editorial:o.editorial||'',edicion:o.edicion||'',isbn,genero:o.genero||'',fechaAdq:csvDate(o.fechaAdq),valoracion:Math.max(0,Math.min(5,Math.round(v))),formato:fm,leido:/^(si|s|x|true|1|leido|leida|yes|y|read|terminado)$/.test(norm(o.leido)),notas:o.notas||'',portada:null,portadaUrl:isbn?`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`:'',creado:Date.now()+out.length})}
  return {out,skip,cols:hk.filter(Boolean)}}
async function readText(f){const buf=await f.arrayBuffer();try{return new TextDecoder('utf-8',{fatal:true}).decode(buf)}catch(e){return new TextDecoder('windows-1252').decode(buf)}}
function settingsSheet(){
  const cfgId=(CFG.googleClientId||'').trim();
  openSheet(head('Ajustes')+`<div class="more">
  <section><h3>Sincronizar con Google Drive</h3><p id="drivestate">${Sync.describe()}</p>
    <p>La app guarda un único archivo, <b>${FILE_NAME}</b>, en tu Drive y solo puede ver ese archivo. Conéctala con la misma cuenta en el móvil y en el PC.</p>
    ${cfgId?'':`<label class="f" style="margin-bottom:10px"><span>ID de cliente de Google</span><input id="cid" value="${esc(Sync.clientId())}" placeholder="…apps.googleusercontent.com" autocomplete="off"></label>`}
    <div class="trow">${Sync.connected()?`<button type="button" class="btn pri" id="dsync">${ic('cloud')}Sincronizar ahora</button><button type="button" class="btn" id="doff">Desconectar</button>${store.meta.driveFileId?`<a class="btn" href="https://drive.google.com/file/d/${esc(store.meta.driveFileId)}/view" target="_blank" rel="noopener">Ver en Drive</a>`:''}`:`<button type="button" class="btn pri" id="don">${ic('cloud')}Conectar con Google Drive</button>`}</div></section>
  <section><h3>Instalar la app</h3>${standalone()?'<p>Ya la estás usando instalada.</p>':installEvt?`<p>Instálala para abrirla con su icono, a pantalla completa y sin conexión.</p><button type="button" class="btn pri" id="sinst">${ic('down')}Instalar Ex Libris</button>`:'<p>En Android, abre el menú ⋮ de Chrome y elige «Instalar aplicación» o «Añadir a pantalla de inicio». En el PC, pulsa el icono de instalar que aparece a la derecha de la barra de direcciones de Chrome o Edge.</p>'}</section>
  <section><h3>Copia de seguridad</h3><p>Descarga todo (libros, préstamos y fotos) en un archivo, o recupéralo desde una copia. Al recuperar se combinan los datos; no se borra nada.</p>
    <div class="trow"><button type="button" class="btn" id="bjson">${ic('down')}Descargar copia</button><label class="btn">${ic('up')}Recuperar copia<input type="file" accept=".json,application/json" class="vh" id="rjson"></label></div></section>
  <section><h3>Hoja de cálculo (CSV)</h3><p>Exporta tus libros para Excel o Google Sheets, o importa la lista que ya tuvieras: una fila por libro y en la primera fila los nombres de columna (Título, Autor, Año, Editorial, Edición, ISBN, Género, Fecha de adquisición, Valoración, Tipo de edición, Leído, Notas). Los libros repetidos se saltan.</p>
    <div class="trow"><button type="button" class="btn" id="bcsv" ${S.books.length?'':'disabled'}>${ic('down')}Exportar CSV</button><label class="btn">${ic('up')}Importar CSV<input type="file" accept=".csv,text/csv,text/plain" class="vh" id="rcsv"></label></div><div id="mres" style="margin-top:12px"></div></section>
  <section><p>Ex Libris ${VERSION} · ${plural(S.books.length,'libro','libros')} y ${plural(S.loans.length,'préstamo','préstamos')} en este dispositivo. Las fichas se buscan en el catálogo de la Biblioteca Nacional de España, Google Books y Open Library.</p></section></div>`,sh=>{
    const cid=sh.querySelector('#cid');const saveCid=()=>{if(!cid)return;const v=cid.value.trim();try{v?localStorage.setItem('exlibris-client',v):localStorage.removeItem('exlibris-client')}catch(e){}Sync.ui()};
    cid?.addEventListener('change',saveCid);
    sh.querySelector('#don')?.addEventListener('click',async()=>{saveCid();if(!Sync.clientId()){toast('Pega primero el ID de cliente de Google.');cid?.focus();return}await Sync.run(true);if(Sync.connected())settingsSheet()});
    sh.querySelector('#dsync')?.addEventListener('click',()=>Sync.run(true));
    sh.querySelector('#doff')?.addEventListener('click',()=>{Sync.disconnect();settingsSheet();toast('Desconectado. Tus libros siguen en este dispositivo.')});
    sh.querySelector('#sinst')?.addEventListener('click',doInstall);
    sh.querySelector('#bjson').addEventListener('click',()=>download(`ex-libris-copia-${today()}.json`,JSON.stringify(snapshot()),'application/json'));
    sh.querySelector('#rjson').addEventListener('change',async ev=>{const f=ev.target.files[0];ev.target.value='';if(!f)return;
      try{const j=JSON.parse(await readText(f));if(j.app!=='exlibris')throw new Error('fmt');const nb=Object.keys(j.books||{}).length;
        store.books=mergeColl(store.books,j.books);store.loans=mergeColl(store.loans,j.loans);commit();toast(`Copia recuperada (${plural(nb,'ficha','fichas')})`)}catch(e){toast('Ese archivo no es una copia de Ex Libris.')}});
    sh.querySelector('#bcsv').addEventListener('click',()=>download(`biblioteca-${today()}.csv`,toCSV(),'text/csv;charset=utf-8'));
    sh.querySelector('#rcsv').addEventListener('change',async ev=>{const f=ev.target.files[0];ev.target.value='';if(!f)return;const res=sh.querySelector('#mres');
      let text;try{text=await readText(f)}catch(e){res.innerHTML='<p class="err">No he podido leer el archivo.</p>';return}
      const rows=parseCSV(text);if(rows.length<2){res.innerHTML='<p class="err">El archivo no tiene filas de libros.</p>';return}
      const {out,skip,cols}=mapRows(rows);if(!cols.includes('titulo')){res.innerHTML='<p class="err">No encuentro una columna de título. Revisa que la primera fila tenga los nombres de las columnas.</p>';return}
      const names=cols.map(k=>COLS.find(c=>c[0]===k)?.[1]).filter(Boolean).join(', ');
      res.innerHTML=`<p>He encontrado <b>${plural(out.length,'libro nuevo','libros nuevos')}</b>${skip?` (${skip} ya estaban y los salto)`:''}. Columnas reconocidas: ${esc(names)}.</p>${out.length?`<button type="button" class="btn pri" id="mgo">Importar ${out.length}</button>`:''}`;
      res.querySelector('#mgo')?.addEventListener('click',()=>{const now=Date.now();out.forEach((d,i)=>{const id=uid()+i;store.books[id]={...d,id,actualizado:now}});commit();res.innerHTML=`<p class="ok-t">Importados ${out.length} libros.</p>`;toast(plural(out.length,'libro importado','libros importados'))})})})}

/* ================= navegación ================= */
function render(){renderTop();({biblioteca:renderShelf,prestamos:renderLoans,'que-leo':renderRec,novedades:renderNews})[S.tab]();
  $('#fab').hidden=!(S.tab==='biblioteca'||S.tab==='prestamos');$('#fab').setAttribute('aria-label',S.tab==='prestamos'?'Nuevo préstamo':'Añadir libro')}
function setTab(t){if(!TABS.includes(t))t='biblioteca';const ch=S.tab!==t;S.tab=t;$$('.view').forEach(v=>v.hidden=v.id!=='v-'+t);$$('[data-tab]').forEach(a=>a.dataset.tab===t?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));render();if(ch)window.scrollTo(0,0)}
function route(){const h=location.hash.slice(1);if(h==='nuevo'||h==='escanear'){history.replaceState(null,'','#biblioteca');setTab('biblioteca');if(S.loaded)h==='nuevo'?bookForm():Scan.open(quickAdd,true);else S.after=h;return}setTab(h)}
addEventListener('hashchange',route);
$('#fab').addEventListener('click',()=>S.tab==='prestamos'?loanForm():bookForm());

/* ================= arranque ================= */
(async()=>{
  route();
  try{await KV.open()}catch(e){}
  try{const st=await KV.get('state');if(st&&typeof st==='object'){store={books:st.books||{},loans:st.loans||{},meta:{rev:0,...(st.meta||{})}}}}catch(e){banner('No he podido leer los datos guardados en este dispositivo.')}
  try{navigator.storage?.persist?.()}catch(e){}
  refresh();S.loaded=true;render();
  if(S.after){const a=S.after;S.after=null;a==='nuevo'?bookForm():Scan.open(quickAdd,true)}
  if(!Sync.clientId())Sync.set('noconfig');else{Sync.set(Sync.connected()?(Sync.token()?'ok':'tap'):'off');Sync.gis().then(()=>Sync.initClient()).catch(()=>{});if(Sync.connected()&&Sync.token())Sync.run(false)}
  loadNews();try{sessionStorage.removeItem('exlibris-fix')}catch(e){}
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){const hadCtrl=!!navigator.serviceWorker.controller;try{const reg=await navigator.serviceWorker.register('sw.js');
    const offer=w=>{if(w&&navigator.serviceWorker.controller)toast('Hay una versión nueva de Ex Libris',{label:'Actualizar',keep:true,fn:()=>{w.postMessage('skip');}})};
    if(reg.waiting)offer(reg.waiting);else reg.update().catch(()=>{});
    reg.addEventListener('updatefound',()=>{const w=reg.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed')offer(w)})});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})});
    let reloaded=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloaded||!hadCtrl)return;reloaded=true;location.reload()})}catch(e){}}
})();
}
