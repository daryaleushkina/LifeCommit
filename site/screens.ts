// Живые экраны приложения внутри телефонов на лендинге: «Сегодня», «Голос», «Календарь», «Группа».
// Свёрстаны по app.css (стиль A), в 390×844 и масштабируются под телефон. Состояние задаётся числом p от 0 до 1 —
// его крутит прокрутка (GSAP ScrollTrigger) или setInterval. Русский и английский, светлая и тёмная тема.

export type Lang = 'ru' | 'en';
export type Screen = 'today' | 'voice' | 'calendar' | 'group';
export type GroupKind = 'work' | 'family' | 'friends';

const S = (d: string, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICON = {
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6),
  cross: S('<path d="M7 7l10 10M17 7L7 17"/>', 2.6),
  pencil: S('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  mic: S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
  today:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1.4"/><rect x="10" y="3" width="5" height="5" rx="1.4"/><rect x="17" y="3" width="5" height="5" rx="1.4"/><rect x="3" y="10" width="5" height="5" rx="1.4"/><rect x="10" y="10" width="5" height="5" rx="1.4"/><rect x="17" y="10" width="5" height="5" rx="1.4"/><rect x="3" y="17" width="5" height="5" rx="1.4"/><rect x="10" y="17" width="5" height="5" rx="1.4"/><rect x="17" y="17" width="5" height="5" rx="1.4"/></svg>',
  calendar: S('<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  people: S('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19.5c.6-3 3.2-4.8 6.5-4.8s5.9 1.8 6.5 4.8"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.9c2.3.5 3.8 2.1 4.2 4.6"/>'),
  me: S('<circle cx="12" cy="8" r="4"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>'),
  drop: S('<path d="M12 3.5c3.6 4.4 6 7.7 6 10.7a6 6 0 0 1-12 0c0-3 2.4-6.3 6-10.7z"/>'),
  gym: S('<path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11"/>', 2.2),
  candy: S('<circle cx="12" cy="12" r="4.2"/><path d="M7.8 12L4 9.3v5.4zM16.2 12L20 9.3v5.4z"/>'),
  phone: S('<path d="M6.5 3.5h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>'),
  doc: S('<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5"/>'),
};

const STATUS = `<div class="status"><span>9:41</span><span class="status-r">
  <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.2c2.2 0 4.2.9 5.7 2.3l1.2-1.2A9.8 9.8 0 0 0 8 .5 9.8 9.8 0 0 0 1.1 3.3l1.2 1.2A8 8 0 0 1 8 2.2zm0 3.4c1.3 0 2.5.5 3.4 1.4l1.2-1.2A6.5 6.5 0 0 0 8 3.9a6.5 6.5 0 0 0-4.6 1.9L4.6 7A4.8 4.8 0 0 1 8 5.6zm0 3.4c.4 0 .8.2 1.1.4L8 10.6 6.9 9.4c.3-.2.7-.4 1.1-.4z"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".45"/></svg>
</span></div><div class="island"></div>`;

interface Dict {
  tabs: [string, string, string, string];
  today: string;
  date: string;
  todos: string;
  all: string;
  left: string;
  habits: string;
  call: string;
  callTeam: string;
  feedCat: string;
  gym: string;
  gymDays: string;
  water: string;
  glasses: (n: number) => string;
  noSweets: string;
  daysWithout: (n: number) => string;
  listening: string;
  parsing: string;
  found: string;
  phrase: string;
  toGroup: string;
  mine: string;
  report: string;
  reportLine: string;
  callBank: string;
  callBankLine: string;
  waterDaily: string;
  add: string;
  calendar: string;
  week: [string, number][];
  saturday: string;
  nTodos: string;
  tomorrow: string;
  fromYesterday: string;
  doctor: string;
  cal: [string, string, string?][];
  groups: Record<GroupKind, GroupData>;
}

export interface GroupData {
  /** Подпись вкладки на лендинге. */
  tab: string;
  title: string;
  letter: string;
  people: string;
  goal: string;
  goalFrom: number;
  goalTo: number;
  goalOf: number;
  /** Дела группы: [название, подпись, время?]; первое уже сделано, второе и третье отмечаются по ходу. */
  items: [string, string, string?][];
  /** Сообщение бота в чате группы. */
  chat: { title: string; botHead: string; lines: string[]; buttons: [string, string]; reply: string; added: string };
}

const fmt = (n: number, lang: Lang) => n.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US').replace(/ /g, ' ');

export const T: Record<Lang, Dict> = {
  ru: {
    tabs: ['Сегодня', 'Календарь', 'Вместе', 'Я'],
    today: 'Сегодня',
    date: 'суббота, 4 октября',
    todos: 'Дела',
    all: 'Все',
    left: 'Осталось',
    habits: 'Привычки',
    call: 'Позвонить в банк',
    callTeam: 'Созвон с командой',
    feedCat: 'Купить корм коту',
    gym: 'Сходить в спортзал',
    gymDays: 'пн, ср, пт',
    water: 'Пить воду',
    glasses: (n) => `<em class="n">${n}</em> из 8 стаканов`,
    noSweets: 'Без сладкого',
    daysWithout: (n) => `<em class="d">${n}</em> дней без этого`,
    listening: 'Слушаю',
    parsing: 'Разбираю',
    found: 'Нашлось 3',
    phrase: 'Завтра в три позвонить в банк, каждый день пить воду, а в группу Работа — Маше подготовить отчёт к пятнице',
    toGroup: 'В группу «Работа»',
    mine: 'Себе',
    report: 'Подготовить отчёт',
    reportLine: 'Маша · до пятницы',
    callBank: 'Позвонить в банк',
    callBankLine: 'завтра, 15:00',
    waterDaily: 'каждый день',
    add: 'Добавить 3',
    calendar: 'Календарь',
    week: [['пн', 29], ['вт', 30], ['ср', 1], ['чт', 2], ['пт', 3], ['сб', 4], ['вс', 5]],
    saturday: 'Суббота',
    nTodos: '5 дел',
    tomorrow: 'Завтра',
    fromYesterday: 'со вчера',
    doctor: 'Записаться к врачу',
    cal: [['Йога в парке', '09:30', 'A'], ['Обед с Аней', '12:00', 'G'], ['Позвонить в банк', '15:00'], ['Купить корм коту', ''], ['День рождения Пети', '19:00', 'A']],
    groups: {
      work: {
        tab: 'Работа',
        title: 'Работа',
        letter: 'Р',
        people: '6 человек',
        goal: 'Заявки за октябрь',
        goalFrom: 27,
        goalTo: 34,
        goalOf: 40,
        items: [['Созвон с командой', 'мероприятие', '11:00'], ['Подготовить отчёт', 'Маша · до пятницы'], ['Дежурство по релизу', 'по очереди · сегодня Петя'], ['Заполнить таймшит', 'каждый своё']],
        chat: {
          title: 'Работа',
          botHead: 'Сегодня в «Работе»',
          lines: ['Созвон с командой · 11:00', 'Отчёт · Маша', 'Дежурство · Петя'],
          buttons: ['✓ Отчёт', '✓ Дежурство'],
          reply: '0:04',
          added: 'Добавил: «Демо клиенту» · чт, 14:00',
        },
      },
      family: {
        tab: 'Семья',
        title: 'Семья',
        letter: 'С',
        people: '4 человека',
        goal: 'Отпуск',
        goalFrom: 96000,
        goalTo: 128000,
        goalOf: 150000,
        items: [['Покормить кота', 'кто-то один · Петя'], ['Вынести мусор', 'по очереди · сегодня Маша'], ['Полить цветы', 'каждый своё'], ['Ужин у бабушки', 'мероприятие', '19:00']],
        chat: {
          title: 'Семья',
          botHead: 'Сегодня в «Семье»',
          lines: ['Кот накормлен · Петя', 'Мусор · Маша', 'Ужин у бабушки · 19:00'],
          buttons: ['✓ Мусор', '✓ Цветы'],
          reply: '0:03',
          added: 'Добавил: «Купить подарок маме» · до вс',
        },
      },
      friends: {
        tab: 'Друзья',
        title: 'Поход',
        letter: 'П',
        people: '5 человек',
        goal: 'На домик',
        goalFrom: 12000,
        goalTo: 18000,
        goalOf: 24000,
        items: [['Забронировать домик', 'кто-то один · Аня'], ['Купить продукты', 'кто-то один'], ['Взять палатку', 'Андрей'], ['Сбор у метро', 'мероприятие · сб', '08:00']],
        chat: {
          title: 'Поход',
          botHead: 'Сегодня в «Походе»',
          lines: ['Домик забронирован · Аня', 'Продукты · кто возьмёт?', 'Палатка · Андрей'],
          buttons: ['✓ Продукты', '✓ Палатка'],
          reply: '0:05',
          added: 'Добавил: «Взять гитару» · Петя',
        },
      },
    },
  },
  en: {
    tabs: ['Today', 'Calendar', 'Together', 'Me'],
    today: 'Today',
    date: 'Saturday, October 4',
    todos: 'To-dos',
    all: 'All',
    left: 'Left',
    habits: 'Habits',
    call: 'Call the bank',
    callTeam: 'Team call',
    feedCat: 'Buy cat food',
    gym: 'Go to the gym',
    gymDays: 'Mon, Wed, Fri',
    water: 'Drink water',
    glasses: (n) => `<em class="n">${n}</em> of 8 glasses`,
    noSweets: 'No sweets',
    daysWithout: (n) => `<em class="d">${n}</em> days without`,
    listening: 'Listening',
    parsing: 'Sorting it out',
    found: 'Found 3',
    phrase: 'Call the bank tomorrow at three, drink water every day, and for Work — Masha prepares the report by Friday',
    toGroup: 'To “Work”',
    mine: 'For me',
    report: 'Prepare the report',
    reportLine: 'Masha · by Friday',
    callBank: 'Call the bank',
    callBankLine: 'tomorrow, 3:00 PM',
    waterDaily: 'every day',
    add: 'Add 3',
    calendar: 'Calendar',
    week: [['Mon', 29], ['Tue', 30], ['Wed', 1], ['Thu', 2], ['Fri', 3], ['Sat', 4], ['Sun', 5]],
    saturday: 'Saturday',
    nTodos: '5 to-dos',
    tomorrow: 'Tomorrow',
    fromYesterday: 'from yesterday',
    doctor: 'Book a doctor',
    cal: [['Yoga in the park', '9:30', 'A'], ['Lunch with Anna', '12:00', 'G'], ['Call the bank', '15:00'], ['Buy cat food', ''], ['Pete’s birthday', '19:00', 'A']],
    groups: {
      work: {
        tab: 'Work',
        title: 'Work',
        letter: 'W',
        people: '6 people',
        goal: 'Leads in October',
        goalFrom: 27,
        goalTo: 34,
        goalOf: 40,
        items: [['Team call', 'event', '11:00'], ['Prepare the report', 'Masha · by Friday'], ['Release duty', 'in turns · Pete today'], ['Fill in the timesheet', 'everyone their own']],
        chat: {
          title: 'Work',
          botHead: 'Today in “Work”',
          lines: ['Team call · 11:00', 'Report · Masha', 'Release duty · Pete'],
          buttons: ['✓ Report', '✓ Duty'],
          reply: '0:04',
          added: 'Added: “Client demo” · Thu, 2:00 PM',
        },
      },
      family: {
        tab: 'Family',
        title: 'Family',
        letter: 'F',
        people: '4 people',
        goal: 'Vacation',
        goalFrom: 960,
        goalTo: 1280,
        goalOf: 1500,
        items: [['Feed the cat', 'anyone once · Pete'], ['Take out the trash', 'in turns · Masha today'], ['Water the plants', 'everyone their own'], ['Dinner at grandma’s', 'event', '19:00']],
        chat: {
          title: 'Family',
          botHead: 'Today in “Family”',
          lines: ['Cat fed · Pete', 'Trash · Masha', 'Dinner at grandma’s · 19:00'],
          buttons: ['✓ Trash', '✓ Plants'],
          reply: '0:03',
          added: 'Added: “Buy mom a gift” · by Sun',
        },
      },
      friends: {
        tab: 'Friends',
        title: 'Hiking trip',
        letter: 'H',
        people: '5 people',
        goal: 'Cabin fund',
        goalFrom: 120,
        goalTo: 180,
        goalOf: 240,
        items: [['Book the cabin', 'anyone once · Anna'], ['Buy groceries', 'anyone once'], ['Bring the tent', 'Andrew'], ['Meet at the station', 'event · Sat', '8:00']],
        chat: {
          title: 'Hiking trip',
          botHead: 'Today in “Hiking trip”',
          lines: ['Cabin booked · Anna', 'Groceries · who takes it?', 'Tent · Andrew'],
          buttons: ['✓ Groceries', '✓ Tent'],
          reply: '0:05',
          added: 'Added: “Bring a guitar” · Pete',
        },
      },
    },
  },
};

function tabbar(d: Dict, on: number): string {
  const t = (i: number, icon: string) => `<span class="tab${on === i ? ' on' : ''}"><span class="pill">${icon}</span>${d.tabs[i]}</span>`;
  return `<nav class="tabbar">${t(0, ICON.today)}${t(1, ICON.calendar)}<span class="mic">${ICON.mic}</span>${t(2, ICON.people)}${t(3, ICON.me)}</nav>`;
}

function todayBody(d: Dict): string {
  return `<div class="body">
    <h1>${d.today}</h1><p class="sub">${d.date}</p>
    <div class="sec"><span>${d.todos}</span><span class="seg"><span class="on">${d.all}</span><span>${d.left}</span></span></div>
    <ul class="todos glass">
      <li class="ev"><span class="todo-box"></span><span class="todo-time">10:00</span><span class="todo-text">${d.callTeam}</span><span class="src">A</span></li>
      <li data-t="1"><span class="todo-box">${ICON.check}</span><span class="todo-time">15:00</span><span class="todo-text">${d.call}</span></li>
      <li data-t="2"><span class="todo-box">${ICON.check}</span><span class="todo-text">${d.feedCat}</span></li>
    </ul>
    <div class="sec"><span>${d.habits}</span></div>
    <div class="habits">
      <div class="habit glass" data-h="gym"><span class="tile check">${ICON.gym}</span><span class="h-main"><b>${d.gym}</b><span>${d.gymDays}</span></span><span class="rb ok">${ICON.check}</span></div>
      <div class="habit count glass" data-h="water"><span class="tile count">${ICON.drop}</span><span class="h-main"><b>${d.water}</b><span>${d.glasses(5)}</span></span><span class="rb edit">${ICON.pencil}</span><span class="rb ok">${ICON.check}</span><span class="bar"><i></i></span></div>
      <div class="habit glass" data-h="quit"><span class="tile quit">${ICON.candy}</span><span class="h-main"><b>${d.noSweets}</b><span>${d.daysWithout(12)}</span></span><span class="rb-pair"><span class="rb no">${ICON.cross}</span><span class="rb ok">${ICON.check}</span></span></div>
    </div>
  </div>`;
}

function voiceSheet(d: Dict): string {
  const row = (tile: string, icon: string, title: string, line: string) =>
    `<div class="vrow"><span class="tile ${tile}">${icon}</span><span><b>${title}</b><small>${line}</small></span></div>`;
  return `<div class="scrim"></div>
  <div class="sheet">
    <span class="grab"></span>
    <h2 class="v-title">${d.listening}</h2>
    <p class="heard">${d.phrase.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ')}</p>
    <div class="waves">${'<i></i>'.repeat(28)}</div>
    <div class="vlist">
      <div class="vsec">${d.toGroup}</div>
      ${row('group', ICON.doc, d.report, d.reportLine)}
      <div class="vsec">${d.mine}</div>
      ${row('todo', ICON.phone, d.callBank, d.callBankLine)}
      ${row('count', ICON.drop, d.water, d.waterDaily)}
    </div>
    <div class="add-btn">${d.add}</div>
  </div>`;
}

function calendarBody(d: Dict): string {
  const li = ([text, time, src]: [string, string, string?], i: number) => {
    const ev = !!src;
    return `<li class="${ev ? 'ev' : ''}" data-c="${i + 1}"><span class="todo-box">${ev ? '' : ICON.check}</span>${time ? `<span class="todo-time">${time}</span>` : ''}<span class="todo-text">${text}</span>${src ? `<span class="src${src === 'G' ? ' g' : ''}">${src}</span>` : ''}</li>`;
  };
  return `<div class="body">
    <h1>${d.calendar}</h1>
    <div class="week">${d.week.map(([w, n], i) => `<span class="${i === 5 ? 'on' : ''}">${w}<b>${n}</b>${i % 2 === 0 || i === 5 ? '<i></i>' : ''}</span>`).join('')}</div>
    <div class="sec"><span>${d.saturday}</span><span>${d.nTodos}</span></div>
    <ul class="todos glass">${d.cal.map(li).join('')}</ul>
    <div class="sec"><span>${d.tomorrow}</span></div>
    <ul class="todos glass"><li><span class="todo-box">${ICON.check}</span><span class="todo-text">${d.doctor}</span><span class="chip">${d.fromYesterday}</span></li></ul>
  </div>`;
}

const AVA = [['#DDE3F0', '#23365C'], ['#F1E3C8', '#5A4214'], ['#EBDCE6', '#5A2748']];

function groupBody(d: Dict, kind: GroupKind, lang: Lang): string {
  const g = d.groups[kind];
  const people = (lang === 'ru' ? ['М', 'П', 'А'] : ['M', 'P', 'A']).map((l, i) => `<span class="ava" style="background:${AVA[i]![0]};color:${AVA[i]![1]}">${l}</span>`).join('');
  const items = g.items
    .map(([title, line, time], i) => {
      const ev = line.startsWith(lang === 'ru' ? 'мероприятие' : 'event');
      return `<li data-g="${i + 1}" class="${ev ? 'ev' : i === 0 ? 'done' : ''}"><span class="todo-box">${ev ? '' : ICON.check}</span>${time ? `<span class="todo-time">${time}</span>` : ''}<span class="todo-text col"><span>${title}</span><span class="chip">${line}</span></span></li>`;
    })
    .join('');
  return `<div class="body">
    <div class="ghead"><span class="gtile">${g.letter}</span><span class="gname"><h1>${g.title}</h1><span class="people">${people}<span class="pcount">${g.people}</span></span></span></div>
    <div class="goal glass"><b>${g.goal}</b><p class="num"><em class="g-n">${fmt(g.goalFrom, lang)}</em> ${lang === 'ru' ? 'из' : 'of'} ${fmt(g.goalOf, lang)}</p><span class="bar"><i class="g-bar"></i></span></div>
    <div class="sec"><span>${d.today}</span><span class="g-count"></span></div>
    <ul class="todos glass">${items}</ul>
  </div>`;
}

export interface ScreenOpts {
  screen: Screen;
  lang: Lang;
  dark: boolean;
  group?: GroupKind;
}

/** Собирает экран в элементе .app и ставит его в состояние p. */
export function render(app: HTMLElement, o: ScreenOpts, p = 0): void {
  const d = T[o.lang];
  app.dataset.screen = o.screen;
  app.dataset.lang = o.lang;
  if (o.group) app.dataset.group = o.group;
  app.classList.toggle('dark', o.dark);
  const body =
    o.screen === 'today'
      ? todayBody(d) + tabbar(d, 0)
      : o.screen === 'voice'
        ? todayBody(d) + tabbar(d, 0) + voiceSheet(d)
        : o.screen === 'calendar'
          ? calendarBody(d) + tabbar(d, 1)
          : groupBody(d, o.group ?? 'work', o.lang) + tabbar(d, 2);
  app.innerHTML = STATUS + body;
  setState(app, p);
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
const tog = (el: Element | null, cls: string, on: boolean) => el?.classList.toggle(cls, on);
const text = (el: HTMLElement | null, t: string) => {
  if (el && el.textContent !== t) el.textContent = t;
};

/** Состояние экрана при прогрессе p ∈ [0, 1]. */
export function setState(app: HTMLElement, p: number): void {
  p = clamp(p);
  const lang = (app.dataset.lang ?? 'ru') as Lang;
  const d = T[lang];
  const screen = app.dataset.screen as Screen;
  if (screen === 'today' || screen === 'voice') {
    tog(q(app, '[data-t="2"]'), 'done', p > 0.16);
    tog(q(app, '[data-h="gym"] .rb.ok'), 'on', p > 0.32);
    const n = Math.round(5 + 3 * seg(p, 0.45, 0.78));
    text(q(app, '[data-h="water"] .n'), String(n));
    const bar = q(app, '[data-h="water"] .bar i');
    if (bar) bar.style.width = `${(n / 8) * 100}%`;
    tog(q(app, '[data-h="water"] .rb.ok'), 'on', n >= 8);
    tog(q(app, '[data-h="quit"] .rb.ok'), 'on', p > 0.88);
    tog(q(app, '[data-h="quit"] .rb.no'), 'dim', p > 0.88);
    text(q(app, '[data-h="quit"] .d'), p > 0.88 ? '13' : '12');
    tog(q(app, '[data-t="1"]'), 'done', p > 0.95);
  }
  if (screen === 'voice') voiceState(app, d, p);
  if (screen === 'calendar') {
    app.querySelectorAll<HTMLElement>('[data-c]').forEach((li) => {
      const on = p > (Number(li.dataset.c) - 1) * 0.12;
      li.style.opacity = on ? '' : '0';
      li.style.transform = on ? '' : 'translateX(18px)';
    });
    tog(q(app, '[data-c="4"]'), 'done', p > 0.72);
    tog(q(app, '[data-c="3"]'), 'done', p > 0.9);
  }
  if (screen === 'group') {
    const g = d.groups[(app.dataset.group ?? 'work') as GroupKind];
    const v = Math.round(g.goalFrom + (g.goalTo - g.goalFrom) * seg(p, 0.15, 0.6));
    text(q(app, '.g-n'), fmt(v, lang));
    const bar = q(app, '.g-bar');
    if (bar) bar.style.width = `${(v / g.goalOf) * 100}%`;
    const second = p > 0.62;
    const third = p > 0.84;
    // в «Работе» первым идёт созвон (мероприятие) — отмечаются второе и третье
    tog(q(app, '[data-g="2"]'), 'done', second);
    tog(q(app, '[data-g="3"]'), 'done', third);
    const total = g.items.filter(([, line]) => !line.startsWith(lang === 'ru' ? 'мероприятие' : 'event')).length;
    const done = (g.items[0]![1].startsWith(lang === 'ru' ? 'мероприятие' : 'event') ? 0 : 1) + Number(second) + Number(third);
    text(q(app, '.g-count'), lang === 'ru' ? `${done} из ${total}` : `${done} of ${total}`);
  }
}

function voiceState(app: HTMLElement, d: Dict, p: number): void {
  app.classList.toggle('voice-on', p > 0.06);
  const words = app.querySelectorAll<HTMLElement>('.heard .w');
  const shown = Math.floor(words.length * seg(p, 0.14, 0.52));
  words.forEach((w, i) => w.classList.toggle('on', i < shown));
  text(q(app, '.v-title'), p < 0.54 ? d.listening : p < 0.68 ? d.parsing : d.found);
  const waves = q(app, '.waves');
  if (waves) {
    const live = p > 0.1 && p < 0.54;
    Array.from(waves.children).forEach((bar, i) => {
      let s = 0.12;
      if (live) s = 0.2 + 0.8 * Math.abs(Math.sin(i * 0.62 + p * 64) * Math.cos(i * 0.21 - p * 23));
      else if (p >= 0.54 && p < 0.68) s = 0.08 + 0.1 * Math.abs(Math.sin(i * 0.5 + p * 40));
      (bar as HTMLElement).style.transform = `scaleY(${s.toFixed(3)})`;
    });
    waves.classList.toggle('gone', p >= 0.66);
  }
  tog(q(app, '.heard'), 'faded', p >= 0.66);
  tog(q(app, '.vlist'), 'in', p > 0.68);
  app.querySelectorAll('.vrow').forEach((r, i) => r.classList.toggle('in', p > 0.7 + i * 0.07));
  tog(q(app, '.add-btn'), 'in', p > 0.92);
}

/** Проигрывать экран по кругу (для телефонов, которые не крутятся прокруткой). */
export function loop(app: HTMLElement, duration = 7000, hold = 1600): () => void {
  let raf = 0;
  let start = 0;
  const tick = (t: number) => {
    if (!start) start = t;
    const e = (t - start) % (duration + hold);
    setState(app, Math.min(1, e / duration));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
