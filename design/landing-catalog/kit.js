/* LifeCommit landing kit — живые экраны приложения, кнопки скачивания, переключатель каталога.
   Подключать в конце <body> после kit.css:  <script src="kit.js"></script>  → глобальный window.LC.

   Разметка-заглушки, которые LC.mount() заполняет сам:
     <div class="phone" style="--pw: 300"><div class="phone-screen">
       <div class="app" data-screen="today|voice|calendar|group" data-dark></div>
     </div></div>
     <div data-stores data-tone="dark|light|glass"></div>     — три кнопки: App Store, Google Play, Telegram

   Состояния экранов задаются числом p от 0 до 1 — их можно крутить прокруткой (GSAP ScrollTrigger scrub)
   или проигрывать по кругу:
     LC.set(appEl, p)                    — поставить экран в состояние p (по его data-screen)
     LC.loop(appEl, { duration: 7000 })  — проигрывать 0→1 по кругу, вернёт { stop() }
*/
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── устройство: на iPhone — App Store + Telegram, на Android — Google Play + Telegram, на компьютере — все три ── */
  const ua = navigator.userAgent || '';
  const os = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop';
  document.documentElement.setAttribute('data-os', os);

  /* ── иконки ── */
  const S = (d, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6),
    cross: S('<path d="M7 7l10 10M17 7L7 17"/>', 2.6),
    pencil: S('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
    mic: S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
    today: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1.4"/><rect x="10" y="3" width="5" height="5" rx="1.4"/><rect x="17" y="3" width="5" height="5" rx="1.4"/><rect x="3" y="10" width="5" height="5" rx="1.4"/><rect x="10" y="10" width="5" height="5" rx="1.4"/><rect x="17" y="10" width="5" height="5" rx="1.4"/><rect x="3" y="17" width="5" height="5" rx="1.4"/><rect x="10" y="17" width="5" height="5" rx="1.4"/><rect x="17" y="17" width="5" height="5" rx="1.4"/></svg>',
    calendar: S('<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    people: S('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19.5c.6-3 3.2-4.8 6.5-4.8s5.9 1.8 6.5 4.8"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.9c2.3.5 3.8 2.1 4.2 4.6"/>'),
    me: S('<circle cx="12" cy="8" r="4"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>'),
    drop: S('<path d="M12 3.5c3.6 4.4 6 7.7 6 10.7a6 6 0 0 1-12 0c0-3 2.4-6.3 6-10.7z"/>'),
    gym: S('<path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11"/>', 2.2),
    candy: S('<circle cx="12" cy="12" r="4.2"/><path d="M7.8 12L4 9.3v5.4zM16.2 12L20 9.3v5.4z"/>'),
    phone: S('<path d="M6.5 3.5h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>'),
    book: S('<path d="M5 4.5h9.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h9.5"/>'),
    back: S('<path d="M15 5l-7 7 7 7"/>', 2.4),
    apple: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5zM14.2 6.13c.6-.73 1-1.74.9-2.75-.87.04-1.92.58-2.54 1.3-.56.64-1.05 1.67-.92 2.66.97.07 1.96-.49 2.56-1.21z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#00D7FE" d="M3.6 2.4c-.27.3-.42.76-.42 1.33v16.54c0 .57.15 1.03.42 1.33L13 12z"/><path fill="#FFCE00" d="M16.1 15.1L13 12l3.1-3.1 3.75 2.13c1.07.6 1.07 1.6 0 2.21z"/><path fill="#FF3A44" d="M16.1 15.1L13 12l-9.4 9.6c.35.37.92.41 1.56.05z"/><path fill="#00F076" d="M16.1 8.9L5.16 2.35c-.64-.36-1.21-.32-1.56.05L13 12z"/></svg>',
    tg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor"/><path fill="#fff" d="M5.4 11.8l11.6-4.5c.54-.2 1 .13.83.94l-1.98 9.3c-.14.66-.54.82-1.1.51l-3-2.22-1.45 1.4c-.16.16-.3.3-.6.3l.2-3.06 5.57-5.03c.24-.21-.05-.33-.38-.12l-6.88 4.33-2.96-.92c-.64-.2-.66-.64.14-.95z"/></svg>',
  };
  const STATUS = (dark) => `<div class="status"><span>9:41</span><span style="display:flex;gap:6px;align-items:center">
    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
    <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.2c2.2 0 4.2.9 5.7 2.3l1.2-1.2A9.8 9.8 0 0 0 8 .5 9.8 9.8 0 0 0 1.1 3.3l1.2 1.2A8 8 0 0 1 8 2.2zm0 3.4c1.3 0 2.5.5 3.4 1.4l1.2-1.2A6.5 6.5 0 0 0 8 3.9a6.5 6.5 0 0 0-4.6 1.9L4.6 7A4.8 4.8 0 0 1 8 5.6zm0 3.4c.4 0 .8.2 1.1.4L8 10.6 6.9 9.4c.3-.2.7-.4 1.1-.4z"/></svg>
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".45"/></svg>
  </span></div><div class="island"></div>`;

  const TABBAR = (on) => {
    const t = (id, icon, label) => `<span class="tab${on === id ? ' on' : ''}"><span class="pill">${I[icon]}</span>${label}</span>`;
    return `<nav class="tabbar">${t('today', 'today', 'Сегодня')}${t('cal', 'calendar', 'Календарь')}<span class="mic">${I.mic}</span>${t('together', 'people', 'Вместе')}${t('me', 'me', 'Я')}</nav>`;
  };

  /* ── экраны ── */
  const todayBody = () => `
    <div class="body">
      <h1>Сегодня</h1>
      <p class="sub">суббота, 4 октября</p>
      <div class="sec"><span>Дела</span><span class="seg"><span class="on">Все</span><span>Осталось</span></span></div>
      <ul class="todos glass">
        <li class="ev"><span class="todo-box"></span><span class="todo-time">10:00</span><span class="todo-text">Созвон с командой</span><span class="src">A</span></li>
        <li data-t="1"><span class="todo-box">${I.check}</span><span class="todo-time">15:00</span><span class="todo-text">Позвонить в банк</span></li>
        <li data-t="2"><span class="todo-box">${I.check}</span><span class="todo-text">Купить корм коту</span></li>
      </ul>
      <div class="sec"><span>Привычки</span></div>
      <div class="habits">
        <div class="habit glass" data-h="gym"><span class="tile check">${I.gym}</span><span class="h-main"><b>Сходить в спортзал</b><span>пн, ср, пт</span></span><span class="rb ok">${I.check}</span></div>
        <div class="habit count glass" data-h="water"><span class="tile count">${I.drop}</span><span class="h-main"><b>Пить воду</b><span><em class="n">5</em> из 8 стаканов</span></span><span class="rb edit">${I.pencil}</span><span class="rb ok">${I.check}</span><span class="bar"><i></i></span></div>
        <div class="habit glass" data-h="quit"><span class="tile quit">${I.candy}</span><span class="h-main"><b>Без сладкого</b><span><em class="d">12</em> дней без этого</span></span><span class="rb-pair"><span class="rb no">${I.cross}</span><span class="rb ok">${I.check}</span></span></div>
      </div>
    </div>`;

  const PHRASE = 'Каждый день пить восемь стаканов воды, по понедельникам и средам спортзал, а завтра в три позвонить в банк';

  const voiceSheet = () => `
    <div class="scrim"></div>
    <div class="sheet">
      <span class="grab"></span>
      <h2 class="v-title">Слушаю</h2>
      <p class="heard">${PHRASE.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ')}</p>
      <div class="waves">${Array.from({ length: 28 }, () => '<i></i>').join('')}</div>
      <div class="vlist">
        <div class="vsec">Привычки</div>
        <div class="vrow"><span class="tile count">${I.drop}</span><span><b>Пить воду</b><small>8 стаканов в день</small></span></div>
        <div class="vrow"><span class="tile check">${I.gym}</span><span><b>Спортзал</b><small>пн, ср</small></span></div>
        <div class="vsec">Дела</div>
        <div class="vrow"><span class="tile check">${I.phone}</span><span><b>Позвонить в банк</b><small>завтра, 15:00</small></span></div>
      </div>
      <div class="add-btn">Добавить 3</div>
    </div>`;

  const calendarBody = () => `
    <div class="body">
      <h1>Календарь</h1>
      <div class="week">
        ${[['пн', 29], ['вт', 30], ['ср', 1], ['чт', 2], ['пт', 3], ['сб', 4], ['вс', 5]].map(([d, n], i) =>
          `<span class="${i === 5 ? 'on' : ''}">${d}<b>${n}</b>${i % 2 === 0 || i === 5 ? '<i></i>' : ''}</span>`).join('')}
      </div>
      <div class="sec"><span>Суббота</span><span>5 дел</span></div>
      <ul class="todos glass">
        <li class="ev" data-c="1"><span class="todo-box"></span><span class="todo-time">09:30</span><span class="todo-text">Йога в парке</span><span class="src">A</span></li>
        <li class="ev" data-c="2"><span class="todo-box"></span><span class="todo-time">12:00</span><span class="todo-text">Обед с Аней</span><span class="src g">G</span></li>
        <li data-c="3"><span class="todo-box">${I.check}</span><span class="todo-time">15:00</span><span class="todo-text">Позвонить в банк</span></li>
        <li data-c="4"><span class="todo-box">${I.check}</span><span class="todo-text">Купить корм коту</span></li>
        <li class="ev" data-c="5"><span class="todo-box"></span><span class="todo-time">19:00</span><span class="todo-text">День рождения Пети</span><span class="src">A</span></li>
      </ul>
      <div class="sec"><span>Завтра</span></div>
      <ul class="todos glass">
        <li><span class="todo-box">${I.check}</span><span class="todo-text">Записаться к врачу</span><span class="chip" style="margin:0">со вчера</span></li>
      </ul>
    </div>`;

  const groupBody = () => `
    <div class="body">
      <div class="ghead">
        <span class="gtile">С</span>
        <span style="display:flex;flex-direction:column;gap:2px">
          <h1 style="font-size:28px;line-height:34px">Семья</h1>
          <span class="people"><span class="ava" style="background:#DDE3F0;color:#23365C">М</span><span class="ava" style="background:#F1E3C8;color:#5A4214">П</span><span class="ava" style="background:#EBDCE6;color:#5A2748">А</span><span style="margin-left:8px;font-size:14px;color:var(--muted)">3 человека</span></span>
        </span>
      </div>
      <div class="goal glass"><b>Отпуск</b><p class="num"><em class="g-n">96 000</em> из 150 000</p><span class="bar"><i class="g-bar" style="width:64%"></i></span></div>
      <div class="sec"><span>Сегодня</span><span class="g-count">1 из 3</span></div>
      <ul class="todos glass">
        <li data-g="1" class="done"><span class="todo-box">${I.check}</span><span class="todo-text" style="display:flex;flex-direction:column"><span>Покормить кота</span><span class="chip">кто-то один · Петя</span></span></li>
        <li data-g="2"><span class="todo-box">${I.check}</span><span class="todo-text" style="display:flex;flex-direction:column"><span>Вынести мусор</span><span class="chip">по очереди · сегодня Маша</span></span></li>
        <li data-g="3"><span class="todo-box">${I.check}</span><span class="todo-text" style="display:flex;flex-direction:column"><span>Полить цветы</span><span class="chip">каждый своё</span></span></li>
        <li class="ev"><span class="todo-box"></span><span class="todo-time">19:00</span><span class="todo-text" style="display:flex;flex-direction:column"><span>Ужин у бабушки</span><span class="chip">мероприятие</span></span></li>
      </ul>
    </div>`;

  const SCREENS = {
    today: (dark) => STATUS(dark) + todayBody() + TABBAR('today'),
    voice: (dark) => STATUS(dark) + todayBody() + TABBAR('today') + voiceSheet(),
    calendar: (dark) => STATUS(dark) + calendarBody() + TABBAR('cal'),
    group: (dark) => STATUS(dark) + groupBody() + TABBAR('together'),
  };

  /* ── состояния по p ∈ [0,1] ── */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const tog = (el, cls, on) => el && el.classList.toggle(cls, !!on);
  const q = (root, sel) => root.querySelector(sel);

  const SETTERS = {
    today(app, p) {
      tog(q(app, '[data-t="2"]'), 'done', p > 0.16);
      const gym = q(app, '[data-h="gym"] .rb.ok');
      tog(gym, 'on', p > 0.32);
      const n = Math.round(5 + 3 * seg(p, 0.45, 0.78));
      const nEl = q(app, '[data-h="water"] .n');
      if (nEl && nEl.textContent !== String(n)) nEl.textContent = n;
      const bar = q(app, '[data-h="water"] .bar i');
      if (bar) bar.style.width = (n / 8) * 100 + '%';
      tog(q(app, '[data-h="water"] .rb.ok'), 'on', n >= 8);
      const quitOk = q(app, '[data-h="quit"] .rb.ok');
      const quitNo = q(app, '[data-h="quit"] .rb.no');
      tog(quitOk, 'on', p > 0.88);
      tog(quitNo, 'dim', p > 0.88);
      const d = q(app, '[data-h="quit"] .d');
      if (d) d.textContent = p > 0.88 ? '13' : '12';
      tog(q(app, '[data-t="1"]'), 'done', p > 0.95);
    },
    voice(app, p) {
      app.classList.toggle('voice-on', p > 0.06);
      const words = app.querySelectorAll('.heard .w');
      const shown = Math.floor(words.length * seg(p, 0.14, 0.52));
      words.forEach((w, i) => w.classList.toggle('on', i < shown));
      const title = q(app, '.v-title');
      const t = p < 0.54 ? 'Слушаю' : p < 0.68 ? 'Расшифровка' : 'Нашлось 3';
      if (title && title.textContent !== t) title.textContent = t;
      const waves = q(app, '.waves');
      const bars = waves ? waves.children : [];
      const live = p > 0.1 && p < 0.54;
      for (let i = 0; i < bars.length; i++) {
        let s = 0.12;
        if (live) s = 0.2 + 0.8 * Math.abs(Math.sin(i * 0.62 + p * 64) * Math.cos(i * 0.21 - p * 23));
        else if (p >= 0.54 && p < 0.68) s = 0.08 + 0.1 * Math.abs(Math.sin(i * 0.5 + p * 40));
        bars[i].style.transform = `scaleY(${s.toFixed(3)})`;
      }
      if (waves) { const gone = p >= 0.66; waves.style.height = gone ? '0px' : ''; waves.style.opacity = gone ? '0' : ''; waves.style.margin = gone ? '0' : ''; waves.style.transition = 'height 420ms var(--ease-out), opacity 300ms, margin 420ms'; }
      const heard = q(app, '.heard');
      if (heard) { heard.style.transition = 'opacity 300ms, max-height 420ms'; heard.style.opacity = p >= 0.66 ? '0.55' : ''; }
      tog(q(app, '.vlist'), 'in', p > 0.68);
      app.querySelectorAll('.vrow').forEach((r, i) => r.classList.toggle('in', p > 0.7 + i * 0.07));
      tog(q(app, '.add-btn'), 'in', p > 0.92);
    },
    calendar(app, p) {
      app.querySelectorAll('[data-c]').forEach((li) => {
        const i = +li.dataset.c;
        const on = p > (i - 1) * 0.12;
        li.style.transition = 'opacity 400ms, transform 500ms var(--ease-out)';
        li.style.opacity = on ? '' : '0';
        li.style.transform = on ? '' : 'translateX(18px)';
      });
      tog(q(app, '[data-c="4"]'), 'done', p > 0.72);
      tog(q(app, '[data-c="3"]'), 'done', p > 0.9);
    },
    group(app, p) {
      const v = Math.round(96000 + 32000 * seg(p, 0.15, 0.6));
      const n = q(app, '.g-n');
      const txt = v.toLocaleString('ru-RU').replace(/ /g, ' ');
      if (n && n.textContent !== txt) n.textContent = txt;
      const bar = q(app, '.g-bar');
      if (bar) bar.style.width = (v / 150000) * 100 + '%';
      tog(q(app, '[data-g="2"]'), 'done', p > 0.66);
      tog(q(app, '[data-g="3"]'), 'done', p > 0.86);
      const c = q(app, '.g-count');
      if (c) c.textContent = (1 + (p > 0.66) + (p > 0.86)) + ' из 3';
    },
  };

  function set(app, p) {
    const fn = SETTERS[app.dataset.screen];
    if (fn) fn(app, clamp(p, 0, 1));
  }

  /** Проиграть экран по кругу: 0→1 за duration, пауза hold, сброс. */
  function loop(app, opts) {
    const o = Object.assign({ duration: 7000, hold: 1600, delay: 0 }, opts);
    if (reduced) { set(app, 1); return { stop() {} }; }
    let raf = 0; let start = 0; let alive = true;
    const tick = (t) => {
      if (!alive) return;
      if (!start) start = t + o.delay;
      const e = t - start;
      const total = o.duration + o.hold;
      const p = e < 0 ? 0 : (e % total) / o.duration;
      set(app, p > 1 ? 1 : p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return { stop() { alive = false; cancelAnimationFrame(raf); } };
  }

  /* ── кнопки скачивания ── */
  const LINKS = { apple: '#', play: '#', tg: 'https://t.me/LifeCommit_bot' };
  /* QR не рисуем: с компьютера есть кнопка Telegram (решение владелицы 04.10.2026) */
  function storesHTML() {
    const b = (cls, href, icon, small, big) =>
      `<a class="store ${cls}" href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${I[icon]}<span><small>${small}</small><b>${big}</b></span></a>`;
    return b('apple', LINKS.apple, 'apple', 'Загрузите в', 'App Store')
      + b('play', LINKS.play, 'play', 'Доступно в', 'Google Play')
      + b('tg', LINKS.tg, 'tg', 'Открыть в', 'Telegram');
  }

  function mount(root) {
    (root || document).querySelectorAll('.app[data-screen]').forEach((app) => {
      if (app.dataset.mounted) return;
      const dark = app.hasAttribute('data-dark');
      app.classList.toggle('dark', dark);
      app.innerHTML = SCREENS[app.dataset.screen](dark);
      app.dataset.mounted = '1';
      set(app, app.dataset.p ? +app.dataset.p : 0);
    });
    (root || document).querySelectorAll('[data-stores]').forEach((el) => {
      el.classList.add('stores');
      if (!el.dataset.tone) el.dataset.tone = 'dark';
      el.innerHTML = storesHTML();
    });
  }

  /* ── каталог ── */
  const VARIANTS = [
    { id: 'a', name: 'Тишина' },
    { id: 'b', name: 'Ночь' },
    { id: 'c', name: 'Клетки' },
    { id: 'd', name: 'Голос' },
    { id: 'e', name: 'Стекло' },
  ];
  function switcher(current) {
    const v = VARIANTS.find((x) => x.id === current);
    const nav = document.createElement('nav');
    nav.className = 'lc-switch';
    nav.setAttribute('aria-label', 'Варианты лендинга');
    nav.innerHTML = `<a href="index.html" aria-label="Все варианты">${I.today.replace('<svg ', '<svg width="16" height="16" ')}</a>`
      + (v ? `<span class="lc-name">${v.id.toUpperCase()} · ${v.name}</span>` : '')
      + VARIANTS.map((x) => `<a href="${x.id}.html"${x.id === current ? ' class="on" aria-current="page"' : ''}>${x.id.toUpperCase()}</a>`).join('');
    document.body.appendChild(nav);
  }

  window.LC = { I, os, reduced, mount, set, loop, storesHTML, switcher, VARIANTS, PHRASE, LINKS };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
  else mount();
})();
