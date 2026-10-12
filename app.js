'use strict';
/* Atlas Gourmet — diario de restaurantes + lista de deseos.
   Todo vive en Supabase (Postgres + Storage): nada se guarda en el dispositivo,
   así que cambiar de móvil no pierde nada. Requiere sesión (enlace mágico por email). */

const SUPABASE_URL = 'https://yxdzpmnyfexxhzsckzds.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cCAzuyN2kZB27dwW6I-g3g_SW-rOhgJ';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);

let state = { items: [] };
let session = null;
let view = 'visited';
let filters = { q: '', sort: 'date', cuisine: '', fav: false };
let map = null;

const visited = () => state.items.filter(i => i.type === 'visited');
const wish = () => state.items.filter(i => i.type === 'wish');
const byId = id => state.items.find(i => i.id === id);

/* ================= DATOS (Supabase Postgres) ================= */
const rowToItem = r => ({ ...r, created: new Date(r.created_at).getTime(), dishes: r.dishes || [] });
function itemToRow(it) {
  const { id, created, type, name, city, country, cuisine, price, rating, stars, date, dishes,
    wine, companions, notes, reason, priority, target, link, fav, lat, lng, photos: ph } = it;
  return { type, name, city: city || null, country: country || null, cuisine: cuisine || null,
    price: price || null, rating: rating ?? null, stars: stars || null, date: date || null,
    dishes: dishes || [], wine: wine || null, companions: companions || null, notes: notes || null,
    reason: reason || null, priority: priority || null, target: target || null, link: link || null,
    fav: !!fav, lat: lat ?? null, lng: lng ?? null, photos: ph || [] };
}
async function fetchItems() {
  const { data, error } = await sb.from('items').select('*').order('created_at', { ascending: false });
  if (error) { toast('No se pudieron cargar tus datos: ' + error.message); return; }
  state.items = data.map(rowToItem);
}
async function insertItem(it) {
  const { data, error } = await sb.from('items').insert(itemToRow(it)).select().single();
  if (error) { toast('No se pudo guardar: ' + error.message); return null; }
  return rowToItem(data);
}
async function updateItem(id, patch) {
  const { data, error } = await sb.from('items').update(patch).eq('id', id).select().single();
  if (error) { toast('No se pudo guardar: ' + error.message); return null; }
  return rowToItem(data);
}
async function deleteItem(id) {
  const { error } = await sb.from('items').delete().eq('id', id);
  if (error) toast('No se pudo eliminar: ' + error.message);
}

/* ================= FOTOS (Supabase Storage, privadas) ================= */
const photos = {}; // id -> [url firmada]
async function signPaths(paths) {
  if (!paths.length) return [];
  const { data, error } = await sb.storage.from('photos').createSignedUrls(paths, 60 * 60 * 24 * 7);
  if (error) return [];
  return data.map(d => d.signedUrl).filter(Boolean);
}
async function loadPhotos() {
  const all = [...new Set(state.items.flatMap(i => i.photos || []))];
  if (!all.length) return;
  const { data, error } = await sb.storage.from('photos').createSignedUrls(all, 60 * 60 * 24 * 7);
  if (error) return;
  const map = {}; data.forEach((d, i) => { if (d.signedUrl) map[all[i]] = d.signedUrl; });
  for (const it of state.items) photos[it.id] = (it.photos || []).map(p => map[p]).filter(Boolean);
}
async function uploadPhoto(itemId, blob) {
  const path = `${session.user.id}/${itemId}/${uid()}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) { toast('No se pudo subir la foto: ' + error.message); return null; }
  const [url] = await signPaths([path]);
  return { path, url };
}
async function removePhotoPaths(paths) {
  if (!paths.length) return;
  await sb.storage.from('photos').remove(paths);
}
function shrink(file, max = 1400) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(), 'image/jpeg', .82);
    };
    img.onerror = () => rej(); img.src = url;
  });
}

/* ================= UTILIDADES VISUALES ================= */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3000); }
const HUES = [352, 12, 28, 38, 330, 262, 205, 300];
const hue = s => HUES[[...String(s || 'x')].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % HUES.length];
const EMOJI = [['sushi|japon', '🍣'], ['ital|pizza|pasta', '🍝'], ['franc', '🥐'], ['mexic', '🌮'], ['peru', '🐟'], ['marisc|pescad', '🦞'], ['parrilla|carne|brasa', '🥩'], ['vegetar|vegan', '🥗'], ['asi|chin|thai|corea', '🥢'], ['street', '🌯'], ['espa|tradic|tapas', '🍷'], ['autor|fusi|creativ', '✨'], ['medit', '🫒']];
const emojiFor = c => (EMOJI.find(([k]) => new RegExp(k, 'i').test(c || '')) || [0, '🍽️'])[1];
function media(it) {
  const p = photos[it.id]?.[0];
  if (p) return `<div class="media"><img src="${p}" alt="" loading="lazy"></div>`;
  return `<div class="media"><div class="gen" style="--h:${hue(it.name + it.cuisine)}"><i></i><i></i><i></i><span class="emo">${emojiFor(it.cuisine)}</span><span class="ini">${esc((it.name || '?')[0].toUpperCase())}</span></div></div>`;
}
const euro = n => n ? `<span class="eur">${'€'.repeat(n)}<i>${'€'.repeat(4 - n)}</i></span>` : '';
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
function ring(val, max, r = 20, sw = 3, animate = false) {
  const C = 2 * Math.PI * r, off = C * (1 - Math.min(1, val / max)), s = r + sw, d = 2 * s;
  return `<svg class="ring" viewBox="0 0 ${d} ${d}"><circle class="rb" cx="${s}" cy="${s}" r="${r}" stroke-width="${sw}"/><circle class="rf" cx="${s}" cy="${s}" r="${r}" stroke-width="${sw}" stroke-dasharray="${C}" stroke-dashoffset="${animate ? C : off}" data-off="${off}" transform="rotate(-90 ${s} ${s})"/></svg>`;
}
function countUp(el, to, dec = 0) {
  let t0 = null;
  const step = t => { t0 ??= t; const p = Math.min(1, Math.max(0, (t - t0) / 1400)); el.textContent = (to * (1 - Math.pow(1 - p, 4))).toFixed(dec); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .08, rootMargin: '0px 0px -40px' });
function observe(root = document) { $$('.reveal', root).forEach((el, i) => { el.style.setProperty('--d', (i % 6) * 70 + 'ms'); io.observe(el); }); }

/* ================= HERO ================= */
const HERO = {
  visited: ['Memorias de mesa'],
  wish: ['Próximas reservas'],
  map: ['Cartografía del gusto'],
  stats: ['Tu paladar en cifras'],
};
let reelTimer;
function renderHero() {
  const [eb] = HERO[view];
  $('#hero').classList.add('short');
  $('#eyebrow').textContent = eb;
  $('#hero-cta').innerHTML = view === 'visited' || view === 'wish' ? `<button class="btn gold" id="cta">${view === 'visited' ? 'Añadir un recuerdo' : 'Añadir un deseo'}</button>` : '';
  $('#cta')?.addEventListener('click', () => openForm({ type: view }));

  const v = visited(), rated = v.filter(i => i.rating);
  const avg = rated.length ? rated.reduce((a, i) => a + i.rating, 0) / rated.length : 0;
  const countries = new Set(v.map(i => (i.country || '').trim().toLowerCase()).filter(Boolean)).size;
  const items = [[v.length, 'Visitados', 0], [wish().length, 'En deseos', 0], [countries, 'Países', 0], [v.reduce((a, i) => a + (i.stars || 0), 0), 'Estrellas Michelin', 0], [avg, 'Nota media', 1]];
  $('#counters').innerHTML = items.map(([, l]) => `<div class="counter"><b>0</b><span>${l}</span></div>`).join('');
  $$('#counters b').forEach((b, i) => countUp(b, items[i][0], items[i][2]));
  setReel(); setMarquee(); setPalette();
}
function setReel() {
  clearInterval(reelTimer);
  const pool = state.items.filter(i => i.type === view || view === 'map' || view === 'stats').flatMap(i => photos[i.id] || []);
  const urls = (pool.length ? pool : state.items.flatMap(i => photos[i.id] || [])).sort(() => Math.random() - .5).slice(0, 7);
  const reel = $('#reel'); reel.innerHTML = urls.map(u => `<div class="slide" style="background-image:url(${u})"></div>`).join('');
  const slides = $$('.slide', reel); let k = 0;
  if (!slides.length) return;
  slides[0].classList.add('on');
  if (slides.length > 1) reelTimer = setInterval(() => { slides[k].classList.remove('on'); k = (k + 1) % slides.length; slides[k].classList.add('on'); }, 6500);
}
function setMarquee() {
  const words = [...new Set(state.items.flatMap(i => [i.city, i.cuisine]).filter(Boolean))];
  const list = words.length > 3 ? words : ['Sabor', 'Memoria', 'Mesa', 'Sobremesa', 'Mantel', 'Brindis', 'Producto', 'Fuego', 'Temporada', 'Oficio'];
  const html = [...list, ...list].map(w => `<span>${esc(w)}</span>`).join('');
  $('#marquee').innerHTML = `<div class="marquee-t">${html}${html}</div>`;
}

/* ================= VISTAS ================= */
function render() {
  renderHero();
  if (map) { map.remove(); map = null; }
  ({ visited: renderList, wish: renderList, map: renderMap, stats: renderStats })[view]();
  observe(); moveInk();
  $$('#bottom [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
}
function filtered() {
  const q = filters.q.toLowerCase();
  const out = state.items.filter(i => i.type === view &&
    (!q || [i.name, i.city, i.country, i.cuisine, i.notes, i.reason, ...(i.dishes || [])].join(' ').toLowerCase().includes(q)) &&
    (!filters.cuisine || i.cuisine === filters.cuisine) && (!filters.fav || i.fav));
  const cmp = {
    date: (a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0), name: (a, b) => a.name.localeCompare(b.name),
    prio: (a, b) => (b.priority || 0) - (a.priority || 0) || b.created - a.created, added: (a, b) => b.created - a.created,
  }[filters.sort] || (() => 0);
  return out.sort(cmp);
}
function renderList() {
  const isV = view === 'visited';
  if (isV && !['date', 'rating', 'name'].includes(filters.sort)) filters.sort = 'date';
  if (!isV && !['prio', 'added', 'name'].includes(filters.sort)) filters.sort = 'prio';
  const all = state.items.filter(i => i.type === view);
  const cuisines = [...new Set(all.map(i => i.cuisine).filter(Boolean))].sort();
  const sorts = isV ? [['date', 'Más recientes'], ['rating', 'Mejor valorados'], ['name', 'A–Z']] : [['prio', 'Mayor prioridad'], ['added', 'Último añadido'], ['name', 'A–Z']];
  let html = '';
  if (all.length) html += `<div class="toolbar">
    <div class="search"><input id="q" placeholder="Buscar nombre, ciudad, plato…" value="${esc(filters.q)}"></div>
    <select class="pill" id="sort">${sorts.map(([v, l]) => `<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${cuisines.length ? `<select class="pill" id="cuis"><option value="">Todas las cocinas</option>${cuisines.map(c => `<option ${filters.cuisine === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
    <button class="chip ${filters.fav ? 'on' : ''}" id="favf">♥ Favoritos</button></div>`;
  const items = filtered();
  if (!items.length) {
    html += `<div class="empty reveal"><div class="big">${isV ? '🍽️' : '🕯️'}</div>
      <h3>${all.length ? 'Nada coincide con tu búsqueda' : isV ? 'Tu diario está en blanco' : 'Tu lista de deseos está vacía'}</h3>
      <p>${isV ? 'Empieza con ese restaurante que no puedes olvidar.' : 'Guarda aquí los restaurantes a los que sueñas ir.'}</p>
      ${all.length ? '' : `<button class="btn gold" data-add="${view}">+ Añadir ${isV ? 'mi primer restaurante' : 'mi primer deseo'}</button>`}</div>`;
  } else {
    html += `<div id="list">${listHTML(items)}</div>`;
  }
  $('#view').innerHTML = html;
  $('#q')?.addEventListener('input', e => { filters.q = e.target.value; clearTimeout(renderList.t); renderList.t = setTimeout(softList, 160); });
  $('#sort')?.addEventListener('change', e => { filters.sort = e.target.value; softList(); });
  $('#cuis')?.addEventListener('change', e => { filters.cuisine = e.target.value; softList(); });
  $('#favf')?.addEventListener('click', () => { filters.fav = !filters.fav; softList(); });
  $$('[data-add]').forEach(b => b.onclick = () => openForm({ type: b.dataset.add }));
  bindCards();
}
function softList() { // repinta solo la lista, conservando el foco del buscador
  const pos = document.activeElement?.id === 'q' ? document.activeElement.selectionStart : null;
  renderList(); observe();
  if (pos !== null) { const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
}
function listHTML(items) {
  return view === 'visited' ? `<div class="grid">${items.map((it, i) => card(it, i === 0 && items.length > 2 && !filters.q)).join('')}</div>`
    : `<div class="tickets">${items.map((it, i) => ticket(it, i === 0 && filters.sort === 'prio' && !filters.q)).join('')}</div>`;
}
function card(it, feat) {
  return `<article class="card reveal ${feat ? 'feat' : ''}" data-id="${it.id}">
    ${media(it)}<div class="shade"></div>
    <div class="top-row">${it.stars ? `<span class="mstars">${'★'.repeat(it.stars)}</span>` : '<span></span>'}
      ${it.rating ? `<div class="score">${ring(it.rating, 10, 22, 3)}<b>${it.rating.toFixed(1)}</b></div>` : ''}</div>
    <button class="fav ${it.fav ? 'on' : ''}" aria-label="Favorito">${it.fav ? '♥' : '♡'}</button>
    <div class="info"><div class="kicker">${esc(it.cuisine || 'Restaurante')} ${euro(it.price)}</div>
      <h3>${esc(it.name)}</h3><div class="loc">${esc([it.city, it.country].filter(Boolean).join(', '))}${it.date ? ' · ' + new Date(it.date + 'T12:00').getFullYear() : ''}</div>
      ${it.dishes?.length ? `<div class="more">${it.dishes.slice(0, 3).map(d => `<span>${esc(d)}</span>`).join('')}</div>` : ''}</div></article>`;
}
function ticket(it, next) {
  return `<article class="ticket reveal" data-id="${it.id}"><div class="t-media">${media(it)}</div><div class="perf"></div>
    <div class="t-body">${next ? '<span class="next">Siguiente parada</span>' : ''}
      <span class="prio">${'◆'.repeat(it.priority || 1)}<span style="opacity:.25">${'◆'.repeat(3 - (it.priority || 1))}</span></span>
      <h3>${esc(it.name)}</h3><div class="loc">${esc([it.city, it.country].filter(Boolean).join(', '))}${it.cuisine ? ' · ' + esc(it.cuisine) : ''}</div>
      <p class="quote">${it.reason ? '“' + esc(it.reason) + '”' : ''}</p>
      <div class="t-foot"><span style="display:flex;gap:.4rem;align-items:center">${it.target ? `<span class="tag">${esc(it.target)}</span>` : ''}<span class="kicker">${euro(it.price)}</span></span>
        <button class="btn wine sm" data-went>✓ Ya he ido</button></div></div></article>`;
}
function bindCards() {
  $$('.card,.ticket').forEach(c => {
    c.onclick = e => { if (e.target.closest('.fav')) return; if (e.target.closest('[data-went]')) { const it = byId(c.dataset.id); return openForm({ ...it, type: 'visited', date: today(), __promote: true }); } openDetail(c.dataset.id); };
  });
  $$('.card').forEach(c => {
    c.onmousemove = e => { const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; c.style.transition = 'box-shadow .5s,border-color .4s,opacity .9s'; c.style.transform = `perspective(1000px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-6px)`; };
    c.onmouseleave = () => { c.style.transition = ''; c.style.transform = ''; };
  });
  $$('.fav').forEach(f => f.onclick = e => { e.stopPropagation(); const it = byId(f.closest('.card').dataset.id); it.fav = !it.fav; f.classList.toggle('on', it.fav); f.textContent = it.fav ? '♥' : '♡'; updateItem(it.id, { fav: it.fav }); });
}

/* ================= DETALLE ================= */
let detailTimer;
function openDetail(id) {
  const it = byId(id); if (!it) return;
  const isV = it.type === 'visited', ph = photos[id] || [];
  const bg = ph.length ? ph.map((u, i) => `<div class="slide ${i ? '' : 'on'}" style="background-image:url(${u})"></div>`).join('')
    : `<div class="slide on" style="inset:0;animation:none;opacity:1"><div class="media"><div class="gen" style="--h:${hue(it.name + it.cuisine)}"><i></i><i></i><i></i><span class="emo" style="font-size:12rem;opacity:.9">${emojiFor(it.cuisine)}</span><span class="ini">${esc(it.name[0].toUpperCase())}</span></div></div></div>`;
  const chars = [...it.name].map((c, i) => `<span class="ch" style="animation-delay:${i * 35 + 200}ms">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
  const fact = (l, v) => v ? `<div class="fact"><small>${l}</small><div>${v}</div></div>` : '';
  const dt = $('#detail');
  dt.innerHTML = `<div class="d-nav"><button class="circle" id="d-back" aria-label="Volver">←</button><button class="circle" id="d-edit" aria-label="Editar">✎</button></div>
    <div class="d-hero"><div class="d-bgwrap" id="d-bg">${bg}</div>
      <div class="d-title"><div class="kicker" style="margin-bottom:1rem">${isV ? 'Visitado' + (it.date ? ' · ' + fmtDate(it.date) : '') : 'En mi lista de deseos'}</div>
      <h2>${chars}</h2><div class="loc">${esc([it.city, it.country].filter(Boolean).join(', '))}${it.cuisine ? ' · ' + esc(it.cuisine) : ''}</div></div></div>
    <div class="d-wrap">
      <div class="d-facts">
        ${isV && it.rating ? `<div class="d-score">${ring(it.rating, 10, 54, 4, true)}<b>${it.rating.toFixed(1)}</b></div>` : ''}
        ${fact('Estrellas', it.stars ? `<span style="color:#ff9aa8">${'★'.repeat(it.stars)}</span> Michelin` : '')}
        ${fact('Precio', it.price ? `<span style="color:var(--gold)">${'€'.repeat(it.price)}</span>` : '')}
        ${fact('Con', esc(it.companions))}${fact('Prioridad', !isV ? `<span style="color:var(--wine2)">${'◆'.repeat(it.priority || 1)}</span>` : '')}${fact('Cuándo', esc(it.target))}
      </div>
      ${it.reason ? sec('Por qué quiero ir', `<p>${esc(it.reason)}</p>`) : ''}
      ${it.dishes?.length ? sec('Platos que no olvido', `<div class="dishes">${it.dishes.map((d, i) => `<div class="dish"><i>${String(i + 1).padStart(2, '0')}</i>${esc(d)}</div>`).join('')}</div>`) : ''}
      ${it.wine ? sec('En la copa', `<p>${esc(it.wine)}</p>`) : ''}
      ${it.notes ? sec('Recuerdos', `<p>${esc(it.notes)}</p>`) : ''}
      ${ph.length > 1 || (ph.length && it.notes) ? sec('Galería', `<div class="gallery">${ph.map(u => `<img src="${u}" alt="" loading="lazy">`).join('')}</div>`) : ''}
      ${it.link ? sec('Web / reservas', `<p><a style="color:var(--gold)" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.link)}</a></p>`) : ''}
      <div class="d-actions"><button class="btn danger" id="d-del">Eliminar</button>${!isV ? '<button class="btn wine" id="d-went">✓ ¡Ya he ido!</button>' : ''}</div>
    </div>`;
  dt.classList.add('open'); dt.setAttribute('aria-hidden', 'false'); dt.scrollTop = 0; document.body.classList.add('lock');
  setTimeout(() => $$('.rf', dt).forEach(r => r.style.strokeDashoffset = r.dataset.off), 500);
  const slides = $$('#d-bg .slide'); let k = 0; clearInterval(detailTimer);
  if (slides.length > 1) detailTimer = setInterval(() => { slides[k].classList.remove('on'); k = (k + 1) % slides.length; slides[k].classList.add('on'); }, 6000);
  dt.onscroll = () => { $('#d-bg').style.transform = `translateY(${dt.scrollTop * .35}px)`; };
  $$('.gallery img', dt).forEach(im => im.onclick = () => { const lb = $('#lightbox'); lb.innerHTML = `<img src="${im.src}">`; lb.classList.add('open'); });
  $('#d-back').onclick = closeDetail;
  $('#d-edit').onclick = () => openForm(it);
  $('#d-del').onclick = async () => {
    if (!confirm(`¿Eliminar "${it.name}"?`)) return;
    state.items = state.items.filter(i => i !== it); delete photos[it.id]; closeDetail(); render(); toast('Eliminado');
    await deleteItem(it.id); if (it.photos?.length) await removePhotoPaths(it.photos);
  };
  $('#d-went')?.addEventListener('click', () => openForm({ ...it, type: 'visited', date: today(), __promote: true }));
}
const sec = (t, h) => `<div class="d-sec"><h4>${t}</h4>${h}</div>`;
function closeDetail() { clearInterval(detailTimer); const d = $('#detail'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); document.body.classList.remove('lock'); }
$('#lightbox').onclick = () => $('#lightbox').classList.remove('open');

/* ================= FORMULARIO ================= */
async function openForm(src) {
  const editing = !!src.id && !src.__promote;
  const d = { type: 'visited', name: '', city: '', country: '', cuisine: '', price: 0, rating: 7.5, stars: 0, date: today(), dishes: [], wine: '', companions: '', notes: '', reason: '', priority: 2, target: '', link: '', fav: false, ...src };
  let type = d.type, price = d.price, stars_ = d.stars, prio = d.priority, busy = false;
  let pics = (src.photos || []).map((p, i) => ({ path: p, url: (photos[src.id] || [])[i] }));
  const cuisines = ['Española', 'Italiana', 'Francesa', 'Japonesa', 'Mediterránea', 'Mexicana', 'Peruana', 'Asiática', 'Fusión', 'De autor', 'Tradicional', 'Marisquería', 'Parrilla / Carnes', 'Vegetariana', 'Street food'];

  const snapshot = () => { const f = $('#f'); if (!f) return; for (const el of f.elements) if (el.name && el.name !== 'dishes') d[el.name] = el.type === 'range' ? +el.value : el.value; if (f.dishes) d.dishes = f.dishes.value.split('\n').map(s => s.trim()).filter(Boolean); };
  const paint = () => {
    const isV = type === 'visited';
    modal(`<div class="m-head"><h2>${editing ? 'Editar' : isV ? 'Nuevo recuerdo' : 'Nuevo deseo'}</h2><button class="x" data-close>×</button></div>
    <form class="m-body" id="f" autocomplete="off">
      ${editing ? '' : `<div class="seg"><button type="button" data-t="visited" class="${isV ? 'on' : ''}">He estado</button><button type="button" data-t="wish" class="${!isV ? 'on' : ''}">Quiero ir</button></div>`}
      <div class="fgrid">
        <label class="f full">Nombre *<input name="name" required value="${esc(d.name)}" placeholder="Ej. Disfrutar"></label>
        <label class="f">Ciudad<input name="city" value="${esc(d.city)}" placeholder="Barcelona"></label>
        <label class="f">País<input name="country" value="${esc(d.country)}" placeholder="España"></label>
        <label class="f">Tipo de cocina<input name="cuisine" list="cl" value="${esc(d.cuisine)}"><datalist id="cl">${cuisines.map(c => `<option value="${c}">`).join('')}</datalist></label>
        <div class="f">Precio<div class="opts" id="price">${[1, 2, 3, 4].map(n => `<button type="button" data-v="${n}" class="${price === n ? 'on' : ''}">${'€'.repeat(n)}</button>`).join('')}</div></div>
        ${isV ? `
        <label class="f">Fecha de la visita<input type="date" name="date" value="${d.date || ''}"></label>
        <div class="f">Estrellas Michelin<div class="opts" id="stars">${[0, 1, 2, 3].map(n => `<button type="button" data-v="${n}" class="${stars_ === n ? 'on' : ''}">${n ? '★'.repeat(n) : 'Ninguna'}</button>`).join('')}</div></div>
        <div class="f full">Valoración<div class="rate-row"><input type="range" name="rating" min="0" max="10" step="0.5" value="${d.rating || 0}" style="--p:${(d.rating || 0) * 10}%"><output>${(d.rating || 0).toFixed(1)}</output></div></div>
        <label class="f full">Platos destacados (uno por línea)<textarea name="dishes" placeholder="Gamba roja al carbón&#10;Tarta de queso">${esc((d.dishes || []).join('\n'))}</textarea></label>
        <label class="f">Vino / bebida<input name="wine" value="${esc(d.wine)}"></label>
        <label class="f">¿Con quién?<input name="companions" value="${esc(d.companions)}"></label>
        <label class="f full">Notas y recuerdos<textarea name="notes" placeholder="Servicio, ambiente, qué repetirías…">${esc(d.notes)}</textarea></label>`
        : `
        <div class="f">Prioridad<div class="opts" id="prio">${[1, 2, 3].map(n => `<button type="button" data-v="${n}" class="${prio === n ? 'on' : ''}">${'◆'.repeat(n)}</button>`).join('')}</div></div>
        <label class="f">Cuándo / ocasión<input name="target" value="${esc(d.target)}" placeholder="Aniversario, verano 2027…"></label>
        <label class="f full">¿Por qué quiero ir?<textarea name="reason" placeholder="Me lo recomendó… / Salió en…">${esc(d.reason)}</textarea></label>
        <label class="f full">Enlace (web o reservas)<input name="link" type="url" value="${esc(d.link)}" placeholder="https://"></label>`}
        <div class="f full">Fotos
          <div class="thumbs">${pics.map((p, i) => `<div class="thumb" style="background-image:url(${p.url})"><button type="button" data-rm="${i}" aria-label="Quitar">×</button></div>`).join('')}
          <div class="thumb add" id="add-ph">+</div></div>
          <span class="note">Se guardan en tu cuenta (Supabase), privadas: nadie más puede verlas.</span>
          <input type="file" id="ph" accept="image/*" multiple hidden></div>
      </div>
      <div class="m-foot"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn gold" type="submit">${editing ? 'Guardar cambios' : isV ? 'Guardar recuerdo' : 'Añadir a la lista'}</button></div>
    </form>`);
    const f = $('#f');
    $$('.seg button').forEach(b => b.onclick = () => { snapshot(); type = b.dataset.t; paint(); });
    const group = (id, get, set) => $$(`#${id} button`).forEach(b => b.onclick = () => { const v = +b.dataset.v; set(get() === v && id === 'price' ? 0 : v); $$(`#${id} button`).forEach(x => x.classList.toggle('on', +x.dataset.v === get())); });
    group('price', () => price, v => price = v); group('stars', () => stars_, v => stars_ = v); group('prio', () => prio, v => prio = v);
    const r = f.rating; if (r) r.oninput = () => { r.style.setProperty('--p', r.value * 10 + '%'); f.querySelector('output').textContent = (+r.value).toFixed(1); };
    $('#add-ph').onclick = () => $('#ph').click();
    $('#ph').onchange = async e => {
      snapshot(); const files = [...e.target.files]; e.target.value = ''; let bad = 0;
      const tempId = src.id || d.__tempId || (d.__tempId = uid());
      for (const file of files) {
        try { const blob = await shrink(file); const up = await uploadPhoto(tempId, blob); if (up) pics.push(up); else bad++; }
        catch { bad++; }
      }
      if (bad) toast('Alguna foto no se pudo subir (¿formato HEIC o sin conexión?)'); paint();
    };
    $$('[data-rm]').forEach(b => b.onclick = async () => { snapshot(); const [p] = pics.splice(+b.dataset.rm, 1); paint(); if (p) await removePhotoPaths([p.path]); });
    f.onsubmit = async e => { e.preventDefault(); if (busy) return; busy = true; snapshot(); await commit(); busy = false; };
  };
  const commit = async () => {
    const it = { ...d, type, price, stars: stars_, priority: prio, name: d.name.trim(), photos: pics.map(p => p.path) };
    delete it.__promote; delete it.__tempId; if (!it.name) return;
    const keepLatLng = (editing || src.__promote) && (it.city || '') === (src.city || '') && (it.country || '') === (src.country || '');
    if (!keepLatLng) { it.lat = null; it.lng = null; }
    let saved;
    if (editing) { saved = await updateItem(src.id, itemToRow(it)); if (saved) Object.assign(src, saved); }
    else if (src.__promote) { saved = await updateItem(src.id, { ...itemToRow(it), type: 'visited' }); }
    else { saved = await insertItem(it); if (saved) state.items.unshift(saved); }
    if (!saved) return;
    photos[saved.id] = pics.map(p => p.url);
    closeModal(); closeDetail();
    view = saved.type; filters = { q: '', sort: view === 'wish' ? 'prio' : 'date', cuisine: '', fav: false }; setTab(); render();
    toast(src.__promote ? '🍷 ¡Un sueño cumplido!' : editing ? 'Cambios guardados' : '✦ Añadido a tu atlas');
    if (src.__promote || !editing) burst();
    window.scrollTo({ top: 0 });
    if (!saved.lat) geocode(saved).then(ok => ok && updateItem(saved.id, { lat: saved.lat, lng: saved.lng }));
  };
  paint();
}

/* ================= MODAL ================= */
function modal(html) { const r = $('#modal-root'); r.innerHTML = `<div class="modal">${html}</div>`; r.classList.add('open'); r.setAttribute('aria-hidden', 'false'); r.onclick = e => { if (e.target === r || e.target.closest('[data-close]')) closeModal(); }; }
function closeModal() { const r = $('#modal-root'); r.classList.remove('open'); r.innerHTML = ''; r.setAttribute('aria-hidden', 'true'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#lightbox').classList.contains('open')) $('#lightbox').classList.remove('open'); else if ($('#modal-root').classList.contains('open')) closeModal(); else closeDetail(); } });

// Que se sienta como una app, no como una web: sin menú de copiar/compartir
// al mantener pulsado ni arrastrar imágenes (los campos de texto siguen igual).
document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
document.addEventListener('dragstart', e => { if (e.target.tagName === 'IMG') e.preventDefault(); });

/* ================= MAPA ================= */
const geoCache = {};
async function geocode(it) {
  const tries = [[it.name, it.city, it.country], [it.city, it.country]].map(a => a.filter(Boolean).join(', ')).filter(q => q.includes(','));
  for (const q of tries) {
    try {
      if (geoCache[q]) { Object.assign(it, geoCache[q]); return true; }
      const j = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'es' } })).json();
      if (j[0]) { geoCache[q] = { lat: +j[0].lat, lng: +j[0].lon }; Object.assign(it, geoCache[q]); return true; }
    } catch { return false; }
    await new Promise(r => setTimeout(r, 1100));
  }
  return false;
}
function renderMap() {
  $('#view').innerHTML = `<div class="legend reveal"><span><i style="background:var(--gold)"></i>He estado</span><span><i style="background:var(--wine2)"></i>Quiero ir</span><span id="mapnote"></span></div><div id="map" class="reveal"></div>`;
  if (typeof L === 'undefined') { $('#map').innerHTML = '<div class="empty"><h3>El mapa necesita conexión a internet</h3></div>'; return; }
  map = L.map('map', { worldCopyJump: true }).setView([30, 10], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap · © CARTO', maxZoom: 18 }).addTo(map);
  const pts = [];
  const add = it => {
    if (!it.lat || !map) return;
    const ic = L.divIcon({ className: '', html: `<div class="pin ${it.type === 'visited' ? 'v' : 'w'}"></div>`, iconSize: [18, 18] });
    const m = L.marker([it.lat, it.lng], { icon: ic }).addTo(map).bindPopup(`<b>${esc(it.name)}</b><br>${esc([it.city, it.country].filter(Boolean).join(', '))}${it.rating ? '<br>★ ' + it.rating.toFixed(1) : ''}<br><a href="#" data-open="${it.id}" style="color:var(--gold)">Ver ficha →</a>`);
    m.on('popupopen', e => { const a = e.popup.getElement().querySelector('[data-open]'); a.onclick = ev => { ev.preventDefault(); openDetail(it.id); }; });
    pts.push([it.lat, it.lng]);
  };
  state.items.forEach(add);
  if (pts.length) map.fitBounds(pts, { padding: [60, 60], maxZoom: 6 });
  (async () => {
    const missing = state.items.filter(i => !i.lat && (i.city || i.country));
    for (const [n, it] of missing.entries()) {
      if (view !== 'map') return;
      $('#mapnote').textContent = `Localizando ${n + 1}/${missing.length}…`;
      if (await geocode(it)) { add(it); updateItem(it.id, { lat: it.lat, lng: it.lng }); if (pts.length === 1) map?.setView(pts[0], 5); }
    }
    if ($('#mapnote')) $('#mapnote').textContent = '';
    if (map && pts.length > 1) map.fitBounds(pts, { padding: [60, 60], maxZoom: 6 });
  })();
}

/* ================= CIFRAS ================= */
function renderStats() {
  const v = visited();
  if (!v.length) { $('#view').innerHTML = `<div class="empty reveal"><div class="big">📊</div><h3>Aún no hay datos</h3><p>Añade restaurantes visitados para ver tu perfil gastronómico.</p></div>`; return; }
  const tally = fn => { const m = {}; v.forEach(i => { const k = fn(i); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7); };
  const bars = rows => { const mx = Math.max(1, ...rows.map(r => r[1])); return rows.map(([k, n]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><div class="fill" data-w="${n / mx * 100}"></div></div><b>${n}</b></div>`).join(''); };
  const rated = v.filter(i => i.rating), avg = rated.length ? rated.reduce((a, i) => a + i.rating, 0) / rated.length : 0;
  const top = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 5);
  const hist = Array.from({ length: 5 }, (_, k) => [`${k * 2}–${k * 2 + 2}`, rated.filter(i => k === 4 ? i.rating >= 8 : i.rating >= k * 2 && i.rating < k * 2 + 2).length]);
  const years = tally(i => i.date?.slice(0, 4)).sort((a, b) => b[0] - a[0]);
  const mich = v.reduce((a, i) => a + (i.stars || 0), 0), dishes = v.reduce((a, i) => a + (i.dishes?.length || 0), 0);
  $('#view').innerHTML = `<div class="stats">
    <div class="panel reveal"><h3>Nota media</h3><div class="big-ring">${ring(avg, 10, 54, 3, true)}<b>${avg.toFixed(1)}</b><small>sobre 10</small></div></div>
    <div class="panel w8 reveal"><h3>Tu podio</h3><div class="podium">${top.map((i, k) => `<div class="pod" data-open="${i.id}"><span class="n">${k + 1}</span><span class="t">${esc(i.name)}<small>${esc([i.city, i.country].filter(Boolean).join(', '))}</small></span><span class="s">${i.rating.toFixed(1)}</span></div>`).join('') || '<p style="color:var(--muted)">Valora tus visitas para ver tu podio.</p>'}</div></div>
    <div class="panel reveal"><h3>Michelin</h3><div class="mich"><b data-n="${mich}">0</b><span style="color:var(--muted);line-height:1.5">estrellas<br>en ${v.filter(i => i.stars).length} restaurantes</span></div><p style="margin-top:1.4rem;color:var(--muted)"><b style="color:var(--gold2);font-family:var(--serif);font-size:1.8rem;font-weight:300">${dishes}</b> platos memorables anotados</p></div>
    <div class="panel w8 reveal"><h3>Cocinas</h3>${bars(tally(i => i.cuisine))}</div>
    <div class="panel reveal"><h3>Países</h3>${bars(tally(i => i.country))}</div>
    <div class="panel reveal"><h3>Ciudades</h3>${bars(tally(i => i.city))}</div>
    <div class="panel reveal"><h3>Precio</h3>${bars(tally(i => i.price && '€'.repeat(i.price)).sort((a, b) => a[0].length - b[0].length))}</div>
    <div class="panel reveal"><h3>Notas</h3>${bars(hist)}</div>
    ${years.length ? `<div class="panel w8 reveal"><h3>Por año</h3>${bars(years)}</div>` : ''}</div>`;
  $$('[data-open]').forEach(p => p.onclick = () => openDetail(p.dataset.open));
  $$('[data-n]').forEach(b => countUp(b, +b.dataset.n));
  const go = () => { $$('.fill').forEach(f => f.style.width = f.dataset.w + '%'); $$('.stats .rf').forEach(r => r.style.strokeDashoffset = r.dataset.off); };
  setTimeout(go, 400);
}

/* ================= DATOS ================= */
function dataMenu() {
  modal(`<div class="m-head"><h2>Tus datos</h2><button class="x" data-close>×</button></div><div class="m-body">
    <p style="color:var(--muted);line-height:1.7;margin-bottom:1.6rem">Todo vive en tu cuenta (${esc(session?.user?.email || '')}), no en este dispositivo. Exporta una copia de seguridad cuando quieras.</p>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap"><button class="btn gold" id="exp">Exportar copia</button><button class="btn ghost" id="imp">Importar copia</button>
    <button class="btn danger" id="wipe">Borrar todo</button></div>
    <div style="margin-top:1.6rem;padding-top:1.4rem;border-top:1px solid var(--line)"><button class="btn ghost sm" id="signout">Cerrar sesión</button></div></div>`);
  $('#exp').onclick = async () => {
    toast('Preparando copia…');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' })); a.download = `atlas-gourmet-${today()}.json`; a.click();
  };
  $('#imp').onclick = () => $('#import-file').click();
  $('#wipe').onclick = async () => {
    if (!confirm('¿Borrar TODOS los datos y fotos de tu cuenta? No se puede deshacer.')) return;
    const paths = state.items.flatMap(i => i.photos || []);
    if (paths.length) await removePhotoPaths(paths);
    await sb.from('items').delete().eq('user_id', session.user.id);
    state = { items: [] }; Object.keys(photos).forEach(k => delete photos[k]);
    closeModal(); render();
  };
  $('#signout').onclick = async () => { await sb.auth.signOut(); };
}
$('#import-file').onchange = async e => {
  try {
    const j = JSON.parse(await e.target.files[0].text()); if (!Array.isArray(j.items)) throw 0;
    const have = new Set(state.items.map(i => i.id));
    for (const i of j.items) {
      if (!i?.name || have.has(i.id)) continue;
      const row = itemToRow(i); row.photos = []; // las fotos del archivo importado no se migran: pertenecen a otra cuenta
      const saved = await insertItem(row); if (saved) state.items.unshift(saved);
    }
    closeModal(); render(); toast('Importación completada');
  } catch { toast('Archivo no válido'); }
  e.target.value = '';
};
/* ================= NAVEGACIÓN ================= */
function moveInk() { const a = $('.tab.active'), ink = $('#ink'); if (a) { ink.style.left = a.offsetLeft + 'px'; ink.style.width = a.offsetWidth + 'px'; } }
function setTab() { $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view)); moveInk(); }
function go(v) { view = v; filters = { q: '', sort: v === 'wish' ? 'prio' : 'date', cuisine: '', fav: false }; setTab(); closeDetail(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
$$('.tab').forEach(t => t.onclick = () => go(t.dataset.view));
$$('#bottom [data-view]').forEach(b => b.onclick = () => go(b.dataset.view));
$('#brand').onclick = e => { e.preventDefault(); go('visited'); };
$('#btn-add').onclick = $('#bn-add').onclick = () => openForm({ type: view === 'wish' ? 'wish' : 'visited' });
$('#btn-data').onclick = dataMenu;
addEventListener('resize', moveInk);
document.fonts?.ready.then(moveInk);
addEventListener('scroll', () => {
  const y = scrollY; $('#top').classList.toggle('solid', y > 60);
  const h = $('#hero-in'); if (y < innerHeight) { h.style.transform = `translateY(${y * .25}px)`; h.style.opacity = Math.max(0, 1 - y / (innerHeight * .75)); }
}, { passive: true });

/* ================= FONDO CINEMATOGRÁFICO (bokeh + brasas) ================= */
const PAL = { visited: [[255, 160, 50], [214, 110, 40], [255, 205, 130]], wish: [[196, 50, 82], [235, 105, 125], [255, 160, 140]], map: [[60, 150, 160], [217, 180, 106], [100, 110, 190]], stats: [[217, 180, 106], [160, 80, 170], [255, 190, 120]] };
const cv = $('#bg'), cx = cv.getContext('2d');
let W, H, mx = .5, my = .5, target = PAL.visited;
const bokeh = Array.from({ length: 22 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 90 + Math.random() * 230, vx: (Math.random() - .5) * .00006, vy: (Math.random() - .5) * .00006, ph: Math.random() * 7, c: [...PAL.visited[i % 3]], k: i % 3, z: .3 + Math.random() }));
const embers = Array.from({ length: 50 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + .4, v: Math.random() * .00028 + .00007, ph: Math.random() * 7, dx: Math.random() * .00006 }));
function fit() { W = cv.width = Math.ceil(innerWidth / 2); H = cv.height = Math.ceil(innerHeight / 2); }
addEventListener('resize', fit); fit();
function setPalette() { target = PAL[view]; }
addEventListener('pointermove', e => { mx = e.clientX / innerWidth; my = e.clientY / innerHeight; }, { passive: true });
let t0 = 0;
function frame(t) {
  const dt = Math.min(50, t - t0); t0 = t;
  cx.globalCompositeOperation = 'source-over'; cx.fillStyle = '#080706'; cx.fillRect(0, 0, W, H);
  cx.globalCompositeOperation = 'lighter';
  for (const b of bokeh) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.ph += dt * .0006;
    if (b.x < -.2) b.x = 1.2; if (b.x > 1.2) b.x = -.2; if (b.y < -.2) b.y = 1.2; if (b.y > 1.2) b.y = -.2;
    for (let i = 0; i < 3; i++) b.c[i] += (target[b.k][i] - b.c[i]) * .02;
    const px = (b.x + (mx - .5) * .05 * b.z) * W, py = (b.y + (my - .5) * .05 * b.z) * H, r = b.r / 2 * (1 + Math.sin(b.ph) * .08);
    const a = .13 + Math.sin(b.ph * 1.3) * .04;
    const g = cx.createRadialGradient(px, py, 0, px, py, r);
    const col = `${b.c[0] | 0},${b.c[1] | 0},${b.c[2] | 0}`;
    g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(.55, `rgba(${col},${a * .55})`); g.addColorStop(.62, `rgba(${col},${a * .8})`); g.addColorStop(.7, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0)`);
    cx.fillStyle = g; cx.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (const e of embers) {
    e.y -= e.v * dt; e.x += e.dx * dt + Math.sin(e.ph += dt * .001) * .00008; if (e.y < -.02) { e.y = 1.02; e.x = Math.random(); }
    cx.fillStyle = `rgba(255,220,160,${.3 + Math.sin(e.ph * 3) * .25})`; cx.beginPath(); cx.arc(e.x * W, e.y * H, e.r, 0, 7); cx.fill();
  }
  requestAnimationFrame(frame);
}
if (matchMedia('(prefers-reduced-motion:reduce)').matches) { frame(0); } else requestAnimationFrame(frame);
let bursts = [];
function burst() {
  const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;inset:0;z-index:150;pointer-events:none;width:100%;height:100%'; c.width = innerWidth; c.height = innerHeight; document.body.append(c);
  const g = c.getContext('2d'); bursts = Array.from({ length: 140 }, (_, i) => ({ x: innerWidth / 2, y: innerHeight / 2, vx: (Math.random() - .5) * 16, vy: Math.random() * -13 - 2, l: 1, c: ['#f6e2b0', '#d9b46a', '#d4566b'][i % 3] }));
  (function f() { g.clearRect(0, 0, c.width, c.height); bursts.forEach(b => { b.x += b.vx; b.y += b.vy; b.vy += .18; b.l -= .012; g.globalAlpha = Math.max(0, b.l); g.fillStyle = b.c; g.fillRect(b.x, b.y, 4, 4); }); bursts = bursts.filter(b => b.l > 0); bursts.length ? requestAnimationFrame(f) : c.remove(); })();
}

/* ================= SESIÓN ================= */
let booted = false;
async function boot() {
  if (booted) return; booted = true;
  await fetchItems();
  await loadPhotos();
  render();
}
function showGate(msg) {
  $('#gate').classList.add('show'); $('#gate').setAttribute('aria-hidden', 'false');
  if (msg) { const n = $('#gate-note'); n.textContent = msg; n.classList.add('err'); }
}
function hideGate() { $('#gate').classList.remove('show'); $('#gate').setAttribute('aria-hidden', 'true'); }
// Cuenta única de administrador: el email va fijo en el código, el usuario solo ve una contraseña.
const ADMIN_EMAIL = 'ivanmoyro+gourmet@gmail.com';
$('#gate-form').onsubmit = async e => {
  e.preventDefault();
  const password = $('#gate-pass').value; if (password.length < 6) return;
  const btn = $('#gate-submit'); btn.disabled = true; btn.textContent = 'Entrando…';
  const n = $('#gate-note'); n.textContent = ''; n.classList.remove('err');
  let { error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
  if (error) {
    // Primera vez: la cuenta aún no existe → se crea con esta misma contraseña.
    const su = await sb.auth.signUp({ email: ADMIN_EMAIL, password });
    error = su.error && su.error.message !== 'User already registered' ? su.error : (su.data.session ? null : { message: 'Contraseña incorrecta.' });
  }
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { n.classList.add('err'); n.textContent = error.message === 'Invalid login credentials' ? 'Contraseña incorrecta.' : error.message; }
  // con sesión, onAuthStateChange oculta la puerta y carga los datos.
};
sb.auth.onAuthStateChange((event, s) => {
  session = s;
  if (s) { hideGate(); boot(); }
  else if (event !== 'INITIAL_SESSION') { booted = false; state = { items: [] }; Object.keys(photos).forEach(k => delete photos[k]); showGate(); }
});
sb.auth.getSession().then(({ data }) => { session = data.session; if (session) boot(); else showGate(); });

// Cada vez que se abre la app (o se vuelve a ella) se busca una versión nueva
// del propio service worker. Cuando la encuentra, se recarga sola para mostrarla
// — así nunca hace falta explicarle al usuario cómo "forzar" la actualización.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      reg.update();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
    }).catch(() => { });
  });
}

// Red de seguridad: si algo falla (p.ej. una versión vieja en caché de este archivo
// desajustada con el HTML nuevo), muestra un aviso con botón de recargar en vez de
// dejar la pantalla en blanco sin explicación.
function showFatal(msg) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:999;display:grid;place-items:center;background:rgba(5,4,3,.92);color:#f4ede2;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:2rem';
  d.innerHTML = `<div style="max-width:420px"><p style="margin-bottom:1rem">⚠ Algo no cargó bien.<br><small style="opacity:.6">${msg}</small></p><button style="padding:.8rem 1.6rem;border-radius:999px;background:#d9b46a;color:#1a1208;border:0;font-weight:600;cursor:pointer" onclick="location.reload(true)">Recargar</button></div>`;
  document.body.append(d);
}
addEventListener('error', e => showFatal(e.message || 'error'));
addEventListener('unhandledrejection', e => showFatal(e.reason?.message || String(e.reason)));
