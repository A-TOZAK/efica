/* 田川学習習慣室 EFICA（v2）
 * スマホで開いてすぐ使う形。タブは3つ。
 *   プリント：教科を押して、章を開き、「問題」「答え」を押すだけ（探させない）
 *   カード　：一問一答。すぐ10問。覚えた・まだ、を端末に覚えておく
 *   計画表　：期間・曜日・やることから表を作り、画像・LINE・カレンダー・PDFへ
 * 入れた内容と覚えた記録は、この端末のブラウザ（localStorage）にだけ置く。外へは送らない。
 */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const IC_X = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const IC_DOWN = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';

  const MODES = {
    q: { label: '問題だけ', suffix: '問題', file: (s) => `files/${s.subject}/${s.id}_q.pdf`, pages: (s) => s.qPages },
    full: { label: '問題と答え', suffix: '問題と答え', file: (s) => `files/${s.subject}/${s.id}.pdf`, pages: (s) => s.qPages + s.aPages },
    a: { label: '答えだけ', suffix: '答え', file: (s) => `files/${s.subject}/${s.id}_a.pdf`, pages: (s) => s.aPages },
  };

  /* ── 端末に覚えておく（使えないときは覚えないだけ） ── */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
  };

  let CAT = null;
  const SUBJ = {};
  const BY_ID = new Map();
  const ui = Object.assign({ grade: 1, subject: 'math', csubject: 'math' }, store.get('efica-ui', {}));
  const saveUI = () => store.set('efica-ui', { grade: ui.grade, subject: ui.subject, csubject: ui.csubject });

  /* ── 小さな道具 ── */
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  const sheetName = (s) => `${s.title}${s.no ? ' ' + s.no : ''}`;
  const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  const gradeLabel = (g) => `中${g}`;
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const el = document.createElement('script');
      el.src = src; el.onload = res; el.onerror = () => rej(new Error('load ' + src));
      document.head.appendChild(el);
    });
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function shareOrSave(blob, name, title) {
    try {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    saveBlob(blob, name);
  }
  const ic = (name, cls = 'ic') => (name ? `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>` : '');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* 章ごとに並べる（教科書の順のまま） */
  function unitsOf(subject, grade) {
    const m = new Map();
    for (const s of CAT.sheets) {
      if (s.subject !== subject || s.grade !== grade) continue;
      const key = `${subject}|${grade}|${s.bunya}|${s.unit}`;
      if (!m.has(key)) {
        const unit = s.unit || 'そのほか';
        const mm = /^(第\d+部\d+章|\d+章|単元\d+|\d+)\s+(.+)$/.exec(unit);
        m.set(key, { key, subject, grade, bunya: s.bunya, unit, no: mm ? mm[1] : '', name: (mm ? mm[2] : unit).replace(/\^2/g, '²'),
          art: (CAT.art && CAT.art[key]) || (CAT.icons && CAT.icons[subject]) || '', items: [] });
      }
      m.get(key).items.push(s);
    }
    return [...m.values()];
  }
  function subjectButtons(kind) {
    const c = {};
    for (const s of CAT.sheets) {
      if (s.grade !== ui.grade) continue;
      c[s.subject] = (c[s.subject] || 0) + (kind === 'prints' ? 1 : (s.cards || 0));
    }
    const cur = kind === 'prints' ? ui.subject : ui.csubject;
    return CAT.subjects.map((sub) => `<button type="button" data-v="${sub.key}" data-subj="${sub.key}" aria-pressed="${cur === sub.key}"${c[sub.key] ? '' : ' class="zero"'}>${ic(CAT.icons && CAT.icons[sub.key])}<span class="s">${sub.name}</span><span class="n">${c[sub.key] ? c[sub.key] + (kind === 'prints' ? '枚' : '問') : 'じゅんび中'}</span></button>`).join('');
  }

  /* ════════════════ 1. プリント ════════════════ */

  function sheetHTML(s) {
    const meta = [s.section, `問題${s.qPages}ページ`].filter(Boolean);
    const a = s.aPages
      ? `<a class="a" href="${MODES.a.file(s)}" target="_blank" rel="noopener">答え</a>`
      : '<span class="none">答えはありません</span>';
    return `<div class="sheet" data-id="${s.id}">
      <img src="${s.thumb}" alt="" loading="lazy" width="44" height="62">
      <p class="sheet-title">${esc(sheetName(s))}</p>
      <p class="sheet-meta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</p>
      <div class="sheet-btns"><a class="q" href="${MODES.q.file(s)}" target="_blank" rel="noopener">問題</a>${a}</div>
    </div>`;
  }

  function renderPrints() {
    $('.subjects[data-for="prints"]').innerHTML = subjectButtons('prints');
    $('#view-prints').dataset.subj = ui.subject;
    const units = unitsOf(ui.subject, ui.grade);
    const sub = SUBJ[ui.subject];
    const last = store.get('efica-last', {})[`${ui.subject}-${ui.grade}`];
    const lastUnit = units.find((u) => u.key === last);
    if (!units.length) {
      $('#units').innerHTML = `<p class="empty">中${ui.grade}の${sub.name}のプリントは、いま作っています。</p>`;
      $('#resume').hidden = true;
      return;
    }
    $('#units').innerHTML = units.map((u) => `<details class="unit" data-key="${esc(u.key)}"${u === lastUnit ? ' open' : ''}>
      <summary><span class="art">${ic(u.art)}</span><span class="t"><span class="no">${esc([u.bunya, u.no].filter(Boolean).join(' '))}</span>${esc(u.name)}</span><span class="n">${u.items.length}枚</span>${IC_DOWN}</summary>
      ${u.items.map(sheetHTML).join('')}
      <div class="unit-foot"><button type="button" class="textbtn" data-act="bulk">この章をまとめて保存（印刷する人むけ）</button></div>
    </details>`).join('');
    if (lastUnit) {
      $('#resume').innerHTML = `<button type="button">前に開いた章：${esc(lastUnit.unit)}</button>`;
      $('#resume').hidden = false;
    } else $('#resume').hidden = true;
  }

  function rememberUnit(key) {
    const m = store.get('efica-last', {});
    m[`${ui.subject}-${ui.grade}`] = key;
    store.set('efica-last', m);
  }

  async function mergeSave(sheets, mode, name) {
    const m = MODES[mode];
    const use = sheets.filter((s) => m.pages(s) > 0);
    if (!use.length) { toast('入れるページがありません。'); return; }
    try {
      toast('まとめる準備をしています。', 0);
      await loadScript('assets/vendor/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;
      const out = await PDFDocument.create();
      let i = 0;
      for (const s of use) {
        i += 1;
        toast(`まとめています。${use.length}枚のうち${i}枚目です。`, 0);
        const r = await fetch(m.file(s));
        if (!r.ok) throw new Error(`${s.id} ${r.status}`);
        const src = await PDFDocument.load(await r.arrayBuffer());
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      out.setTitle(name.replace(/\.pdf$/, '')); out.setAuthor('School Stock'); out.setCreator(''); out.setProducer('');
      saveBlob(new Blob([await out.save()], { type: 'application/pdf' }), name);
      toast(`${use.length}枚を1つのPDFにしました。`);
    } catch (e) {
      console.error(e);
      toast('まとめられませんでした。電波のよい所で、もう一度ためしてください。', 5000);
    }
  }

  let bulkUnit = null;
  function bindPrints() {
    $('.subjects[data-for="prints"]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      ui.subject = b.dataset.v; saveUI(); renderPrints();
    });
    $('#units').addEventListener('toggle', (e) => {
      const d = e.target;
      if (d.classList && d.classList.contains('unit') && d.open) rememberUnit(d.dataset.key);
    }, true);
    $('#units').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="bulk"]'); if (!b) return;
      const key = b.closest('.unit').dataset.key;
      bulkUnit = unitsOf(ui.subject, ui.grade).find((u) => u.key === key);
      if (!bulkUnit) return;
      $('#bulk-lead').textContent = `${bulkUnit.unit}（${bulkUnit.items.length}枚）を、1つのPDFにします。`;
      $('#bulk-dlg').showModal();
    });
    $('#bulk-dlg').addEventListener('click', (e) => {
      if (e.target === e.currentTarget || e.target.closest('[data-close]')) { $('#bulk-dlg').close(); return; }
      const b = e.target.closest('[data-mode]'); if (!b || !bulkUnit) return;
      $('#bulk-dlg').close();
      const u = bulkUnit; const mode = b.dataset.mode;
      const name = fileSafe(`${gradeLabel(u.grade)}${SUBJ[u.subject].name}_${u.bunya ? u.bunya + '_' : ''}${u.unit}_${MODES[mode].suffix}`) + '.pdf';
      mergeSave(u.items, mode, name);
    });
    $('#resume').addEventListener('click', () => {
      const d = $('.unit[open]', $('#units'));
      if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ════════════════ 2. カード ════════════════ */

  const CARD_CACHE = new Map();
  let learned = store.get('efica-learned', {});
  async function loadCards(subject, grade) {
    const key = `${subject}-${grade}`;
    if (CARD_CACHE.has(key)) return CARD_CACHE.get(key);
    let box = {};
    try {
      const r = await fetch(`data/cards/${key}.json`);
      if (r.ok) box = await r.json();
    } catch { /* カードがない教科 */ }
    CARD_CACHE.set(key, box);
    return box;
  }
  function cardsOfUnit(box, u) {
    return u.items.flatMap((s) => (box[s.id] || []).map((c) => Object.assign({ deck: u.unit }, c)));
  }

  async function renderCards() {
    $('.subjects[data-for="cards"]').innerHTML = subjectButtons('cards');
    $('#view-cards').dataset.subj = ui.csubject;
    $('#flash').dataset.subj = ui.csubject;
    $('#quick-icon').innerHTML = ic(CAT.icons && CAT.icons[ui.csubject]);
    const sub = SUBJ[ui.csubject];
    const units = unitsOf(ui.csubject, ui.grade).filter((u) => u.items.some((s) => s.cards));
    $('#quick-sub').textContent = `中${ui.grade}・${sub.name}から、まぜて出します`;
    $('#quick').disabled = !units.length;
    if (!units.length) {
      $('#decks').innerHTML = `<p class="empty">中${ui.grade}の${sub.name}のカードは、いま作っています。</p>`;
      return;
    }
    const box = await loadCards(ui.csubject, ui.grade);
    $('#decks').innerHTML = units.map((u) => {
      const cards = cardsOfUnit(box, u);
      const ok = cards.filter((c) => learned[c.id]).length;
      const pct = cards.length ? Math.round((ok / cards.length) * 100) : 0;
      return `<button type="button" class="deck" data-key="${esc(u.key)}">
        <span class="art">${ic(u.art)}</span>
        <span class="deck-t"><span class="no">${esc([u.bunya, u.no].filter(Boolean).join(' '))}</span>${esc(u.name)}</span>
        <span class="deck-n">${ok}／${cards.length}問</span>
        <span class="deck-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
      </button>`;
    }).join('');
  }

  /* めくる画面 */
  const fl = { pool: [], list: [], i: 0, back: false, miss: [], hit: 0, title: '' };
  function pick10(pool) {
    const notyet = shuffle(pool.filter((c) => !learned[c.id]));
    const done = shuffle(pool.filter((c) => learned[c.id]));
    return notyet.concat(done).slice(0, 10);
  }
  function openFlash(pool, title, list) {
    fl.pool = pool; fl.title = title; fl.list = list || pick10(pool); fl.i = 0; fl.back = false; fl.miss = []; fl.hit = 0;
    if (!fl.list.length) { toast('このカードは、まだありません。'); return; }
    $('#flash').hidden = false;
    document.body.style.overflow = 'hidden';
    if (!history.state || !history.state.flash) history.pushState({ flash: 1 }, '');
    drawFlash();
  }
  function closeFlash(fromPop) {
    $('#flash').hidden = true;
    document.body.style.overflow = '';
    if (!fromPop && history.state && history.state.flash) history.back();
    renderCards();
  }
  function plain(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }
  function drawFlash() {
    const n = fl.list.length;
    $('#flash-deck').textContent = fl.title;
    $('#flash-bar').style.width = `${Math.round((Math.min(fl.i, n) / n) * 100)}%`;
    if (fl.i >= n) {
      $('#flash-count').textContent = '';
      const missHTML = fl.miss.map((c) => `<li>${c.q}<span class="ans">${c.a}</span></li>`).join('');
      $('#flash-stage').innerHTML = `<div class="result">
        <p class="stamp" aria-hidden="true">できた</p>
        <p class="result-big">${n}問のうち<b>${fl.hit}</b>問おぼえた</p>
        <p class="result-sub">${fl.miss.length ? 'まだの問題は、もう一度くり返すと覚えやすくなります。' : '全部おぼえました。'}</p>
        ${missHTML ? `<ul class="result-list">${missHTML}</ul>` : ''}
      </div>`;
      $('#flash-actions').innerHTML = fl.miss.length
        ? `<button type="button" class="btn ok wide" data-f="again">まだの${fl.miss.length}問をもう一度</button><button type="button" class="btn btn-line" data-f="next">別の10問</button><button type="button" class="btn btn-line" data-f="close">おわる</button>`
        : `<button type="button" class="btn ok" data-f="next">別の10問</button><button type="button" class="btn btn-line" data-f="close">おわる</button>`;
      return;
    }
    const c = fl.list[fl.i];
    $('#flash-count').textContent = `${fl.i + 1} / ${n}`;
    if (!fl.back) {
      const long = plain(c.q).length > 26 || c.c;
      $('#flash-stage').innerHTML = `<div class="card" data-f="flip" role="button" tabindex="0" aria-label="めくる">
        ${c.lead ? `<p class="card-lead">${c.lead}</p>` : ''}
        <p class="card-q${long ? ' long' : ''}">${c.q}</p>
        ${c.c ? `<ul class="card-c">${c.c.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
        <p class="card-tap">答えを思い出してから、めくります</p>
      </div>`;
      $('#flash-actions').innerHTML = '<button type="button" class="btn btn-ink wide" data-f="flip">答えを見る</button>';
    } else {
      // 記号だけの答え（ア〜エ）は、選んだ文もいっしょに見せる
      let ans = c.a;
      if (c.c && /^[ア-ン]$/.test(plain(c.a).trim())) {
        const hit = c.c.find((x) => plain(x).trim().startsWith(plain(c.a).trim()));
        if (hit) ans = hit;
      }
      $('#flash-stage').innerHTML = `<div class="card back">
        <p class="card-qmini">${c.q}</p>
        <p class="card-a-label">答え</p>
        <p class="card-a${plain(ans).length > 14 ? ' long' : ''}">${ans}</p>
        ${c.s ? `<div class="card-s">${c.s.map((x) => `<p>${x}</p>`).join('')}</div>` : ''}
      </div>`;
      $('#flash-actions').innerHTML = '<button type="button" class="btn btn-line" data-f="miss">まだ</button><button type="button" class="btn ok" data-f="hit">おぼえた</button>';
    }
  }
  function flashAct(act) {
    const c = fl.list[fl.i];
    if (act === 'flip') { fl.back = true; drawFlash(); return; }
    if (act === 'hit' || act === 'miss') {
      if (act === 'hit') { fl.hit += 1; learned[c.id] = 1; } else { fl.miss.push(c); delete learned[c.id]; }
      store.set('efica-learned', learned);
      fl.i += 1; fl.back = false; drawFlash(); return;
    }
    if (act === 'again') { openFlash(fl.pool, fl.title, shuffle(fl.miss.slice())); return; }
    if (act === 'next') { openFlash(fl.pool, fl.title); return; }
    if (act === 'close') closeFlash(false);
  }

  function bindCards() {
    $('.subjects[data-for="cards"]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      ui.csubject = b.dataset.v; saveUI(); renderCards();
    });
    $('#decks').addEventListener('click', async (e) => {
      const b = e.target.closest('.deck'); if (!b) return;
      const u = unitsOf(ui.csubject, ui.grade).find((x) => x.key === b.dataset.key);
      const box = await loadCards(ui.csubject, ui.grade);
      openFlash(cardsOfUnit(box, u), u.unit);
    });
    $('#quick').addEventListener('click', async () => {
      const box = await loadCards(ui.csubject, ui.grade);
      const pool = unitsOf(ui.csubject, ui.grade).flatMap((u) => cardsOfUnit(box, u));
      openFlash(pool, `中${ui.grade}・${SUBJ[ui.csubject].name}`);
    });
    $('#flash').addEventListener('click', (e) => {
      if (e.target.closest('#flash-x')) { closeFlash(false); return; }
      const b = e.target.closest('[data-f]'); if (b) flashAct(b.dataset.f);
    });
    // 左右にすべらせても答えられる（右＝おぼえた、左＝まだ）
    let sx = null;
    $('#flash-stage').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    $('#flash-stage').addEventListener('touchend', (e) => {
      if (sx === null || !fl.back) { sx = null; return; }
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 70) flashAct(dx > 0 ? 'hit' : 'miss');
    });
    document.addEventListener('keydown', (e) => {
      if ($('#flash').hidden) return;
      if (e.key === 'Escape') closeFlash(false);
      else if ((e.key === ' ' || e.key === 'Enter') && !fl.back && fl.i < fl.list.length) { e.preventDefault(); flashAct('flip'); }
      else if (e.key === 'ArrowRight' && fl.back) flashAct('hit');
      else if (e.key === 'ArrowLeft' && fl.back) flashAct('miss');
    });
    window.addEventListener('popstate', () => { if (!$('#flash').hidden) closeFlash(true); });
  }

  /* ════════════════ 2. 自習計画 ════════════════ */

  const PLAN_KEY = 'efica-plan-v1';
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const jdate = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
  const jdateW = (d) => `${jdate(d)}（${DOW[d.getDay()]}）`;

  function freshPlan() {
    const today = iso(new Date());
    return {
      pid: Math.random().toString(36).slice(2, 10),
      name: '', grade: String(ui.grade || 1), goal: '',
      start: today, end: addDays(today, 27),
      days: [1, 2, 3, 4, 5], minutes: 30, time: '19:00',
      sheets: [], perDay: 1, redo: true, tasks: [], done: {},
    };
  }
  let plan = Object.assign(freshPlan(), store.get(PLAN_KEY, {}));
  let saveTimer;
  function savePlan() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(PLAN_KEY, plan), 200); }

  function schedule() {
    const s = parse(plan.start); const e = parse(plan.end);
    if (!s || !e) return { rows: [], error: 'はじめる日と、おわる日を入れてください。' };
    if (e < s) return { rows: [], error: 'おわる日を、はじめる日より後にしてください。' };
    if (!plan.days.length) return { rows: [], error: '勉強する曜日を、1つ以上選んでください。' };
    const dates = [];
    const d = new Date(s);
    let guard = 0;
    while (d <= e && guard < 366) {
      if (plan.days.includes(d.getDay())) dates.push(new Date(d));
      d.setDate(d.getDate() + 1); guard += 1;
    }
    const cut = dates.length > 120;
    const use = dates.slice(0, 120);
    const sheets = plan.sheets.map((id) => BY_ID.get(id)).filter(Boolean);
    let si = 0;
    const rows = use.map((dt) => {
      const items = [];
      for (let k = 0; k < Number(plan.perDay) && si < sheets.length; k += 1, si += 1) {
        const sh = sheets[si];
        items.push({ kind: 'sheet', text: `${SUBJ[sh.subject].name}　${sheetName(sh)}` });
      }
      if (!items.length && sheets.length && plan.redo) items.push({ kind: 'redo', text: 'まちがえた問題のやり直し' });
      plan.tasks.forEach((t) => items.push({ kind: 'task', text: t }));
      return { date: iso(dt), dt, items };
    });
    return { rows, left: sheets.length - si, cut };
  }

  function timeText() {
    const days = [1, 2, 3, 4, 5, 6, 0].filter((x) => plan.days.includes(x)).map((x) => DOW[x]).join('・');
    return `${days}　${plan.time || '--:--'}から${plan.minutes}分`;
  }

  /* 計画表の紙面を作る（#sheet-stage で実際に組んで、あふれたら次のページへ送る） */
  const PAGE_H = 1123 - 54 - 46;
  function infoHTML() {
    const blank = (v, ph) => (v ? esc(v) : `<span class="blank">${ph}</span>`);
    const s = parse(plan.start); const e = parse(plan.end);
    const period = s && e ? `${s.getFullYear()}年${jdateW(s)}から${jdateW(e)}まで` : '';
    return `<dl class="pg-info">
      <div><dt>名前</dt><dd>${blank(plan.name, '（名前）')}</dd></div>
      <div><dt>学年</dt><dd>中学${esc(plan.grade)}年</dd></div>
      <div class="wide"><dt>目標</dt><dd>${blank(plan.goal, '（目標）')}</dd></div>
      <div><dt>期間</dt><dd>${esc(period)}</dd></div>
      <div><dt>時間</dt><dd>${esc(timeText())}</dd></div>
    </dl>`;
  }
  function rowTR(r) {
    const items = r.items.length
      ? r.items.map((it) => `<span class="it-${it.kind}">${esc(it.text)}</span>`).join('')
      : '<span class="empty-it">（やることを入れましょう）</span>';
    const dow = r.dt.getDay();
    const on = !!plan.done[r.date];
    return `<tr data-date="${r.date}"><td class="c-date">${jdate(r.dt)}</td><td class="c-dow${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}">${DOW[dow]}</td><td><div class="items">${items}</div></td><td class="c-done"><button type="button" class="donebox${on ? ' on' : ''}" data-date="${r.date}" aria-pressed="${on}" aria-label="${jdate(r.dt)}にできた"></button></td></tr>`;
  }
  const TABLE_HEAD = '<table class="pg-table"><thead><tr><th class="c-date">日付</th><th class="c-dow">曜日</th><th>やること</th><th class="c-done">できた</th></tr></thead><tbody></tbody></table>';
  function brandHTML() { return '<p class="pg-brand"><span class="brand-ja">田川学習習慣室</span><span class="brand-en">EFICA</span></p>'; }

  function buildPages(sch) {
    const stage = $('#sheet-stage');
    stage.innerHTML = '';
    const pages = [];
    const newPage = (first) => {
      const pg = document.createElement('div');
      pg.className = 'pg';
      pg.innerHTML = `<div class="pg-inner">
        <div class="pg-top"><h3 class="pg-title">自習計画表${first ? '' : '<small>つづき</small>'}</h3>${brandHTML()}</div>
        ${first ? infoHTML() : ''}${TABLE_HEAD}</div>`;
      stage.appendChild(pg);
      pages.push(pg);
      return pg;
    };
    const over = (pg) => $('.pg-inner', pg).offsetHeight > PAGE_H - 28;
    let pg = newPage(true);
    for (const r of sch.rows) {
      const tb = $('tbody', pg);
      tb.insertAdjacentHTML('beforeend', rowTR(r));
      if (over(pg) && tb.children.length > 1) {
        tb.lastElementChild.remove();
        pg = newPage(false);
        $('tbody', pg).insertAdjacentHTML('beforeend', rowTR(r));
      }
    }
    if (!sch.rows.length) $('table', pg).remove();
    const total = sch.rows.length;
    const done = sch.rows.filter((r) => plan.done[r.date]).length;
    const foot = `<div class="pg-foot">
      <div class="pg-ref"><p>ふりかえり（終わったら書きましょう）</p><div class="lines"></div></div>
      <div class="pg-sum"><p>できた回数</p><p class="big">${total}回のうち<b>${done || '　'}</b>回</p></div></div>`;
    pg.querySelector('.pg-inner').insertAdjacentHTML('beforeend', foot);
    if (over(pg)) {
      $('.pg-foot', pg).remove();
      const tb = $('tbody', pg);
      const moved = [];
      while (tb && tb.children.length > 2 && moved.length < 2) moved.unshift(tb.lastElementChild.outerHTML), tb.lastElementChild.remove();
      pg = newPage(false);
      if (moved.length) $('tbody', pg).insertAdjacentHTML('beforeend', moved.join(''));
      else $('table', pg).remove();
      pg.querySelector('.pg-inner').insertAdjacentHTML('beforeend', foot);
    }
    pages.forEach((p, i) => {
      $('.pg-inner', p).insertAdjacentHTML('beforeend', `<p class="pg-page"><span>${esc(plan.name ? plan.name + 'さんの自習計画' : '自習計画')}</span><span>${i + 1}ページ（全${pages.length}ページ）</span></p>`);
      $('.pg-inner', p).style.minHeight = `${PAGE_H}px`;
    });
    return pages;
  }

  function fitPreview() {
    const box = $('#preview');
    const w = box.clientWidth - 4;
    const scale = Math.min(1, w / 794);
    $$('.pg-frame', box).forEach((f) => {
      f.style.width = `${794 * scale}px`;
      f.style.height = `${1123 * scale}px`;
      $('.pg', f).style.transform = `scale(${scale})`;
    });
  }

  function renderPlan() {
    plan.grade = String(ui.grade);
    const f = $('#plan-form');
    // 入力欄に今の計画を写す（打っている欄は上書きしない）
    for (const k of ['name', 'grade', 'goal', 'start', 'end', 'minutes', 'time', 'perDay']) {
      const el = f.elements[k];
      if (el && document.activeElement !== el && String(el.value) !== String(plan[k])) el.value = plan[k];
    }
    f.elements.redo.checked = !!plan.redo;
    $('#days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((x) =>
      `<button type="button" data-d="${x}" class="${x === 0 ? 'sun' : x === 6 ? 'sat' : ''}" aria-pressed="${plan.days.includes(x)}" aria-label="${DOW[x]}曜日">${DOW[x]}</button>`).join('');

    const sheets = plan.sheets.map((id) => BY_ID.get(id)).filter(Boolean);
    $('#picked').innerHTML = sheets.length
      ? sheets.map((s) => `<li data-id="${s.id}"><span>${esc(sheetName(s))}<span class="sub">中${s.grade}・${SUBJ[s.subject].name}　${esc(s.unit)}</span></span><button type="button" class="x" aria-label="${esc(sheetName(s))}を計画から外す">${IC_X}</button></li>`).join('')
      : '<li class="picked-empty">上で章を選んで「入れる」を押すと、その章のプリントが入ります。</li>';
    $('#tasks').innerHTML = plan.tasks.map((t, i) =>
      `<li><span>${esc(t)}</span><button type="button" class="x" data-i="${i}" aria-label="${esc(t)}を外す">${IC_X}</button></li>`).join('');

    const sch = schedule();
    const warn = $('#plan-warn');
    if (sch.error) { warn.textContent = sch.error; warn.hidden = false; }
    else if (sch.left > 0) { warn.textContent = `プリントが${sch.left}枚入りきりません。1日の枚数をふやすか、おわる日を後にしてください。`; warn.hidden = false; }
    else if (sch.cut) { warn.textContent = '計画表には、はじめの120回までを入れています。'; warn.hidden = false; }
    else warn.hidden = true;

    const n = sch.rows.length;
    const total = n * Number(plan.minutes);
    const h = Math.floor(total / 60); const m = total % 60;
    $('#plan-calc').innerHTML = n
      ? `全部で<b>${n}</b>回、合わせて<b>${total}</b>分（${h ? `${h}時間` : ''}${m ? `${m}分` : ''}）です。`
      : '';
    const done = sch.rows.filter((r) => plan.done[r.date]).length;
    $('#progress').innerHTML = n ? `${n}回のうち<b>${done}</b>回できました` : '';

    renderToday(sch);
    const pages = buildPages(sch);
    $('#preview').innerHTML = pages.map(() => '<div class="pg-frame"></div>').join('');
    $$('.pg-frame', $('#preview')).forEach((fr, i) => fr.appendChild(pages[i].cloneNode(true)));
    fitPreview();
    const disabled = !n;
    ['#out-pdf', '#out-img', '#out-line', '#out-cal', '#out-print'].forEach((s) => { $(s).disabled = disabled; });
    return sch;
  }

  /* 今日の自習（スマートフォンでも押しやすい大きなボタン） */
  function renderToday(sch) {
    const box = $('#today');
    if (!plan.sheets.length && !plan.tasks.length) { box.hidden = true; return; }
    const today = iso(new Date());
    const row = sch.rows.find((r) => r.date === today);
    if (row) {
      const on = !!plan.done[row.date];
      box.innerHTML = `<p class="today-label"><span class="today-en">TODAY</span>今日 ${jdateW(row.dt)}の自習</p>
        <ul class="today-items">${row.items.map((it) => `<li>${esc(it.text)}</li>`).join('') || '<li>やることを入れましょう</li>'}</ul>
        <button type="button" class="btn ${on ? 'btn-line' : 'btn-accent'} today-btn" data-date="${row.date}" aria-pressed="${on}">${on ? 'できました（押すと取り消します）' : 'できた'}</button>`;
      box.hidden = false;
      return;
    }
    const next = sch.rows.find((r) => r.date > today);
    if (next) {
      box.innerHTML = `<p class="today-label"><span class="today-en">NEXT</span>次の自習は ${jdateW(next.dt)}です。</p>`;
      box.hidden = false;
      return;
    }
    box.hidden = true;
  }

  function lineText(sch) {
    const s = parse(plan.start); const e = parse(plan.end);
    const L = ['【自習計画】'];
    L.push(`名前：${plan.name || '（名前）'}（中学${plan.grade}年）`);
    if (plan.goal) L.push(`目標：${plan.goal}`);
    if (s && e) L.push(`期間：${jdateW(s)}から${jdateW(e)}まで`);
    L.push(`時間：${timeText().replace('　', ' ')}`);
    const done = sch.rows.filter((r) => plan.done[r.date]).length;
    if (done) L.push(`できた回数：${sch.rows.length}回のうち${done}回`);
    L.push('', 'やること：');
    const max = 12;
    sch.rows.slice(0, max).forEach((r) => {
      const mark = plan.done[r.date] ? '✓ ' : '';
      L.push(`${mark}${jdateW(r.dt)} ${r.items.map((it) => it.text.replace('　', ' ')).join('、') || '（未定）'}`);
    });
    if (sch.rows.length > max) L.push(`（このあとの${sch.rows.length - max}回は、計画表を見てください）`);
    L.push('', '田川学習習慣室 EFICA');
    return L.join('\n');
  }

  /* カレンダー（ics）。1行75バイトで折り返す */
  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = []; let cur = ''; let len = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (len + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
      cur += ch; len += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  function icsText(sch, alarm) {
    const [hh, mm] = (plan.time || '19:00').split(':').map(Number);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EFICA//study plan//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:自習計画', 'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE'];
    for (const r of sch.rows) {
      const st = new Date(r.dt); st.setHours(hh || 0, mm || 0, 0, 0);
      const en = new Date(st.getTime() + Number(plan.minutes) * 60000);
      const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
      const desc = ['やること', ...r.items.map((it) => `・${it.text.replace('　', ' ')}`)].join('\n') + (plan.goal ? `\n\n目標：${plan.goal}` : '');
      L.push('BEGIN:VEVENT', `UID:efica-${plan.pid}-${r.date.replace(/-/g, '')}@efica`, `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Asia/Tokyo:${f(st)}`, `DTEND;TZID=Asia/Tokyo:${f(en)}`,
        `SUMMARY:${icsEsc(`自習（${plan.minutes}分）`)}`, `DESCRIPTION:${icsEsc(desc)}`);
      if (alarm) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:自習の時間です', 'TRIGGER:-PT5M', 'END:VALARM');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function googleURL(sch) {
    const first = sch.rows[0].dt; const last = sch.rows[sch.rows.length - 1].dt;
    const [hh, mm] = (plan.time || '19:00').split(':').map(Number);
    const st = new Date(first); st.setHours(hh || 0, mm || 0, 0, 0);
    const en = new Date(st.getTime() + Number(plan.minutes) * 60000);
    const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const by = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const days = plan.days.map((x) => by[x]).join(',');
    const until = `${last.getFullYear()}${pad(last.getMonth() + 1)}${pad(last.getDate())}T235959`;
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: `自習（${plan.minutes}分）`, dates: `${f(st)}/${f(en)}`, ctz: 'Asia/Tokyo',
      details: `${plan.goal ? `目標：${plan.goal}\n` : ''}やることは、自習計画表で確かめてください。`,
      recur: `RRULE:FREQ=WEEKLY;BYDAY=${days};UNTIL=${until}`,
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }

  /* 計画表を canvas に描く（PDF・画像用）。
   * html2canvas は和文の行の高さを読み違えて文字が下へずれるため、紙面を自分で組む。どの端末でも同じ絵になる。 */
  const CF = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Yu Gothic UI", "Meiryo", sans-serif';
  const NO_TAIL = '（〔［｛〈《「『【';
  const NO_HEAD = '、。，．・：；？！）〕］｝〉》」』】ー～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ々';
  function wrapText(ctx, text, max) {
    const lines = [];
    let cur = '';
    for (const ch of String(text)) {
      if (cur && ctx.measureText(cur + ch).width > max) {
        if ((NO_HEAD.includes(ch) || NO_TAIL.includes(cur.slice(-1))) && cur.length > 1) { lines.push(cur.slice(0, -1)); cur = cur.slice(-1) + ch; continue; }
        lines.push(cur); cur = ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  async function drawPages(S) {
    try {
      await document.fonts.ready;
      await Promise.all([document.fonts.load('600 22px "Barlow Condensed"'), document.fonts.load('700 14px "BIZ UDPGothic"')]);
    } catch { /* 字形が読めなくても、ほかの書体で描く */ }
    const W = 794; const H = 1123; const L = 58; const R = 58; const T = 50; const B = 44; const IW = W - L - R;
    const font = (w, px) => `${w} ${px}px ${CF}`;
    const sch = schedule();
    const mc = document.createElement('canvas').getContext('2d');

    const s = parse(plan.start); const e = parse(plan.end);
    const period = s && e ? `${s.getFullYear()}年${jdateW(s)}から${jdateW(e)}まで` : '';
    const half = IW / 2; const LBL = 56; const LH = 21;
    mc.font = font(400, 14);
    const info = [
      [{ label: '名前', text: plan.name, ph: '（名前）', w: half }, { label: '学年', text: `中学${plan.grade}年`, w: half }],
      [{ label: '目標', text: plan.goal, ph: '（目標）', w: IW }],
      [{ label: '期間', text: period, w: half }, { label: '時間', text: timeText(), w: half }],
    ].map((cells) => {
      cells.forEach((c) => { c.lines = wrapText(mc, c.text || c.ph || '', c.w - LBL - 20); });
      return { cells, h: Math.max(36, Math.max(...cells.map((c) => c.lines.length)) * LH + 14) };
    });
    const infoH = info.reduce((t, r) => t + r.h, 0);

    const CD = 92; const CW = 42; const CK = 64; const CT = IW - CD - CW - CK; const RLH = 19;
    mc.font = font(400, 13);
    const rows = sch.rows.map((r) => {
      const lines = [];
      r.items.forEach((it) => wrapText(mc, (it.kind === 'task' ? '・' : '') + it.text, CT - 20).forEach((t) => lines.push({ kind: it.kind, t })));
      if (!lines.length) lines.push({ kind: 'empty', t: '（やることを入れましょう）' });
      return { r, lines, h: Math.max(34, lines.length * RLH + 12) };
    });

    const HEAD = 50; const THEAD = 26; const FOOT = 130; const MAXY = H - B - 26;
    const pages = [];
    let cur = { first: true, rows: [] };
    let y = T + HEAD + 14 + infoH + 14 + THEAD;
    for (const row of rows) {
      if (y + row.h > MAXY && cur.rows.length) { pages.push(cur); cur = { first: false, rows: [] }; y = T + HEAD + 14 + THEAD; }
      cur.rows.push(row); y += row.h;
    }
    if (y + 14 + FOOT > MAXY) {
      const moved = cur.rows.length > 2 ? cur.rows.splice(-2) : [];
      pages.push(cur); cur = { first: false, rows: moved };
    }
    pages.push(cur);

    const total = sch.rows.length;
    const done = sch.rows.filter((r) => plan.done[r.date]).length;
    return pages.map((pg, pi) => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * S); c.height = Math.round(H * S);
      const g = c.getContext('2d');
      g.scale(S, S);
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 1;
      const ls = (v) => { if ('letterSpacing' in g) g.letterSpacing = v; };

      // 見出し
      g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.font = font(800, 30); ls('3px');
      g.fillText('自習計画表', L, T + 36);
      if (!pg.first) { const w = g.measureText('自習計画表').width; g.font = font(700, 15); ls('0px'); g.fillText('つづき', L + w + 12, T + 36); }
      g.textAlign = 'right';
      g.font = font(700, 10); ls('1.4px'); g.fillText('田川学習習慣室', W - R, T + 12);
      g.font = `600 24px "Barlow Condensed", ${CF}`; ls('3.5px'); g.fillText('EFICA', W - R + 3, T + 38);
      ls('0px'); g.textAlign = 'left';
      g.fillRect(L, T + HEAD - 3, IW, 3);
      let yy = T + HEAD + 14;

      // 名前・目標・期間・時間
      if (pg.first) {
        for (const row of info) {
          let x = L;
          for (const cell of row.cells) {
            g.fillStyle = '#f1f1ef'; g.fillRect(x, yy, LBL, row.h);
            g.strokeRect(x, yy, cell.w, row.h);
            g.beginPath(); g.moveTo(x + LBL, yy); g.lineTo(x + LBL, yy + row.h); g.stroke();
            g.fillStyle = '#111'; g.font = font(700, 12); g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(cell.label, x + LBL / 2, yy + row.h / 2);
            g.textAlign = 'left'; g.font = font(400, 14); g.fillStyle = cell.text ? '#111' : '#9a9a9a';
            let ty = yy + (row.h - cell.lines.length * LH) / 2 + LH / 2;
            cell.lines.forEach((t) => { g.fillText(t, x + LBL + 10, ty); ty += LH; });
            x += cell.w;
          }
          yy += row.h;
        }
        yy += 14;
      }

      // 表
      const cols = [[L, CD, '日付'], [L + CD, CW, '曜日'], [L + CD + CW, CT, 'やること'], [L + CD + CW + CT, CK, 'できた']];
      if (pg.rows.length) {
        g.fillStyle = '#f1f1ef'; g.fillRect(L, yy, IW, THEAD);
        g.fillStyle = '#111'; g.font = font(700, 12); g.textAlign = 'center'; g.textBaseline = 'middle';
        cols.forEach(([x, w, t]) => { g.strokeRect(x, yy, w, THEAD); g.fillText(t, x + w / 2, yy + THEAD / 2); });
        yy += THEAD;
        for (const row of pg.rows) {
          cols.forEach(([x, w]) => g.strokeRect(x, yy, w, row.h));
          const dow = row.r.dt.getDay();
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = font(700, 13); g.fillStyle = '#111'; g.fillText(jdate(row.r.dt), L + CD / 2, yy + row.h / 2);
          g.font = font(400, 13); g.fillStyle = dow === 0 ? '#a33a2c' : dow === 6 ? '#2f4fb3' : '#111';
          g.fillText(DOW[dow], L + CD + CW / 2, yy + row.h / 2);
          g.textAlign = 'left';
          let ty = yy + (row.h - row.lines.length * RLH) / 2 + RLH / 2;
          for (const ln of row.lines) {
            g.fillStyle = ln.kind === 'sheet' ? '#111' : ln.kind === 'empty' ? '#aaaaaa' : '#444';
            g.fillText(ln.t, L + CD + CW + 10, ty); ty += RLH;
          }
          const bx = L + CD + CW + CT + CK / 2 - 12; const by = yy + row.h / 2 - 12;
          g.lineWidth = 1.5; g.strokeRect(bx, by, 24, 24);
          if (plan.done[row.r.date]) {
            g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
            g.beginPath(); g.moveTo(bx + 5.5, by + 12.5); g.lineTo(bx + 10, by + 17); g.lineTo(bx + 18.5, by + 7.5); g.stroke();
          }
          g.lineWidth = 1;
          yy += row.h;
        }
      }

      // ふりかえりと、できた回数（最後のページだけ）
      if (pi === pages.length - 1) {
        yy += 14;
        const fh = Math.min(320, Math.max(FOOT, MAXY - yy - 6));
        const sw = 190; const rw = IW - sw - 14;
        g.strokeRect(L, yy, rw, fh); g.strokeRect(L + rw + 14, yy, sw, fh);
        g.fillStyle = '#111'; g.font = font(700, 12); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
        g.fillText('ふりかえり（終わったら書きましょう）', L + 14, yy + 24);
        g.fillText('できた回数', L + rw + 28, yy + 24);
        g.save(); g.setLineDash([3, 3]); g.strokeStyle = '#888';
        for (let ly = yy + 34 + 28; ly < yy + fh - 6; ly += 28) { g.beginPath(); g.moveTo(L + 14, ly); g.lineTo(L + rw - 14, ly); g.stroke(); }
        g.restore();
        g.textAlign = 'right'; g.font = font(700, 15);
        const base = yy + fh - 18;
        g.fillText('回', W - R - 14, base);
        const kw = g.measureText('回').width;
        if (done) { g.font = `600 36px "Barlow Condensed", ${CF}`; g.fillText(String(done), W - R - 14 - kw - 8, base + 2); }
        const nw = done ? g.measureText(String(done)).width : 30;
        g.font = font(700, 15); g.fillText(`${total}回のうち`, W - R - 14 - kw - 16 - nw, base);
        g.textAlign = 'left';
      }

      // ページの下
      g.font = font(400, 11); g.fillStyle = '#777'; g.textBaseline = 'alphabetic';
      g.fillText(plan.name ? `${plan.name}さんの自習計画` : '自習計画', L, H - B);
      g.textAlign = 'right'; g.fillText(`${pi + 1}ページ（全${pages.length}ページ）`, W - R, H - B);
      return c;
    });
  }
  const planFile = (ext) => fileSafe(`自習計画_${plan.name || '名前なし'}_${plan.start.replace(/-/g, '')}`) + ext;

  function bindPlan() {
    const f = $('#plan-form');
    f.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.name || !(el.name in plan)) return;
      plan[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      savePlan(); renderPlan();
    });
    f.addEventListener('change', (e) => {
      const el = e.target;
      if (el.name === 'redo') { plan.redo = el.checked; savePlan(); renderPlan(); }
    });
    f.addEventListener('submit', (e) => e.preventDefault());
    $('#days').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const d = Number(b.dataset.d);
      plan.days = plan.days.includes(d) ? plan.days.filter((x) => x !== d) : [...plan.days, d];
      savePlan(); renderPlan();
    });
    $('#period-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-days]'); if (!b) return;
      if (!parse(plan.start)) plan.start = iso(new Date());
      plan.end = addDays(plan.start, Number(b.dataset.days) - 1);
      savePlan(); renderPlan();
    });
    $$('.chips[data-fill]').forEach((box) => box.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      if (box.dataset.fill === 'goal') { plan.goal = b.textContent; f.elements.goal.value = plan.goal; }
      if (box.dataset.fill === 'task') { if (!plan.tasks.includes(b.textContent) && plan.tasks.length < 6) plan.tasks.push(b.textContent); }
      savePlan(); renderPlan();
    }));
    const addTask = () => {
      const v = $('#task-input').value.trim();
      if (!v) return;
      if (plan.tasks.length >= 6) { toast('毎回やることは6つまでです。'); return; }
      plan.tasks.push(v); $('#task-input').value = '';
      savePlan(); renderPlan();
    };
    $('#task-add').addEventListener('click', addTask);
    $('#task-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTask(); } });
    $('#tasks').addEventListener('click', (e) => {
      const b = e.target.closest('.x'); if (!b) return;
      plan.tasks.splice(Number(b.dataset.i), 1); savePlan(); renderPlan();
    });
    $('#picked').addEventListener('click', (e) => {
      const b = e.target.closest('.x'); if (!b) return;
      const id = b.closest('li').dataset.id;
      plan.sheets = plan.sheets.filter((x) => x !== id); savePlan(); renderPlan();
    });
    $('#plan-reset').addEventListener('click', () => {
      if (!window.confirm('入れた内容を消して、新しい計画にします。よろしいですか。')) return;
      plan = freshPlan(); store.del(PLAN_KEY); renderPlan();
      toast('新しい計画にしました。');
    });
    const toggleDone = (d) => {
      if (plan.done[d]) delete plan.done[d]; else plan.done[d] = true;
      savePlan(); renderPlan();
    };
    $('#today').addEventListener('click', (e) => {
      const b = e.target.closest('.today-btn'); if (!b) return;
      toggleDone(b.dataset.date);
      if (plan.done[b.dataset.date]) toast('おつかれさまでした。できた印をつけました。');
    });
    $('#preview').addEventListener('click', (e) => {
      const b = e.target.closest('tr[data-date]'); if (!b) return;
      const d = b.dataset.date;
      if (plan.done[d]) delete plan.done[d]; else plan.done[d] = true;
      savePlan(); renderPlan();
    });

    $('#out-pdf').addEventListener('click', async () => {
      try {
        toast('PDFを作っています。', 0);
        await loadScript('assets/vendor/jspdf.umd.min.js');
        const canvases = await drawPages(2.5);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
        canvases.forEach((c, i) => { if (i) pdf.addPage(); pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297); });
        pdf.setProperties({ title: '自習計画表', author: plan.name || '' });
        saveBlob(pdf.output('blob'), planFile('.pdf'));
        toast('PDFを保存しました。');
      } catch (e) { console.error(e); toast('PDFを作れませんでした。もう一度ためしてください。', 5000); }
    });
    $('#out-img').addEventListener('click', async () => {
      try {
        toast('画像を作っています。', 0);
        const canvases = await drawPages(2);
        const W = canvases[0].width; const H = canvases.reduce((t, c) => t + c.height, 0) + (canvases.length - 1) * 24;
        const all = document.createElement('canvas'); all.width = W; all.height = H;
        const g = all.getContext('2d'); g.fillStyle = '#e9e8e4'; g.fillRect(0, 0, W, H);
        let y = 0; canvases.forEach((c) => { g.drawImage(c, 0, y); y += c.height + 24; });
        const blob = await new Promise((r) => all.toBlob(r, 'image/png'));
        $('#toast').hidden = true;
        await shareOrSave(blob, planFile('.png'), '自習計画表');
      } catch (e) { console.error(e); toast('画像を作れませんでした。もう一度ためしてください。', 5000); }
    });
    $('#out-line').addEventListener('click', () => {
      const sch = schedule();
      const url = `https://line.me/R/share?text=${encodeURIComponent(lineText(sch))}`;
      window.open(url, '_blank', 'noopener');
    });
    $('#out-cal').addEventListener('click', () => {
      const sch = schedule();
      if (!sch.rows.length) return;
      $('#cal-lead').textContent = `${jdateW(sch.rows[0].dt)}から${jdateW(sch.rows[sch.rows.length - 1].dt)}まで、${sch.rows.length}回の予定を入れます。`;
      $('#cal-google').href = googleURL(sch);
      $('#cal-dlg').showModal();
    });
    $('#cal-ics').addEventListener('click', () => {
      const sch = schedule();
      const text = icsText(sch, $('#cal-alarm').checked);
      const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios) window.location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(text)}`;
      else saveBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }), planFile('.ics'));
      $('#cal-dlg').close();
    });
    $('#cal-close').addEventListener('click', () => $('#cal-dlg').close());
    $('#out-print').addEventListener('click', () => window.print());

    if ('ResizeObserver' in window) new ResizeObserver(fitPreview).observe($('#preview'));
    else window.addEventListener('resize', fitPreview);
  }

  /* ════════════════ 学年とタブ ════════════════ */

  function setGrade(g) {
    ui.grade = g; saveUI(); store.set('efica-grade-set', 1);
    $('#grade-label').textContent = `中${g}`;
    $$('#grade-choices button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.g) === g)));
    renderPrints(); renderCards(); renderPickUnits(); renderPlan();
  }
  function bindGrade() {
    $('#grade-btn').addEventListener('click', () => $('#grade-dlg').showModal());
    $('#grade-choices').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      setGrade(Number(b.dataset.g)); $('#grade-dlg').close();
    });
    $('#grade-dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget && store.get('efica-grade-set')) e.currentTarget.close(); });
    $('#grade-dlg').addEventListener('cancel', (e) => { if (!store.get('efica-grade-set')) e.preventDefault(); });
  }

  const TABS = ['prints', 'cards', 'plan'];
  function route() {
    const t = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'prints';
    TABS.forEach((x) => { $(`#view-${x}`).hidden = x !== t; });
    $$('.tab-link').forEach((a) => { if (a.dataset.tab === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (t === 'plan') fitPreview();
    window.scrollTo(0, 0);
  }

  /* 計画表に、プリントの章をまるごと入れる */
  function renderPickUnits() {
    $('#pick-unit').innerHTML = '<option value="">プリントの章を選ぶ</option>' + CAT.subjects.map((sub) => {
      const us = unitsOf(sub.key, ui.grade);
      if (!us.length) return '';
      return `<optgroup label="${sub.name}">${us.map((u) => `<option value="${esc(u.key)}">${esc(u.unit)}（${u.items.length}枚）</option>`).join('')}</optgroup>`;
    }).join('');
  }
  function bindPick() {
    $('#pick-add').addEventListener('click', () => {
      const key = $('#pick-unit').value;
      if (!key) { toast('章を選んでから押してください。'); return; }
      const u = unitsOf(key.split('|')[0], ui.grade).find((x) => x.key === key);
      if (!u) return;
      const before = plan.sheets.length;
      u.items.forEach((s) => { if (!plan.sheets.includes(s.id)) plan.sheets.push(s.id); });
      savePlan(); renderPlan();
      toast(plan.sheets.length > before ? `${plan.sheets.length - before}枚を入れました。` : 'もう入っています。');
    });
  }

  /* ── はじまり ── */
  async function init() {
    if (/\bLine\//i.test(navigator.userAgent)) {
      $('#inapp').hidden = false;
      $('#inapp-open').href = `${location.pathname}?openExternalBrowser=1${location.hash}`;
    }
    try {
      const r = await fetch('data/catalog.json', { cache: 'no-cache' });
      CAT = await r.json();
    } catch {
      $('#units').innerHTML = '<p class="empty">一覧を読みこめませんでした。電波のよい所で、開き直してください。</p>';
      return;
    }
    try {   // 線のアイコン（Tabler Icons）を読みこんでおく
      const sv = await fetch('assets/icons.svg').then((r) => r.text());
      document.body.insertAdjacentHTML('afterbegin', sv);
    } catch { /* アイコンがなくても動く */ }
    CAT.subjects.forEach((s) => { SUBJ[s.key] = s; });
    CAT.sheets.forEach((s) => BY_ID.set(s.id, s));
    const qp = new URLSearchParams(location.search);
    if (['1', '2', '3'].includes(qp.get('g'))) { ui.grade = Number(qp.get('g')); store.set('efica-grade-set', 1); }
    if (SUBJ[qp.get('s')]) { ui.subject = qp.get('s'); ui.csubject = qp.get('s'); }
    saveUI();
    if (!SUBJ[ui.subject]) ui.subject = 'math';
    if (!SUBJ[ui.csubject]) ui.csubject = 'math';
    if (![1, 2, 3].includes(ui.grade)) ui.grade = 1;
    plan.sheets = plan.sheets.filter((id) => BY_ID.has(id));
    const d = new Date(CAT.built + 'T00:00:00');
    $('#built').textContent = `　${d.getMonth() + 1}月${d.getDate()}日更新`;
    $('#grade-label').textContent = `中${ui.grade}`;
    const gradeSet = !!store.get('efica-grade-set');
    $$('#grade-choices button').forEach((b) => b.setAttribute('aria-pressed', String(gradeSet && Number(b.dataset.g) === ui.grade)));
    bindGrade(); bindPrints(); bindCards(); bindPlan(); bindPick();
    renderPrints(); renderPickUnits(); renderPlan(); renderCards();
    window.addEventListener('hashchange', route);
    route();
    if (!store.get('efica-grade-set')) $('#grade-dlg').showModal();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
