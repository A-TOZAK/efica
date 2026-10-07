/* 田川学習習慣室 EFICA 教材サイト
 * 1. プリント：学年・教科・形（問題だけ／答えつき／答えだけ）で絞り、1枚ずつ・章ごと・選んだ分をまとめて保存
 * 2. 自習計画：名前・目標・期間・時間・内容から計画表を作り、PDF・画像・LINE・カレンダーへ出す
 * 入れた内容はこの端末のブラウザ（localStorage）にだけ置く。外へは送らない。
 */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const IC_DL = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>';
  const IC_X = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  const MODES = {
    q: { label: '問題だけ', suffix: '問題', help: '答えのページを外した形です。配るときや、自分で解くときに使います。', file: (s) => `files/${s.subject}/${s.id}_q.pdf`, pages: (s) => s.qPages, size: (s) => s.size.q },
    full: { label: '答えつき', suffix: '答えつき', help: '問題のあとに、答えと解説のページが続く形です。', file: (s) => `files/${s.subject}/${s.id}.pdf`, pages: (s) => s.qPages + s.aPages, size: (s) => s.size.full },
    a: { label: '答えだけ', suffix: '答え', help: '答えと解説のページだけの形です。丸つけのときに使います。', file: (s) => `files/${s.subject}/${s.id}_a.pdf`, pages: (s) => s.aPages, size: (s) => s.size.a },
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
  const ui = Object.assign({ grade: 1, subject: 'math', mode: 'q' }, store.get('efica-ui', {}));
  let query = '';
  const selected = new Set();

  /* ── 小さな道具 ── */
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const sheetName = (s) => `${s.title}${s.no ? ' ' + s.no : ''}`;
  const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  const gradeLabel = (g) => `中${g}`;
  function dlName(s, mode) {
    return fileSafe(`${gradeLabel(s.grade)}${SUBJ[s.subject].name}_${s.title}${s.no || ''}_${MODES[mode].suffix}`) + '.pdf';
  }
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

  /* ════════════════ 1. プリント ════════════════ */

  function counts(grade) {
    const c = {};
    for (const s of CAT.sheets) if (s.grade === grade) c[s.subject] = (c[s.subject] || 0) + 1;
    return c;
  }

  function renderStats() {
    const c = {};
    for (const s of CAT.sheets) c[s.subject] = (c[s.subject] || 0) + 1;
    const d = new Date(CAT.built + 'T00:00:00');
    $('#stats').innerHTML = CAT.subjects.map((sub) =>
      `<div><dt>${sub.name}<span class="en">${sub.en}</span></dt><dd>${c[sub.key] || 0}<small>枚</small></dd></div>`
    ).join('') + `<p class="stats-asof">${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日の枚数です。プリントは少しずつ増えていきます。</p>`;
    $('#built').textContent = `更新 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function renderFilters() {
    const c = counts(ui.grade);
    $('.seg[data-key="grade"]').innerHTML = [1, 2, 3].map((g) =>
      `<button type="button" data-v="${g}" aria-pressed="${ui.grade === g && !query}">中学${g}年</button>`).join('');
    $('.seg[data-key="subject"]').innerHTML = CAT.subjects.map((sub) =>
      `<button type="button" data-v="${sub.key}" aria-pressed="${ui.subject === sub.key && !query}"><span class="kanji" aria-hidden="true">${sub.kanji}</span>${sub.name}<span class="count">${c[sub.key] || 0}</span></button>`).join('');
    $('.seg[data-key="mode"]').innerHTML = Object.entries(MODES).map(([k, m]) =>
      `<button type="button" data-v="${k}" aria-pressed="${ui.mode === k}">${m.label}</button>`).join('');
    $('#mode-help').textContent = MODES[ui.mode].help;
  }

  function visible() {
    const q = norm(query);
    if (q) {
      return CAT.sheets.filter((s) => norm(`${SUBJ[s.subject].name}${s.bunya}${s.unit}${s.section}${s.title}${s.no}`).includes(q));
    }
    return CAT.sheets.filter((s) => s.grade === ui.grade && s.subject === ui.subject);
  }

  function groupOf(list) {
    const m = new Map();
    for (const s of list) {
      const k = `${s.subject}|${s.grade}|${s.bunya}|${s.unit}`;
      if (!m.has(k)) m.set(k, { key: k, subject: s.subject, grade: s.grade, bunya: s.bunya, unit: s.unit, items: [] });
      m.get(k).items.push(s);
    }
    return [...m.values()];
  }

  function rowHTML(s) {
    const m = MODES[ui.mode];
    const pages = m.pages(s);
    const meta = [s.section, `問題${s.qPages}ページ`, s.aPages ? `答え${s.aPages}ページ` : '答えなし'].filter(Boolean);
    const on = selected.has(s.id);
    const btn = pages
      ? `<a class="dl" href="${m.file(s)}" download="${esc(dlName(s, ui.mode))}" aria-label="${esc(sheetName(s))}を${m.label}でダウンロード">${IC_DL}${m.label}<span class="dl-size">${mb(m.size(s))}</span></a>`
      : `<span class="dl is-none">${m.label}はありません</span>`;
    return `<li class="row${on ? ' is-on' : ''}" data-id="${s.id}">
      <label class="check"><input type="checkbox" ${on ? 'checked' : ''} aria-label="${esc(sheetName(s))}をえらぶ"><span class="box" aria-hidden="true"></span></label>
      <button type="button" class="thumb" data-act="view" aria-label="${esc(sheetName(s))}の中を見る"><img src="${s.thumb}" alt="" loading="lazy" width="58" height="82"></button>
      <div class="row-body"><p class="row-title">${esc(s.title)}${s.no ? `<span class="no">${esc(s.no)}</span>` : ''}</p><p class="row-meta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</p></div>
      ${btn}
    </li>`;
  }

  function renderList() {
    const list = visible();
    const sub = SUBJ[ui.subject];
    if (query) {
      $('#results-title').innerHTML = `<b>「${esc(query)}」でさがした結果</b><span class="num">${list.length}</span>枚`;
    } else {
      $('#results-title').innerHTML = `<b>中学${ui.grade}年・${sub.name}</b><span class="num">${list.length}</span>枚`;
    }
    $('#select-visible').hidden = !list.length;
    if (!list.length) {
      $('#list').innerHTML = query
        ? `<div class="empty"><b>見つかりませんでした。</b>ほかのことばでさがすか、学年と教科から選んでください。</div>`
        : `<div class="empty"><b>中学${ui.grade}年の${sub.name}は、いま準備しています。</b>できたものから、ここに並びます。</div>`;
      return;
    }
    $('#list').innerHTML = groupOf(list).map((g) => {
      const allOn = g.items.every((s) => selected.has(s.id));
      const tag = query ? `<span class="tag">中${g.grade}・${SUBJ[g.subject].name}</span>` : '';
      const bunya = g.bunya ? `<span class="bunya">${esc(g.bunya)}</span>` : '';
      return `<section class="group" data-key="${esc(g.key)}">
        <div class="group-head">
          <h3 class="group-title">${tag}${bunya}${esc(g.unit || 'そのほか')}<span class="n">${g.items.length}枚</span></h3>
          <div class="group-actions">
            <button type="button" class="textbtn" data-act="group-select">${allOn ? 'えらぶのをやめる' : '全部えらぶ'}</button>
            <button type="button" class="btn btn-sm btn-line" data-act="group-merge">${IC_DL}この章をまとめて保存</button>
          </div>
        </div>
        <ol>${g.items.map(rowHTML).join('')}</ol>
      </section>`;
    }).join('');
  }

  function renderSelbar() {
    const n = selected.size;
    document.body.classList.toggle('has-selbar', n > 0);
    $('#selbar').hidden = n === 0;
    $('#sel-n').textContent = n;
    if (n) {
      const m = MODES[ui.mode];
      const pages = [...selected].reduce((t, id) => t + m.pages(BY_ID.get(id)), 0);
      $('#sel-sub').textContent = `${m.label}で${pages}ページ`;
      $('#sel-merge').innerHTML = `まとめて保存<span class="hide-sp">（${m.label}）</span>`;
    }
  }

  function renderAll() {
    renderFilters();
    renderList();
    renderSelbar();
    store.set('efica-ui', { grade: ui.grade, subject: ui.subject, mode: ui.mode });
  }

  async function mergeSave(sheets, name) {
    const m = MODES[ui.mode];
    const use = sheets.filter((s) => m.pages(s) > 0);
    if (!use.length) { toast(`${m.label}のページがありません。`); return; }
    if (use.length === 1) {
      const a = document.createElement('a');
      a.href = m.file(use[0]); a.download = dlName(use[0], ui.mode);
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
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
      const title = name.replace(/\.pdf$/, '');
      out.setTitle(title); out.setAuthor('School Stock'); out.setCreator(''); out.setProducer('');
      const bytes = await out.save();
      saveBlob(new Blob([bytes], { type: 'application/pdf' }), name);
      toast(`${use.length}枚を1つのPDFにまとめました。`);
    } catch (e) {
      console.error(e);
      toast('まとめられませんでした。通信のよい所で、もう一度ためしてください。', 5000);
    }
  }

  function openViewer(s) {
    const sub = SUBJ[s.subject];
    $('#viewer-sub').textContent = `中学${s.grade}年・${sub.name}　${s.unit}`;
    $('#viewer-title').textContent = sheetName(s);
    $('#viewer-body').innerHTML = s.previews.map((p, i) =>
      `<img src="${p}" alt="${esc(sheetName(s))}の問題 ${i + 1}ページ目" width="1000" height="1414">`).join('');
    $('#viewer-foot').innerHTML = Object.entries(MODES).map(([k, m]) => m.pages(s)
      ? `<a class="dl" href="${m.file(s)}" download="${esc(dlName(s, k))}">${IC_DL}${m.label}<span class="dl-size">${mb(m.size(s))}</span></a>`
      : '').join('');
    $('#viewer').showModal();
    $('#viewer-body').scrollTop = 0;
  }

  function bindPrints() {
    $('#filters').addEventListener('click', (e) => {
      const b = e.target.closest('.seg button');
      if (!b) return;
      const key = b.parentElement.dataset.key;
      if (key === 'grade') ui.grade = Number(b.dataset.v);
      if (key === 'subject') ui.subject = b.dataset.v;
      if (key === 'mode') ui.mode = b.dataset.v;
      if (key !== 'mode' && query) { query = ''; $('#q').value = ''; $('#q-clear').hidden = true; }
      renderAll();
    });
    let qt;
    $('#q').addEventListener('input', (e) => {
      clearTimeout(qt);
      qt = setTimeout(() => {
        query = e.target.value.trim();
        $('#q-clear').hidden = !query;
        renderFilters();
        renderList();
      }, 160);
    });
    $('#q-clear').addEventListener('click', () => {
      query = ''; $('#q').value = ''; $('#q-clear').hidden = true; renderFilters(); renderList(); $('#q').focus();
    });
    $('#list').addEventListener('change', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      if (e.target.checked) selected.add(row.dataset.id); else selected.delete(row.dataset.id);
      row.classList.toggle('is-on', e.target.checked);
      const g = row.closest('.group');
      const ids = $$('.row', g).map((r) => r.dataset.id);
      $('[data-act="group-select"]', g).textContent = ids.every((id) => selected.has(id)) ? 'えらぶのをやめる' : '全部えらぶ';
      renderSelbar();
    });
    $('#list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'view') { openViewer(BY_ID.get(b.closest('.row').dataset.id)); return; }
      const g = b.closest('.group');
      const items = $$('.row', g).map((r) => BY_ID.get(r.dataset.id));
      if (act === 'group-select') {
        const allOn = items.every((s) => selected.has(s.id));
        items.forEach((s) => (allOn ? selected.delete(s.id) : selected.add(s.id)));
        renderList(); renderSelbar();
      }
      if (act === 'group-merge') {
        const s0 = items[0];
        const name = fileSafe(`${gradeLabel(s0.grade)}${SUBJ[s0.subject].name}_${s0.bunya ? s0.bunya + '_' : ''}${s0.unit}_${MODES[ui.mode].suffix}_${items.length}枚`) + '.pdf';
        mergeSave(items, name);
      }
    });
    $('#select-visible').addEventListener('click', () => {
      visible().forEach((s) => selected.add(s.id));
      renderList(); renderSelbar();
    });
    $('#sel-clear').addEventListener('click', () => { selected.clear(); renderList(); renderSelbar(); });
    $('#sel-merge').addEventListener('click', () => {
      const items = CAT.sheets.filter((s) => selected.has(s.id));
      const same = items.every((s) => s.subject === items[0].subject && s.grade === items[0].grade);
      const head = same ? `${gradeLabel(items[0].grade)}${SUBJ[items[0].subject].name}_` : '';
      mergeSave(items, fileSafe(`${head}えらんだ${items.length}枚_${MODES[ui.mode].suffix}`) + '.pdf');
    });
    $('#sel-plan').addEventListener('click', () => {
      const ids = CAT.sheets.filter((s) => selected.has(s.id)).map((s) => s.id);
      const before = plan.sheets.length;
      ids.forEach((id) => { if (!plan.sheets.includes(id)) plan.sheets.push(id); });
      const added = plan.sheets.length - before;
      selected.clear(); renderList(); renderSelbar();
      savePlan(); renderPlan();
      $('#picked').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(added ? `${added}枚を自習計画に入れました。` : 'もう計画に入っています。');
    });
    $('#viewer-close').addEventListener('click', () => $('#viewer').close());
    $('#viewer').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
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
      : '<li class="picked-empty">まだプリントを選んでいません。「プリントを選ぶ」から、一覧で選んで「自習計画に入れる」を押してください。</li>';
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
    $('#go-pick').addEventListener('click', () => {
      ui.grade = Number(plan.grade) || ui.grade;
      renderAll();
      $('#prints').scrollIntoView({ behavior: 'smooth' });
      toast('選んだら、画面の下の「自習計画に入れる」を押してください。', 4200);
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

  /* ── はじまり ── */
  async function init() {
    if (/\bLine\//i.test(navigator.userAgent)) {
      $('#inapp').hidden = false;
      $('#inapp-open').href = `${location.pathname}?openExternalBrowser=1${location.hash}`;
    }
    try {
      const r = await fetch('data/catalog.json', { cache: 'no-cache' });
      CAT = await r.json();
    } catch (e) {
      $('#list').innerHTML = '<div class="empty"><b>一覧を読みこめませんでした。</b>通信のよい所で、ページを開き直してください。</div>';
      return;
    }
    CAT.subjects.forEach((s) => { SUBJ[s.key] = s; });
    CAT.sheets.forEach((s) => BY_ID.set(s.id, s));
    if (!SUBJ[ui.subject]) ui.subject = 'math';
    if (![1, 2, 3].includes(ui.grade)) ui.grade = 1;
    if (!MODES[ui.mode]) ui.mode = 'q';
    plan.sheets = plan.sheets.filter((id) => BY_ID.has(id));
    renderStats();
    renderAll();
    bindPrints();
    bindPlan();
    renderPlan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
