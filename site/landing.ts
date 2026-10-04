// Лендинг lifecommit.app — вариант B «Ночь», выбранный владелицей 04.10.2026, в двух темах.
// Под страницей — поле клеток-дней на canvas: почти невидимое, дышит, свет идёт за курсором; в сцене «Голос»
// клетки загораются в ритм речи. Сцена «Голос» на широком экране закреплена и прокручивается как история.
import './site.css';
import './screens.css';
import './landing.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { currentTheme, initCommon, onTheme, type Theme } from './common';
import { render, setState, loop, T, type GroupKind, type Lang, type Screen } from './screens';

gsap.registerPlugin(ScrollTrigger, SplitText);

const lang: Lang = document.documentElement.lang === 'en' ? 'en' : 'ru';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<E>(sel);
const $$ = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<E>(sel));
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));

initCommon();

/* ───────────── экраны в телефонах ───────────── */
const apps = $$('.app[data-screen]');
const appProgress = new Map<HTMLElement, number>();
function paintApps(t: Theme) {
  for (const app of apps) {
    render(app, { screen: app.dataset.screen as Screen, lang, dark: t === 'dark', group: (app.dataset.group as GroupKind | undefined) ?? 'work' }, appProgress.get(app) ?? 0);
  }
}
function setApp(app: HTMLElement, p: number) {
  appProgress.set(app, p);
  setState(app, p);
}
paintApps(currentTheme());

/* ───────────── абзац «Голоса» светлеет слово за словом ───────────── */
const voiceText = $('#voiceText');
if (voiceText) voiceText.innerHTML = (voiceText.textContent ?? '').split(' ').map((w) => `<span class="w">${w}</span>`).join(' ');
const vWords = $$('.w', voiceText ?? document);
if (reduced) vWords.forEach((w) => w.classList.add('lit'));

/* ───────────── поле клеток ───────────── */
interface Field {
  dim: number; dimT: number; spot: number; ignite: number; igA: number; sweepX: number;
  voiceP: number; voiceA: number; voiceAT: number; anchor: HTMLElement | null;
}
const F: Field = { dim: 1, dimT: 1, spot: 1, ignite: reduced ? 1 : 0, igA: reduced ? 0 : 1, sweepX: -1, voiceP: 0, voiceA: 0, voiceAT: 0, anchor: $('#heroPh') };

const cv = $<HTMLCanvasElement>('#field');
const ctx = cv?.getContext('2d') ?? null;
const N = 48;
let LUT: string[] = [];
let glow: HTMLCanvasElement | null = null;
let glowMode: GlobalCompositeOperation = 'lighter';

function palette(t: Theme) {
  // от почти невидимой клетки к ярко-зелёной: в тёмной — свет на тёмном, в светлой — зелень на бумаге
  const stops: [number, number, number, number][] =
    t === 'dark'
      ? [[30, 42, 34, 0.32], [30, 74, 46, 0.7], [43, 113, 67, 0.85], [63, 169, 104, 0.95], [124, 203, 150, 1]]
      : [[31, 42, 31, 0.03], [63, 169, 104, 0.12], [124, 203, 150, 0.4], [63, 169, 104, 0.7], [35, 122, 70, 0.9]];
  LUT = [];
  for (let k = 0; k < N; k++) {
    const x = (k / (N - 1)) * (stops.length - 1);
    const a = Math.floor(x);
    const b = Math.min(stops.length - 1, a + 1);
    const f = x - a;
    const c = stops[a]!.map((v, i) => v + (stops[b]![i]! - v) * f);
    LUT.push(`rgba(${c[0]! | 0},${c[1]! | 0},${c[2]! | 0},${c[3]!.toFixed(3)})`);
  }
  glow = document.createElement('canvas');
  glow.width = glow.height = 96;
  const g = glow.getContext('2d');
  if (g) {
    const rg = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    if (t === 'dark') {
      rg.addColorStop(0, 'rgba(76,184,120,0.55)'); rg.addColorStop(0.4, 'rgba(63,169,104,0.18)'); rg.addColorStop(1, 'rgba(63,169,104,0)');
    } else {
      rg.addColorStop(0, 'rgba(63,169,104,0.22)'); rg.addColorStop(0.45, 'rgba(124,203,150,0.1)'); rg.addColorStop(1, 'rgba(124,203,150,0)');
    }
    g.fillStyle = rg;
    g.fillRect(0, 0, 96, 96);
  }
  glowMode = t === 'dark' ? 'lighter' : 'source-over';
}
palette(currentTheme());

let W = 0, H = 0, S = 26, CS = 20, RAD = 5, cols = 0, rows = 0, ox = 0, oy = 0;
let phase = new Float32Array(0);
function resize() {
  if (!cv || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = W < 700 ? 22 : 26; CS = S - (W < 700 ? 5 : 6); RAD = W < 700 ? 4 : 5;
  cols = Math.ceil(W / S) + 1; rows = Math.ceil(H / S) + 1;
  ox = (W - cols * S + (S - CS)) / 2; oy = (H - rows * S + (S - CS)) / 2;
  phase = new Float32Array(cols * rows);
  for (let i = 0; i < phase.length; i++) phase[i] = Math.random() * 6.283;
  if (reduced) draw(performance.now());
}

const spot = { x: -999, y: -999, tx: -999, ty: -999, last: -1e9 };
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') { spot.tx = e.clientX; spot.ty = e.clientY; spot.last = performance.now(); }
}, { passive: true });

const buckets: number[][] = Array.from({ length: N }, () => []);
const glows: number[] = [];

function draw(now: number) {
  if (!ctx) return;
  const t = now / 1000;
  if (now - spot.last > 2500) {
    spot.tx = W * (0.5 + 0.32 * Math.sin(t * 0.21)); spot.ty = H * (0.48 + 0.26 * Math.sin(t * 0.29 + 1.3));
  }
  if (spot.x < -900) { spot.x = spot.tx; spot.y = spot.ty; }
  spot.x += (spot.tx - spot.x) * 0.075; spot.y += (spot.ty - spot.y) * 0.075;
  F.dim += (F.dimT - F.dim) * 0.05;
  F.voiceA += (F.voiceAT - F.voiceA) * 0.06;

  let acx = W * 0.7, acy = H * 0.5, aL = acx - 150, aR = acx + 150;
  if (F.anchor) { const r = F.anchor.getBoundingClientRect(); acx = r.left + r.width / 2; acy = r.top + r.height / 2; aL = r.left; aR = r.right; }
  const maxD = Math.hypot(Math.max(acx, W - acx), Math.max(acy, H - acy));
  const igR = F.ignite * (maxD + 120);
  const sweepPx = F.sweepX * W;
  const sweepOn = F.sweepX > -0.2 && F.sweepX < 1.2;
  const SR = Math.max(200, Math.min(W, H) * 0.32), SR2 = SR * SR;
  const vp = F.voiceP, va = F.voiceA;
  const live = va > 0.01 && vp > 0.1 && vp < 0.54;
  const decode = va > 0.01 && vp >= 0.54 && vp < 0.68;
  const found = va > 0.01 && vp >= 0.68;
  const crow = Math.round((acy - oy - CS / 2) / S);
  const colOf = (x: number) => Math.round((x - ox - CS / 2) / S);
  const fcols = [colOf(aL) - 5, colOf(aL) - 2, colOf(aR) + 2].map((c) => Math.max(0, Math.min(cols - 1, c)));
  const decX = seg(vp, 0.54, 0.68) * (W + 200) - 100;
  const narrow = W < 700 ? 0.7 : 1;

  for (const b of buckets) b.length = 0;
  glows.length = 0;
  for (let r = 0; r < rows; r++) {
    const y = oy + r * S, cy = y + CS / 2, dr = Math.abs(r - crow);
    for (let c = 0; c < cols; c++) {
      const x = ox + c * S, cx = x + CS / 2;
      let base = 0.012 + 0.032 * (0.5 + 0.5 * Math.sin(t * 0.55 + (phase[r * cols + c] ?? 0)));
      const dx = cx - spot.x, dy = cy - spot.y, d2 = dx * dx + dy * dy;
      if (d2 < SR2) { const f = 1 - Math.sqrt(d2) / SR; base += f * f * 0.62 * F.spot; }
      let i = base * F.dim * narrow;
      if (F.igA > 0.01) { const d = Math.hypot(cx - acx, cy - acy); const w = (d - igR) / 80; i += Math.exp(-w * w) * 0.85 * F.igA; }
      if (sweepOn) { const w = (cx - sweepPx) / 120; i += Math.exp(-w * w) * 0.42; }
      if (live) {
        const b = c % 28;
        const e = Math.abs(Math.sin(b * 0.62 + vp * 64) * Math.cos(b * 0.21 - vp * 23));
        const band = e * rows * 0.3 * Math.exp(-Math.pow((cx - acx) / (W * 0.27), 2));
        if (dr < band) i += (0.22 + 0.5 * e) * (1 - dr / band) * va;
      } else if (decode) {
        if (dr <= 1) { const w = (cx - decX) / 70; i += (0.12 + Math.exp(-w * w) * 0.7) * va * (dr === 0 ? 1 : 0.5); }
      } else if (found && narrow === 1) {
        for (let k = 0; k < 3; k++) {
          if (c === fcols[k]) { const a = seg(vp, 0.7 + k * 0.07, 0.75 + k * 0.07); i += a * (0.85 - 0.6 * Math.min(1, dr / (rows * 0.6))) * va; }
        }
      }
      if (i > 1) i = 1;
      buckets[Math.min(N - 1, Math.round(i * (N - 1)))]!.push(x, y);
      if (i > 0.48) glows.push(cx, cy, i);
    }
  }
  ctx.clearRect(0, 0, W, H);
  for (let k = 0; k < N; k++) {
    const bk = buckets[k]!;
    if (!bk.length) continue;
    ctx.fillStyle = LUT[k]!;
    ctx.beginPath();
    for (let j = 0; j < bk.length; j += 2) ctx.roundRect(bk[j]!, bk[j + 1]!, CS, CS, RAD);
    ctx.fill();
  }
  if (glows.length && glow) {
    ctx.globalCompositeOperation = glowMode;
    for (let j = 0; j < glows.length; j += 3) {
      const s = S * 3.2 * glows[j + 2]!;
      ctx.globalAlpha = Math.min(1, (glows[j + 2]! - 0.4) * 1.6);
      ctx.drawImage(glow, glows[j]! - s / 2, glows[j + 1]! - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

let raf = 0;
let fieldVisible = true;
const frame = (now: number) => {
  if (fieldVisible) draw(now);
  raf = requestAnimationFrame(frame);
};
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (reduced) return;
  if (document.hidden) cancelAnimationFrame(raf);
  else raf = requestAnimationFrame(frame);
});

onTheme((t) => {
  palette(t);
  paintApps(t);
  renderChat(currentGroup);
  if (reduced) draw(performance.now());
});

/* ───────────── «Вместе»: примеры групп и чат Telegram ───────────── */
let currentGroup: GroupKind = 'work';
const groupApp = $('#groupApp');
const chat = $('#chat');
const tabs = $$<HTMLButtonElement>('.gtabs button');

function renderChat(kind: GroupKind) {
  if (!chat) return;
  const g = T[lang].groups[kind];
  const c = g.chat;
  const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  chat.innerHTML = `
    <div class="chat-head"><span class="chat-ava">${g.letter}</span><span><b>${c.title}</b><small>${lang === 'ru' ? 'чат в Telegram' : 'Telegram group'}</small></span></div>
    <div class="chat-body">
      <div class="msg bot"><b class="who">LifeCommit</b><p class="mh">${c.botHead}</p>
        <ul>${c.lines.map((l, i) => `<li class="${i === 0 ? 'done' : ''}"><i>${check}</i>${l}</li>`).join('')}</ul>
        <div class="kb">${c.buttons.map((b) => `<span>${b}</span>`).join('')}</div></div>
      <div class="msg me"><span class="quote">${lang === 'ru' ? 'в ответ LifeCommit' : 'reply to LifeCommit'}</span><span class="voice-row"><span class="vplay"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></span><span class="vbars">${[6, 11, 16, 9, 18, 13, 7, 15, 19, 10, 6, 12, 16, 8].map((h) => `<i style="height:${h}px"></i>`).join('')}</span><small>${c.reply}</small></span></div>
      <div class="msg bot"><b class="who">LifeCommit</b><p>${c.added}</p></div>
    </div>`;
}

function showGroup(kind: GroupKind, animate: boolean) {
  currentGroup = kind;
  tabs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.group === kind)));
  const swap = () => {
    if (groupApp) {
      groupApp.dataset.group = kind;
      render(groupApp, { screen: 'group', lang, dark: currentTheme() === 'dark', group: kind }, appProgress.get(groupApp) ?? 1);
    }
    renderChat(kind);
  };
  if (!animate || reduced) { swap(); return; }
  const els = [$('#togetherPh .phone-screen'), chat].filter((e): e is HTMLElement => !!e);
  gsap.to(els, {
    opacity: 0, y: 8, duration: 0.22, ease: 'power2.in',
    onComplete: () => { swap(); gsap.to(els, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }); },
  });
}
showGroup('work', false);

let autoGroups = !reduced;
tabs.forEach((b) => b.addEventListener('click', () => {
  autoGroups = false;
  showGroup((b.dataset.group as GroupKind | undefined) ?? 'work', true);
}));

/* ───────────── запуск анимаций ───────────── */
function start() {
  resize();
  const heroApp = $('#heroPh .app');
  const voiceApp = $('#voiceApp');
  // шаги есть в двух местах: в тексте (широкий экран) и над телефоном (телефон) — каждая строка считается сама
  const stepRows = $$('.steps').map((row) => $$('span', row));
  const setSteps = (p: number) => {
    const s = p < 0.02 ? -1 : p < 0.54 ? 0 : p < 0.68 ? 1 : 2;
    for (const row of stepRows) row.forEach((el, i) => { el.classList.toggle('on', i === s); el.classList.toggle('done', i < s); });
  };

  if (reduced) {
    apps.forEach((a) => setApp(a, 1));
    setSteps(1);
    F.igA = 0;
    draw(performance.now());
    return;
  }

  raf = requestAnimationFrame(frame);
  if (heroApp) loop(heroApp, 7000, 1800);

  // загрузка: клетки вспыхивают волной от телефона, потом строки заголовка, потом кнопки
  const h1 = $('#h1');
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.to(F, { ignite: 1, duration: 2.4, ease: 'power2.out' }, 0).to(F, { igA: 0, duration: 1.4, ease: 'power1.in' }, 1.1).from('#heroPh', { y: 80, opacity: 0, scale: 0.95, duration: 1.8 }, 0.1);
  if (h1) {
    const split = SplitText.create(h1, { type: 'lines', mask: 'lines', linesClass: 'ln' });
    tl.from(split.lines, { yPercent: 112, duration: 1.4, stagger: 0.09 }, 0.35).add(() => { split.revert(); h1.classList.add('sheen'); }, 2.4);
  }
  tl.from('.hero .line', { y: 16, opacity: 0, duration: 1.1 }, 0.9).from('.site-top > *', { y: -16, opacity: 0, duration: 1, stagger: 0.08 }, 0.6);

  // заголовки сцен выезжают строками из-под маски, остальное в блоке — следом; один раз. Разбиваем и прячем только в
  // момент появления (блок дошёл до низа экрана): если появление почему-то не сработает, заголовок и текст остаются
  // обычными и видимыми, а не спрятанными навсегда (так было в WebKit на GitHub Actions)
  $$('.copy, .final').forEach((box) => {
    const h2 = $('h2', box);
    if (!h2) return;
    ScrollTrigger.create({
      trigger: box, start: 'top bottom-=40', once: true,
      onEnter: () => {
        const split = SplitText.create(h2, { type: 'lines', mask: 'lines', linesClass: 'ln' });
        gsap.timeline({ defaults: { ease: 'expo.out' }, onComplete: () => split.revert() })
          .from(split.lines, { yPercent: 112, duration: 1.1, stagger: 0.08 })
          .from($$(':scope > :not(h2)', box), { y: 18, opacity: 0, duration: 0.9, stagger: 0.06 }, 0.15);
      },
    });
  });

  const mm = gsap.matchMedia();
  // «Голос»: закреплённая сцена, прокрутка ведёт шторку от «Слушаю» до «Нашлось 3»
  const vs = { p: 0 };
  const lightWords = (p: number) => {
    const lit = Math.round(vWords.length * Math.min(1, p));
    vWords.forEach((w, i) => w.classList.toggle('lit', i < lit));
  };
  let wordsWithVoice = true;
  const applyVoice = () => {
    if (voiceApp) setApp(voiceApp, vs.p);
    F.voiceP = vs.p;
    setSteps(vs.p);
    if (wordsWithVoice) lightWords(vs.p / 0.6);
  };
  mm.add('(min-width: 881px)', () => {
    wordsWithVoice = true;
    gsap.to(vs, { p: 1, ease: 'none', onUpdate: applyVoice, scrollTrigger: { trigger: '#voice .stage', start: 'top top', end: '+=230%', pin: true, scrub: 0.6 } });
  });
  mm.add('(max-width: 880px)', () => {
    // телефон прилипает под шапкой (CSS sticky) и целиком влезает в экран вместе с шагами над ним;
    // абзац светлеет сам, пока его читают, — к моменту, когда телефон прилип, он уже уехал вверх
    const ph = $('#voicePh');
    const phone = $('#voicePh .phone');
    const stage = $('#voice .stage');
    if (!ph || !phone || !stage) return;
    wordsWithVoice = false;
    const top = () => parseFloat(getComputedStyle(ph).top) || 0;
    // по высоте — чтобы влез под шапкой вместе с шагами; по ширине — не больше, чем CSS даёт этому экрану, и в поля 16px
    const fit = () => {
      const maxW = Math.min(window.innerWidth <= 420 ? 268 : 290, window.innerWidth - 32);
      phone.style.setProperty('--pw', String(Math.floor(clamp((window.innerHeight - top() - 64) / 2.0943, Math.min(220, maxW), maxW))));
    };
    fit();
    ScrollTrigger.addEventListener('refreshInit', fit);
    const st1 = ScrollTrigger.create({ trigger: '#voiceText', start: 'top 85%', end: 'bottom 50%', scrub: true, onUpdate: (st) => lightWords(st.progress) });
    // начало — телефон дошёл до места прилипания, конец — чуть раньше, чем он отлипнет: «Нашлось 3» постоит
    const tw = gsap.to(vs, {
      p: 1, ease: 'none', onUpdate: applyVoice,
      scrollTrigger: {
        // меряем от абзаца, а не от самого телефона: прилипший элемент ScrollTrigger измерил бы на месте прилипания
        trigger: '#voice .copy', start: () => `bottom top+=${top() - (parseFloat(getComputedStyle(stage).rowGap) || 0)}`,
        endTrigger: stage, end: () => `bottom top+=${top() + ph.offsetHeight + parseFloat(getComputedStyle(stage).paddingBottom) + window.innerHeight * 0.2}`,
        scrub: 0.4,
      },
    });
    return () => { ScrollTrigger.removeEventListener('refreshInit', fit); phone.style.removeProperty('--pw'); st1.kill(); tw.scrollTrigger?.kill(); };
  });
  ScrollTrigger.create({
    trigger: '#voice', start: 'top 70%', end: 'bottom 30%',
    onToggle: (st) => { F.voiceAT = st.isActive ? 1 : 0; F.anchor = st.isActive ? $('#voicePh') : st.direction < 0 ? $('#heroPh') : null; },
  });

  // остальные сцены: экран телефона доигрывается, пока телефон проходит через экран
  $$('.std').forEach((sec) => {
    const app = $('.app', sec);
    const phone = $('.phone', sec);
    if (!app || !phone) return;
    const st = { p: 0 };
    gsap.to(st, { p: 1, ease: 'none', onUpdate: () => setApp(app, st.p), scrollTrigger: { trigger: phone, start: 'top 88%', end: 'center 42%', scrub: 0.6 } });
    gsap.from($('.ph', sec), { y: 60, scale: 0.94, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'center center', scrub: 0.8 } });
  });
  gsap.from('#chat', { y: 40, x: -20, scale: 0.94, ease: 'none', scrollTrigger: { trigger: '#togetherPh .phone', start: 'top 85%', end: 'center 50%', scrub: 0.8 } });

  // примеры групп сами сменяют друг друга, пока сцену видно и человек сам не нажал
  const order: GroupKind[] = ['work', 'family', 'friends'];
  let timer = 0;
  ScrollTrigger.create({
    trigger: '#together', start: 'top 60%', end: 'bottom 30%',
    onToggle: (st) => {
      window.clearInterval(timer);
      if (st.isActive && autoGroups) {
        timer = window.setInterval(() => {
          if (!autoGroups) { window.clearInterval(timer); return; }
          showGroup(order[(order.indexOf(currentGroup) + 1) % order.length]!, true);
        }, 5200);
      }
    },
  });

  // переход между сценами — полоса света по полю
  $$('.scene, .final').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec, start: 'top 62%',
      onEnter: () => { gsap.fromTo(F, { sweepX: -0.25 }, { sweepX: 1.25, duration: 1.7, ease: 'power2.inOut', overwrite: true }); },
      onEnterBack: () => { gsap.fromTo(F, { sweepX: 1.25 }, { sweepX: -0.25, duration: 1.7, ease: 'power2.inOut', overwrite: true }); },
    });
  });

  // яркость поля по разделам
  const dimFor: [string, number, number][] = [['#hero', 1, 1], ['#voice', 0.7, 0.55], ['#habits', 0.45, 0.45], ['#calendar', 0.45, 0.45], ['#together', 0.45, 0.45], ['#download', 0.9, 0.9]];
  dimFor.forEach(([sel, d, s]) => ScrollTrigger.create({ trigger: sel, start: 'top center', end: 'bottom center', onToggle: (st) => { if (st.isActive) { F.dimT = d; F.spot = s; } } }));

  // поле не рисуем, когда вкладка в фоне или страница прокручена в подвал
  ScrollTrigger.create({ trigger: '.site-foot', start: 'top bottom', onToggle: (st) => { fieldVisible = !st.isActive; } });
}

// шрифт нужен до разбивки заголовка на строки; если шрифт не пришёл за 1,5 с — начинаем без него
void Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(start);
