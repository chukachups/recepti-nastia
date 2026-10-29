(() => {
  'use strict';

  /* ---------- замок ----------
     Локально recipes.js подключён открытым текстом. В опубликованной копии рецепты и фото
     зашифрованы (AES-GCM, ключ из пароля через PBKDF2), без пароля виден только экран ввода. */
  const KEY_STORE = 'recipes.key';
  let KEY = null;
  const b64 = { to: (u8) => btoa(String.fromCharCode(...u8)), from: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
  async function decryptBuf(buf, key) {
    const u8 = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, key, u8.slice(12));
  }
  async function loadData(key) {
    const res = await fetch('assets/data.bin', { cache: 'no-cache' });
    const plain = await decryptBuf(await res.arrayBuffer(), key);
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function unlock() {
    const lock = document.getElementById('lock');
    try {
      const raw = localStorage.getItem(KEY_STORE);
      if (raw) {
        const key = await crypto.subtle.importKey('raw', b64.from(raw), 'AES-GCM', true, ['decrypt']);
        const data = await loadData(key);
        return [data, key];
      }
    } catch (e) { try { localStorage.removeItem(KEY_STORE); } catch (e2) { /* нет хранилища */ } }
    lock.hidden = false;
    const form = lock.querySelector('form'), input = lock.querySelector('input'), err = lock.querySelector('.lock__err');
    input.focus();
    const meta = await (await fetch('assets/lock.json', { cache: 'no-cache' })).json();
    return new Promise((done) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = 'Проверяю…';
        try {
          const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(input.value.trim()), 'PBKDF2', false, ['deriveKey']);
          const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64.from(meta.salt), iterations: meta.iter, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
          const data = await loadData(key);
          try { localStorage.setItem(KEY_STORE, b64.to(new Uint8Array(await crypto.subtle.exportKey('raw', key)))); } catch (e2) { /* без запоминания */ }
          lock.hidden = true;
          done([data, key]);
        } catch (e2) {
          err.textContent = 'Пароль не подошёл'; input.select();
        }
      });
    });
  }

  /* фото: локально — как есть, в зашифрованной копии — расшифровываются, когда показываются на экране */
  const blobs = new Map();
  async function photoURL(path) {
    if (!KEY || path.startsWith('blob:')) return path;
    if (!blobs.has(path)) {
      blobs.set(path, fetch(path.replace(/\.webp$/, '.bin')).then((r) => r.arrayBuffer()).then((b) => decryptBuf(b, KEY))
        .then((p) => URL.createObjectURL(new Blob([p], { type: 'image/webp' }))));
    }
    return blobs.get(path);
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target); show(e.target);
  }), { rootMargin: '400px' }) : null;
  function show(img) { photoURL(img.dataset.src).then((u) => { img.src = u; }).catch(() => {}); }
  function hydrate(root) {
    root.querySelectorAll('img[data-src]:not([src])').forEach((img) => (io && KEY ? io.observe(img) : show(img)));
  }

  /* свои фото к рецептам: хранятся в IndexedDB этого браузера (на другие устройства не попадают) */
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, no) => {
    const q = indexedDB.open('recipes', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('photos');
    q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
  }));
  const idb = (mode, fn) => db().then((d) => new Promise((ok, no) => {
    const tx = d.transaction('photos', mode), q = fn(tx.objectStore('photos'));
    tx.oncomplete = () => ok(q && q.result); tx.onerror = () => no(tx.error);
  }));
  async function loadMine() {
    const [keys, vals] = await Promise.all([idb('readonly', (s) => s.getAllKeys()), idb('readonly', (s) => s.getAll())]);
    return new Map(keys.map((k, n) => [k, vals[n]]));
  }
  function shrink(file, max = 1400) {
    return new Promise((ok, no) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(u); no(new Error('не картинка')); };
      img.src = u;
    });
  }

function start(ALL, myPhotos) {
  const CATS = [
    { id: 'breakfast', name: 'Завтраки', c: '#f6d68b' },
    { id: 'hot', name: 'Горячее', c: '#ee9f7c' },
    { id: 'dinner', name: 'Ужины', c: '#c3c6e8' },
    { id: 'soup', name: 'Супы', c: '#f2c27a' },
    { id: 'salad', name: 'Салаты', c: '#bcd9a3' },
    { id: 'snack', name: 'Перекусы и закуски', c: '#dcc8a6' },
    { id: 'dessert', name: 'Десерты', c: '#f3bccb' },
    { id: 'bakery', name: 'Выпечка', c: '#e9c99f' },
    { id: 'cake', name: 'Торты', c: '#e7a9b8' },
    { id: 'sauce', name: 'Соусы', c: '#f5a98a' },
    { id: 'preserve', name: 'Заготовки', c: '#c9dbb3' },
    { id: 'drink', name: 'Напитки', c: '#acd5da' },
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const HINTS = {
    all: 'Всё вместе, по разделам. Нажмите на рецепт, чтобы открыть ингредиенты и шаги.',
    breakfast: 'Сырники, омлеты, каши, оладьи и тосты.',
    hot: 'Обеды и ужины: мясо, птица, рыба, котлеты, паста.',
    dinner: 'Белковые ужины: из сборников «Белковые ужины» и «Ужины на 50 г белка».',
    soup: 'Супы, крем-супы и холодные супы.',
    salad: 'Салаты на каждый день, тёплые и праздничные.',
    snack: 'Перекусы, закуски, брускетты, роллы и намазки.',
    dessert: 'Пудинги, муссы, конфеты, мороженое — всё сладкое без духовки и не только.',
    bakery: 'Пироги, кексы, булочки, печенье и хлеб.',
    cake: 'Торты и чизкейки.',
    sauce: 'Соусы, подливы, заправки и начинки.',
    preserve: 'Маринады, квашения и засолки.',
    drink: 'Смузи и коктейли.',
  };
  // сборники целиком в своём разделе (по источнику; второй раздел, например «Завтраки», сохраняется)
  const SRC_CAT = { 'Белковые ужины': 'dinner', 'Ужины на 50 г белка @valeryrodimova': 'dinner' };
  ALL.forEach((r) => { const c = SRC_CAT[r.s]; if (c) { r.c = c; if (r.cs) r.cs = r.cs.filter((x) => x !== c); } });
  const TAGS = ['курица', 'индейка', 'мясо', 'рыба', 'морепродукты', 'творог', 'яйца', 'овощи', 'грибы', 'крупы', 'паста'];
  const PAGE = 48;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
  const fmt = (n) => String(n).replace('.', ',');
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };
  // избранное: своё с этого устройства + отмеченное на сайте (fv), кроме снятого здесь
  const ids = new Set(ALL.map((r) => r.id));
  const unfav = new Set(store.get('recipes.unfav', []));
  const baked = new Set(ALL.filter((r) => r.fv).map((r) => r.id));
  const favs = new Set([...store.get('recipes.favs', []), ...[...baked].filter((id) => !unfav.has(id))]);
  const saveFavs = () => {
    baked.forEach((id) => (favs.has(id) ? unfav.delete(id) : unfav.add(id)));
    store.set('recipes.favs', [...favs].filter((id) => !baked.has(id))); store.set('recipes.unfav', [...unfav]);
  };
  const gone = new Set(store.get('recipes.deleted', []).filter((id) => ids.has(id)));  // уже удалённые с сайта не считаем
  const saveGone = () => store.set('recipes.deleted', [...gone]);
  const mine = new Map([...myPhotos].map(([id, b]) => [id, URL.createObjectURL(b)]));
  const myBlobs = new Map(myPhotos);
  const pic = (r) => mine.get(r.id) || r.img;
  const inCat = (r, c) => r.c === c || (r.cs && r.cs.includes(c));
  // свои правки поверх данных сайта: ПП/обычный и КБЖУ; совпавшие с сайтом (уже перенесённые) забываем
  const ppMine = store.get('recipes.pp', {}), kMine = store.get('recipes.kbju', {});
  ALL.forEach((r) => { r._pp = !!r.pp; r._k = r.k; r._kp = r.kp; });
  const sameK = (a, b) => !!a && !!b && ['k', 'b', 'j', 'u', 'p'].every((f) => a[f] === b[f]);
  function applyMine() {
    const by = new Map(ALL.map((r) => [r.id, r]));
    ALL.forEach((r) => { r.pp = r._pp; r.k = r._k; r.kp = r._kp; });
    Object.entries(ppMine).forEach(([id, v]) => { const r = by.get(+id); if (!r || !!v === r._pp) delete ppMine[id]; else r.pp = !!v; });
    Object.entries(kMine).forEach(([id, v]) => {
      const r = by.get(+id);
      if (!r || sameK(v, r._k && { ...r._k, p: r._kp })) { delete kMine[id]; return; }
      r.k = { k: v.k, b: v.b, j: v.j, u: v.u }; r.kp = v.p;
    });
    store.set('recipes.pp', ppMine); store.set('recipes.kbju', kMine);
  }
  applyMine();
  // «приготовить на этой неделе» — план только для этого устройства
  const week = new Set(store.get('recipes.week', []).filter((id) => ids.has(id)));
  const saveWeek = () => store.set('recipes.week', [...week]);

  ALL.forEach((r) => { r._q = norm(r.t + ' ' + r.i.join(' ') + ' ' + (r.u ? r.w : '')); r._t = norm(r.t); });
  const byId = new Map(ALL.map((r) => [r.id, r]));

  const DEFAULT = { cat: 'all', mode: 'all', q: '', tag: '', src: '', photo: false, k: false, fav: false, week: false, trash: false, sort: 'photo' };
  const state = { ...DEFAULT, mode: store.get('recipes.mode', 'all'), shown: PAGE };
  let list = [];
  let seed = Math.random();

  /* ---------- плакат ---------- */
  const setCount = (k, v) => document.querySelectorAll(`[data-count="${k}"]`).forEach((el) => { el.textContent = v; });
  function drawCounts() {
    setCount('all', ALL.length);
    setCount('pp', ALL.filter((r) => r.pp).length);
    setCount('reg', ALL.filter((r) => !r.pp).length);
    setCount('kbju', ALL.filter((r) => r.k).length);
  }
  drawCounts();

  const withPhoto = ALL.filter((r) => pic(r) && r.c !== 'sauce' && !gone.has(r.id));
  const hero = $('#heroPlates');
  for (let n = 0; n < 3 && withPhoto.length; n++) {
    const r = withPhoto[Math.floor(Math.random() * withPhoto.length)];
    const b = document.createElement('button');
    b.type = 'button'; b.title = r.t; b.setAttribute('aria-label', r.t);
    b.innerHTML = `<img data-src="${pic(r)}" alt="">`;
    b.addEventListener('click', () => openSheet(r.id, [r.id]));
    hero.appendChild(b);
  }
  hydrate(hero);

  /* ---------- разделы ---------- */
  const catsIn = $('#catsIn');
  function drawCats() {
    const base = ALL.filter((r) => modeOk(r));
    const cnt = {}; base.forEach((r) => [r.c, ...(r.cs || [])].forEach((c) => { cnt[c] = (cnt[c] || 0) + 1; }));
    const items = [{ id: 'all', name: 'Все', c: 'var(--ink)' }, ...CATS.filter((c) => cnt[c.id])];
    catsIn.innerHTML = items.map((c) => `<button type="button" data-cat="${c.id}" aria-pressed="${state.cat === c.id}"><i style="--c:${c.c}"></i>${c.name}<sup>${c.id === 'all' ? base.length : cnt[c.id]}</sup></button>`).join('');
  }
  catsIn.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]'); if (!b) return;
    state.cat = b.dataset.cat; state.shown = PAGE;
    drawCats(); render(true);
  });
  const cats = $('#cats');
  const edge = () => {
    cats.classList.toggle('more-l', catsIn.scrollLeft > 4);
    cats.classList.toggle('more-r', catsIn.scrollLeft + catsIn.clientWidth < catsIn.scrollWidth - 4);
  };
  catsIn.addEventListener('scroll', edge, { passive: true });
  addEventListener('resize', edge);

  /* ---------- ПП / обычные ---------- */
  const modeEl = $('#mode');
  function drawMode() { modeEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === state.mode)); }
  modeEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]'); if (!b) return;
    state.mode = b.dataset.m; store.set('recipes.mode', state.mode); state.shown = PAGE;
    drawMode(); drawCats(); drawTags(); render(true);
  });
  // удалённые рецепты видны только в «Удалённых»
  function modeOk(r) { return state.trash === gone.has(r.id) && (state.mode === 'all' || (state.mode === 'pp' ? r.pp : !r.pp)); }

  /* ---------- фильтры ---------- */
  const tagsEl = $('#tags');
  function drawTags() {
    const base = ALL.filter((r) => modeOk(r) && (state.cat === 'all' || inCat(r, state.cat)));
    const cnt = {}; base.forEach((r) => r.tg.forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; }));
    tagsEl.innerHTML = TAGS.filter((t) => cnt[t]).map((t) => `<button type="button" data-tag="${t}" aria-pressed="${state.tag === t}">${t}<small>${cnt[t]}</small></button>`).join('');
  }
  tagsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tag]'); if (!b) return;
    state.tag = state.tag === b.dataset.tag ? '' : b.dataset.tag; state.shown = PAGE;
    drawTags(); render(true);
  });
  const srcSel = $('#src');
  const srcCount = {}; ALL.forEach((r) => { srcCount[r.s] = (srcCount[r.s] || 0) + 1; });
  Object.keys(srcCount).sort((a, b) => a.localeCompare(b, 'ru')).forEach((s) => {
    const o = document.createElement('option'); o.value = s; o.textContent = `${s} · ${srcCount[s]}`; srcSel.appendChild(o);
  });
  srcSel.addEventListener('change', () => { state.src = srcSel.value; state.shown = PAGE; render(true); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; seed = Math.random(); state.shown = PAGE; render(true); });
  const toggle = (id, key) => $(id).addEventListener('click', (e) => {
    state[key] = !state[key]; e.currentTarget.setAttribute('aria-pressed', state[key]); state.shown = PAGE; render(true);
  });
  toggle('#fPhoto', 'photo'); toggle('#fK', 'k'); toggle('#fFav', 'fav'); toggle('#fWeek', 'week');
  const trashBtn = $('#fTrash');
  function drawTrash() {
    trashBtn.hidden = !gone.size && !state.trash;
    trashBtn.querySelector('small').textContent = gone.size || '';
    trashBtn.setAttribute('aria-pressed', state.trash);
  }
  const weekBtn = $('#fWeek');
  function drawWeek() {
    weekBtn.querySelector('small').textContent = week.size || '';
    weekBtn.setAttribute('aria-pressed', state.week);
  }
  $('#weekClear').addEventListener('click', () => {
    if (!confirm('Снять все отметки «на этой неделе»?')) return;
    week.clear(); saveWeek(); drawWeek(); render(false);
  });
  trashBtn.addEventListener('click', () => {
    state.trash = !state.trash; state.shown = PAGE;
    drawTrash(); drawCats(); drawTags(); render(true);
  });
  function resetAll() {
    Object.assign(state, DEFAULT, { shown: PAGE }); store.set('recipes.mode', state.mode);
    $('#q').value = ''; srcSel.value = ''; $('#sort').value = state.sort;
    ['#fPhoto', '#fK', '#fFav', '#fWeek'].forEach((id) => $(id).setAttribute('aria-pressed', 'false'));
    drawMode(); drawTrash(); drawWeek(); drawCats(); drawTags(); render(true);
  }
  document.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', resetAll));

  /* ---------- «Мои изменения»: код и файл для переноса на сайт ---------- */
  const share = $('#share'), mineBtn = $('#fMine');
  const changes = () => ({
    d: [...gone], f: [...favs].filter((id) => !baked.has(id)), u: [...unfav], p: [...myBlobs.keys()],
    pp: { ...ppMine }, k: { ...kMine },
  });
  const ppOn = (c) => Object.values(c.pp).filter(Boolean).length, ppOff = (c) => Object.values(c.pp).filter((v) => !v).length;
  const kN = (c) => Object.keys(c.k).length;
  const total = (c) => c.d.length + c.f.length + c.u.length + c.p.length + ppOn(c) + ppOff(c) + kN(c);
  const pack = (c) => ({ v: 2, d: c.d, f: c.f, u: c.u, pp: c.pp, k: c.k });
  // btoa понимает только латиницу, а в КБЖУ есть «100 г» — кодируем через UTF-8
  const toCode = (c) => 'РЕЦЕПТЫ:' + b64.to(new TextEncoder().encode(JSON.stringify(pack(c))));
  function drawMine() {
    const n = total(changes());
    mineBtn.hidden = !n; mineBtn.querySelector('small').textContent = n || '';
  }
  function openShare() {
    const c = changes();
    const part = [[c.d.length, 'удалено'], [c.f.length, 'в любимых'], [c.u.length, 'убрано из любимых'], [ppOn(c), 'перенесено в ПП'],
      [ppOff(c), 'убрано из ПП'], [kN(c), 'с моим КБЖУ'], [c.p.length, 'своих фото']]
      .filter(([n]) => n).map(([n, w]) => `${w}: ${n}`);
    $('#shareSum').textContent = part.length ? part.join(' · ') : 'Изменений пока нет.';
    $('#shareCode').value = total(c) - c.p.length ? toCode(c) : '';
    $('#shareCode').hidden = !$('#shareCode').value;
    $('#shareSend').hidden = $('#shareCopy').hidden = !$('#shareCode').value;
    $('#shareFile').hidden = !c.p.length;
    $('#shareMsg').textContent = '';
    share.showModal();
  }
  mineBtn.addEventListener('click', openShare);
  const say = (t) => { $('#shareMsg').textContent = t; };
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = $('#shareCode'); ta.select();
      try { return document.execCommand('copy'); } catch (e2) { return false; }
    }
  }
  $('#shareCopy').addEventListener('click', async () => {
    say(await copy($('#shareCode').value) ? 'Код скопирован. Вставьте его в чат с Claude.' : 'Не получилось скопировать: выделите код и скопируйте вручную.');
  });
  $('#shareSend').addEventListener('click', async () => {
    const text = $('#shareCode').value;
    if (navigator.share) { try { await navigator.share({ title: 'Книга рецептов: изменения', text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    say(await copy(text) ? 'Код скопирован. Вставьте его в чат с Claude.' : 'Выделите код и скопируйте вручную.');
  });
  const asData = (b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
  $('#shareFile').addEventListener('click', async () => {
    say('Собираю файл…');
    const c = changes(), p = {};
    for (const id of c.p) p[id] = await asData(myBlobs.get(id));
    const name = `recepty-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([JSON.stringify({ ...pack(c), p })], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Книга рецептов: изменения' }); say('Готово.'); return; } catch (e) { if (e.name === 'AbortError') { say(''); return; } }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    say(`Файл ${name} сохранён в «Загрузки». Пришлите его Claude.`);
  });
  $('#shareClear').addEventListener('click', async () => {
    if (!confirm('Очистить удаления, любимые, ПП, КБЖУ и свои фото на этом устройстве?\nСделайте это, когда Claude уже перенёс их на сайт.')) return;
    gone.clear(); saveGone(); favs.clear(); unfav.clear(); baked.forEach((id) => favs.add(id)); saveFavs();
    Object.keys(ppMine).forEach((id) => delete ppMine[id]); Object.keys(kMine).forEach((id) => delete kMine[id]); applyMine(); drawCounts();
    await idb('readwrite', (s) => s.clear()).catch(() => {});
    mine.forEach((u) => URL.revokeObjectURL(u)); mine.clear(); myBlobs.clear();
    share.close(); state.trash = false;
    drawTrash(); drawMine(); drawCats(); drawTags(); render(false);
  });
  const moreBtn = $('#moreBtn');
  moreBtn.addEventListener('click', () => {
    const open = $('#filters').classList.toggle('is-open'); moreBtn.setAttribute('aria-expanded', open);
  });
  let qTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = norm(e.target.value.trim()); state.shown = PAGE; render(true); }, 120);
  });

  /* ---------- список ---------- */
  const wall = $('#wall');
  const rnd = (id) => { const x = Math.sin(id * 9301 + seed * 49297) * 233280; return x - Math.floor(x); };
  function filtered() {
    const words = state.q ? state.q.split(/\s+/) : [];
    let res = ALL.filter((r) => modeOk(r)
      && (state.cat === 'all' || inCat(r, state.cat))
      && (!state.tag || r.tg.includes(state.tag))
      && (!state.src || r.s === state.src)
      && (!state.photo || pic(r)) && (!state.k || r.k) && (!state.fav || favs.has(r.id)) && (!state.week || week.has(r.id))
      && words.every((w) => r._q.includes(w)));
    const order = (a, b) => {
      if (state.sort === 'photo' && !!pic(b) !== !!pic(a)) return pic(b) ? 1 : -1;
      if (state.sort === 'kcal') { const ka = a.k ? a.k.k : 1e9, kb = b.k ? b.k.k : 1e9; if (ka !== kb) return ka - kb; }
      if (state.sort === 'rand') return rnd(a.id) - rnd(b.id);
      if (words.length) { const sa = a._t.includes(words[0]) ? 0 : 1, sb = b._t.includes(words[0]) ? 0 : 1; if (sa !== sb) return sa - sb; }
      return a.id - b.id;
    };
    if (state.cat === 'all' && (state.sort === 'az' || state.sort === 'photo') && !words.length) {
      const pos = Object.fromEntries(CATS.map((c, n) => [c.id, n]));
      res.sort((a, b) => (pos[a.c] - pos[b.c]) || order(a, b));
    } else res.sort(order);
    return res;
  }

  function card(r) {
    const cat = CAT[r.c] || CATS[1];
    const plate = pic(r)
      ? `<img data-src="${pic(r)}" alt="" decoding="async">`
      : `<span class="blank"><b>${esc(r.t.replace(/[«"]/g, '')[0] || '?')}</b><small>${cat.name}</small></span>`;
    const kc = r.k ? `<span class="peek">${fmt(r.k.k)} ккал${r.kp === '100 г' ? ' / 100 г' : ''}</span>` : '';
    return `<button type="button" class="card" data-id="${r.id}">
      <span class="card__plate" style="--c:${cat.c}">${plate}${r.pp ? '<span class="stamp" title="ПП">ПП</span>' : ''}${favs.has(r.id) || week.has(r.id) ? `<span class="marks">${favs.has(r.id) ? '<span class="heart" aria-label="В любимых">♥</span>' : ''}${week.has(r.id) ? '<span class="wk" title="Приготовить на этой неделе" aria-label="На этой неделе">🗓</span>' : ''}</span>` : ''}${kc}</span>
      <span class="card__body"><span class="card__src">${esc(r.s)}</span><span class="card__name">${esc(r.t)}</span>
      <span class="card__meta">${r.i.filter((x) => !x.startsWith('# ')).length} ингр. · ${r.st.filter((x) => !x.startsWith('# ')).length} ${plural(r.st.length, 'шаг', 'шага', 'шагов')}</span></span>
    </button>`;
  }

  function render(resetScroll) {
    list = filtered();
    const cat = CAT[state.cat];
    $('#listTitle').textContent = state.trash ? 'Удалённые' : state.week ? 'На этой неделе' : state.fav ? 'Любимые' : cat ? cat.name : (state.mode === 'pp' ? 'ПП-рецепты' : state.mode === 'reg' ? 'Обычные рецепты' : 'Все рецепты');
    $('#listCount').textContent = list.length;
    $('#listHint').textContent = state.trash ? 'Рецепт можно вернуть: откройте его и нажмите «Вернуть рецепт».'
      : state.week ? 'Что готовим на этой неделе. Отметку можно снять в рецепте.' : HINTS[state.cat] || '';
    $('#weekClear').hidden = !state.week || !week.size;
    $('#resetBtn').hidden = Object.keys(DEFAULT).every((k) => state[k] === DEFAULT[k]);
    const part = list.slice(0, state.shown);
    let html = '', grp = '';
    const grouped = state.cat === 'all' && (state.sort === 'az' || state.sort === 'photo') && !state.q;
    const gcount = {}; if (grouped) list.forEach((r) => { gcount[r.c] = (gcount[r.c] || 0) + 1; });
    part.forEach((r) => {
      if (grouped && r.c !== grp) { grp = r.c; const c = CAT[grp]; html += `<p class="wall__group"><i style="--c:${c.c}"></i>${c.name} <em>${gcount[grp]}</em></p>`; }
      html += card(r);
    });
    wall.innerHTML = html;
    hydrate(wall);
    $('#none').hidden = list.length > 0;
    $('#moreCards').hidden = list.length <= state.shown;
    $('#moreCards').textContent = `Показать ещё · осталось ${list.length - state.shown}`;
    const set = !!(state.tag || state.src);
    moreBtn.classList.toggle('is-set', set);
    if (resetScroll) {
      const top = $('.tools').getBoundingClientRect().top + scrollY - 140;
      if (scrollY > top) scrollTo({ top, behavior: 'auto' });
    }
    edge();
  }
  $('#moreCards').addEventListener('click', () => { state.shown += PAGE * 2; render(false); });
  wall.addEventListener('click', (e) => {
    const b = e.target.closest('.card'); if (!b) return;
    openSheet(+b.dataset.id, list.map((r) => r.id));
  });

  /* ---------- окно рецепта ---------- */
  const sheet = $('#sheet');
  let seq = [], pos = -1, lastFocus = null;
  function openSheet(id, ids) {
    seq = ids; pos = seq.indexOf(id);
    if (sheet.hidden) lastFocus = document.activeElement;
    fill(byId.get(id));
    sheet.hidden = false; document.body.classList.add('is-locked');
    history.replaceState(null, '', '#r' + id);
    $('.sheet__x', sheet).focus({ preventScroll: true });
  }
  function closeSheet() {
    sheet.hidden = true; document.body.classList.remove('is-locked');
    history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  function fill(r) {
    const cat = CAT[r.c] || CATS[1];
    const card = $('.sheet__card', sheet);
    card.style.setProperty('--c', cat.c);
    card.scrollTop = 0;
    $('#sheetPos').textContent = seq.length > 1 ? `${pos + 1} из ${seq.length}` : '';
    $('#sheetPrev').disabled = pos <= 0; $('#sheetNext').disabled = pos < 0 || pos >= seq.length - 1;
    const photo = pic(r) ? `<img data-src="${pic(r)}" alt="${esc(r.t)}">` : `<span class="blank"><b>${esc(r.t.replace(/[«"]/g, '')[0] || '?')}</b><small>${cat.name}</small></span>`;
    const k = r.k
      ? `<div class="kbju"><div><b>${fmt(r.k.k)}</b><span>ккал</span></div><div><b>${fmt(r.k.b)}</b><span>белки</span></div><div><b>${fmt(r.k.j)}</b><span>жиры</span></div><div><b>${fmt(r.k.u)}</b><span>углев.</span></div><small>КБЖУ ${r.kp === '100 г' ? 'на 100 г' : 'на порцию'}${kMine[r.id] ? ' · моё' : ''} · <button type="button" class="kbju__edit" id="kEdit">изменить</button></small></div>`
      : '<button type="button" class="kbju kbju--add" id="kEdit">+ Внести КБЖУ</button>';
    $('#sheetMedia').innerHTML = `<div class="sheet__photo">${photo}</div>${k}`;
    $('#sheetMedia').querySelectorAll('img[data-src]').forEach(show);
    const li = (x, cls) => x.startsWith('# ') ? `<li class="sub">${esc(x.slice(2))}</li>` : `<li${cls || ''}>${esc(x)}</li>`;
    const fav = favs.has(r.id);
    const where = [r.w, r.m].filter(Boolean).join(' · ');
    $('#sheetInfo').innerHTML = `
      <div class="sheet__chips">${[r.c, ...(r.cs || [])].map((c) => CAT[c]).filter(Boolean).map((c) => `<span class="chip" style="background:${c.c};border-color:${c.c}">${c.name}</span>`).join('')}${r.pp ? '<span class="chip chip--pp">ПП</span>' : '<span class="chip chip--reg">Обычный</span>'}</div>
      <h2 id="sheetName">${esc(r.t)}</h2>
      ${r.n || r.y ? `<p class="sheet__note">${esc([r.y, r.n].filter(Boolean).join('. '))}</p>` : ''}
      <div class="sheet__acts">
        <button type="button" class="btn btn--ghost" id="favBtn" aria-pressed="${fav}">${fav ? '♥ В любимых' : '♡ В любимые'}</button>
        <button type="button" class="btn btn--ghost" id="weekBtn" aria-pressed="${week.has(r.id)}">${week.has(r.id) ? '🗓 Готовлю на этой неделе' : '🗓 Приготовить на этой неделе'}</button>
        <button type="button" class="btn btn--ghost${r.pp ? '' : ' btn--pp'}" id="ppBtn">${r.pp ? 'Убрать из ПП' : 'Перенести в ПП'}</button>
        ${r.u ? `<a class="btn btn--ghost" href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">Открыть в Instagram ↗</a>` : ''}
        <label class="btn btn--ghost">${mine.has(r.id) || r.img ? 'Заменить фото' : '+ Добавить фото'}<input type="file" accept="image/*" id="photoIn" hidden></label>
        ${mine.has(r.id) ? '<button type="button" class="btn btn--ghost" id="photoDel">Убрать моё фото</button>' : ''}
        <button type="button" class="btn btn--ghost btn--warn" id="delBtn">${gone.has(r.id) ? 'Вернуть рецепт' : 'Удалить рецепт'}</button>
      </div>
      <p class="sheet__msg" id="sheetMsg" aria-live="polite"></p>
      ${r.i.length ? `<section><h3 class="who">Ингредиенты</h3><ul class="ing">${r.i.map((x) => li(x)).join('')}</ul></section>` : ''}
      ${r.st.length ? `<section><h3 class="who">Приготовление</h3><ol class="steps">${r.st.map((x) => li(x)).join('')}</ol></section>` : ''}
      <p class="src"><b>Источник:</b> ${esc(r.s)}${where ? ', ' + esc(where) : ''}${r.a && r.a.length ? `<br>Также встречается в программах: ${esc(r.a.join(', '))}` : ''}</p>`;
  }
  function redrawCard(id) {
    const c = wall.querySelector(`.card[data-id="${id}"]`); if (c) { c.outerHTML = card(byId.get(id)); hydrate(wall); }
  }
  // своё КБЖУ: форма на месте блока с цифрами
  function kForm(r) {
    const v = r.k || {}, per = r.kp === '100 г' ? '100 г' : 'порция';
    const box = $('#sheetMedia .kbju');
    const f = document.createElement('form');
    f.className = 'kbju kbju--form'; f.id = 'kForm';
    f.innerHTML = [['k', 'ккал'], ['b', 'белки'], ['j', 'жиры'], ['u', 'углев.']].map(([n, w]) =>
      `<label><input name="${n}" inputmode="decimal" autocomplete="off" value="${v[n] != null ? fmt(v[n]) : ''}" aria-label="${w}"><span>${w}</span></label>`).join('')
      + `<div class="kbju__per" role="radiogroup" aria-label="На что">${['порция', '100 г'].map((p) =>
        `<label><input type="radio" name="p" value="${p}"${p === per ? ' checked' : ''}><span>${p === 'порция' ? 'на порцию' : 'на 100 г'}</span></label>`).join('')}</div>
      <div class="kbju__acts"><button class="btn" type="submit">Сохранить</button><button class="btn btn--ghost" type="button" id="kCancel">Отмена</button>${kMine[r.id] ? '<button class="btn btn--ghost" type="button" id="kReset">Убрать моё</button>' : ''}</div>
      <p class="kbju__err" aria-live="polite"></p>`;
    box.replaceWith(f);
    f.querySelector('input').focus();
  }
  sheet.addEventListener('submit', (e) => {
    if (e.target.id !== 'kForm') return;
    e.preventDefault();
    const f = e.target, id = seq[pos] ?? +location.hash.slice(2);
    const num = (n) => { const x = parseFloat(f.elements[n].value.replace(',', '.').trim()); return Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : null; };
    const v = { k: num('k'), b: num('b'), j: num('j'), u: num('u'), p: f.elements.p.value };
    if (['k', 'b', 'j', 'u'].some((n) => v[n] === null)) { f.querySelector('.kbju__err').textContent = 'Заполните все четыре числа (можно 0).'; return; }
    kMine[id] = v; applyMine();
    fill(byId.get(id)); $('#sheetMsg').textContent = 'КБЖУ сохранено.';
    drawCounts(); drawMine(); redrawCard(id);
  });
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const it = e.target.closest('.ing li:not(.sub)'); if (it) it.classList.toggle('is-done');
    const fb = e.target.closest('#favBtn');
    if (fb) {
      const id = seq[pos] ?? +location.hash.slice(2);
      favs.has(id) ? favs.delete(id) : favs.add(id); saveFavs();
      const on = favs.has(id); fb.setAttribute('aria-pressed', on); fb.textContent = on ? '♥ В любимых' : '♡ В любимые';
      redrawCard(id); drawMine();
    }
    const wb = e.target.closest('#weekBtn');
    if (wb) {
      const id = seq[pos] ?? +location.hash.slice(2);
      week.has(id) ? week.delete(id) : week.add(id); saveWeek();
      const on = week.has(id); wb.setAttribute('aria-pressed', on); wb.textContent = on ? '🗓 Готовлю на этой неделе' : '🗓 Приготовить на этой неделе';
      redrawCard(id); drawWeek();
    }
    if (e.target.closest('#ppBtn')) {
      const id = seq[pos] ?? +location.hash.slice(2), r = byId.get(id);
      ppMine[id] = r.pp ? 0 : 1; applyMine();
      fill(r); $('#sheetMsg').textContent = r.pp ? 'Рецепт теперь в ПП.' : 'Рецепт убран из ПП, теперь он в обычных.';
      drawCounts(); drawMine(); drawCats(); drawTags(); render(false);
    }
    if (e.target.closest('#kEdit')) kForm(byId.get(seq[pos] ?? +location.hash.slice(2)));
    if (e.target.closest('#kCancel')) fill(byId.get(seq[pos] ?? +location.hash.slice(2)));
    if (e.target.closest('#kReset')) {
      const id = seq[pos] ?? +location.hash.slice(2);
      delete kMine[id]; applyMine(); fill(byId.get(id)); drawCounts(); drawMine(); redrawCard(id);
    }
    if (e.target.closest('#photoDel')) {
      const id = seq[pos] ?? +location.hash.slice(2);
      idb('readwrite', (s) => s.delete(id)).then(() => {
        URL.revokeObjectURL(mine.get(id)); mine.delete(id); myBlobs.delete(id); fill(byId.get(id)); render(false); drawMine();
      });
    }
    if (e.target.closest('#delBtn')) {
      const id = seq[pos] ?? +location.hash.slice(2), r = byId.get(id);
      if (gone.has(id)) { gone.delete(id); saveGone(); fill(r); }
      else {
        if (!confirm(`Удалить «${r.t}»?\nВернуть его можно в списке «Удалённые» рядом с фильтрами.`)) return;
        gone.add(id); saveGone(); closeSheet();
      }
      if (state.trash && !gone.size) state.trash = false;
      drawTrash(); drawMine(); drawCats(); drawTags(); render(false);
    }
  });
  sheet.addEventListener('change', (e) => {
    if (e.target.id !== 'photoIn' || !e.target.files[0]) return;
    const id = seq[pos] ?? +location.hash.slice(2), msg = $('#sheetMsg');
    msg.textContent = 'Сохраняю фото…';
    shrink(e.target.files[0])
      .then((b) => idb('readwrite', (s) => s.put(b, id)).then(() => b))
      .then((b) => {
        if (mine.has(id)) URL.revokeObjectURL(mine.get(id));
        mine.set(id, URL.createObjectURL(b)); myBlobs.set(id, b);
        fill(byId.get(id)); render(false); drawMine();
        $('#sheetMsg').textContent = 'Фото сохранено на этом устройстве.';
      })
      .catch(() => { msg.textContent = 'Не получилось сохранить фото. Попробуйте другой снимок.'; });
  });
  const step = (d) => { const n = pos + d; if (n < 0 || n >= seq.length) return; pos = n; fill(byId.get(seq[pos])); history.replaceState(null, '', '#r' + seq[pos]); };
  $('#sheetPrev').addEventListener('click', () => step(-1));
  $('#sheetNext').addEventListener('click', () => step(1));
  addEventListener('keydown', (e) => {
    if (sheet.hidden) return;
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  /* ---------- панель ---------- */
  const bar = $('.bar');
  addEventListener('scroll', () => bar.classList.toggle('is-stuck', scrollY > 10), { passive: true });

  drawMode(); drawTrash(); drawWeek(); drawMine(); drawCats(); drawTags(); render(false);
  const m = location.hash.match(/^#r(\d+)$/);
  if (m && byId.has(+m[1])) openSheet(+m[1], list.map((r) => r.id).includes(+m[1]) ? list.map((r) => r.id) : [+m[1]]);
}
  const boot = (data) => loadMine().catch(() => new Map()).then((m) => start(data, m));
  if (window.RECIPES) boot(window.RECIPES);
  else unlock().then(([data, key]) => { KEY = key; boot(data); });
})();
