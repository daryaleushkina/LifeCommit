// Голос и текст в группе → групповые дела с режимом «кто делает». Отдельная подсказка для модели:
// она знает участников и кто говорит, поэтому «Алёна моет посуду» — дело Алёне, «по очереди я и Петя» —
// очередь, «семейный ужин в семь» — мероприятие, «копим 150 тысяч на отпуск» — общая цель.
// Один запрос, как и у личного разбора (docs/groups-architecture.md, «Голос»).
import type { GroupItemDraft, GroupMode } from '../shared/groups';
import { cleanText } from '../shared/text';
import type { Env } from './env';
import { askModel, todayLine, type ModelSpec } from './voice';

const REPEATS = ['once', 'daily', 'weekdays', 'weekends', 'weekly', 'days'] as const;
const WD = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** Одно групповое дело в ответе модели — общее с разбором из мини-аппа (worker/voiceRoute.ts). */
export const GROUP_ITEM = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    mode: { type: 'string', enum: ['one', 'assign', 'event', 'goal'] },
    people: { type: 'array', items: { type: 'string' } },
    rotate: { type: 'boolean' },
    repeat: { type: 'string', enum: [...REPEATS] },
    weekdays: { type: 'array', items: { type: 'string', enum: [...WD] } },
    day: { type: 'string', nullable: true },
    time: { type: 'string', nullable: true },
    duration: { type: 'number', nullable: true },
    target: { type: 'number', nullable: true },
    unit: { type: 'string', nullable: true },
    currency: { type: 'string', nullable: true },
  },
  // Все поля обязательны (пустые — null): иначе модель от раза к разу пропускает дату, время и даже целые пункты.
  required: ['title', 'mode', 'people', 'rotate', 'repeat', 'weekdays', 'day', 'time', 'duration', 'target', 'unit', 'currency'],
};

const SCHEMA = { type: 'object', properties: { items: { type: 'array', items: GROUP_ITEM } }, required: ['items'] };

/** «Кто делает», расписание и цель — общее с разбором из мини-аппа (worker/voiceRoute.ts). */
export const GROUP_RULES = `For each thing to do, pick a mode:
- "one": anyone in the group can do it, once is enough (wash the floor, buy cat food, give the cat its inhaler). Default when nobody is named.
- "assign": specific people do it. people = their names exactly as in Members (convert inflected forms: «Алёне», «Алёной» → «Алёна»). «я», «мне», «сама», «сам» = the Speaker. «все», «каждый», «каждому», «everyone», «each» → people ["all"]. «по очереди», «take turns» → rotate true (people are the ones taking turns; nobody named → ["all"]).
- "event": something people attend rather than check off (family dinner, trip, birthday, meeting). people ["all"] unless names are given.
- "goal": a shared number to accumulate together (save 150 000 for a vacation, run 500 km as a team, read 50 books). target = the number (150 тысяч → 150000), unit = the word as said («рублей», «км», «книг»), currency = ISO code only if money and the currency was said (RUB, USD, EUR…), otherwise omit.
Schedule: repeat = once | daily | weekdays (Mon–Fri) | weekends | weekly | days (then weekdays = MO…SU; «по субботам» = days + ["SA"]). For "once" ALWAYS give day as YYYY-MM-DD counted from Today («завтра» = Today + 1, «в пятницу» = the next Friday); today → Today's date. time = HH:MM in 24h if a time was said («в шесть вечера» → 18:00, «в восемь» about dinner → 20:00), else null. duration = minutes if said («на 3 часа» = 180, «полтора часа» = 90), else null. Fill every field; use null or [] when it does not apply.`;
/** Название группового дела — общее с разбором из мини-аппа. */
export const GROUP_TITLE = `title: short, in the speaker's language, without names, time or schedule («Мыть посуду», not «Алёна моет посуду каждый вечер»).`;

const SYSTEM = `You turn a message from a group chat (family, sports team, friends, colleagues) into shared to-dos for a group task tracker. Reply with JSON only.
The message starts with "Members:" (the group members' names), "Speaker:" (who is talking) and "Today is …". Words like «добавь в группу X» are not a to-do.
${GROUP_RULES}
Every thing mentioned becomes its own item — never drop one.
${GROUP_TITLE} Skip greetings and chatter. If there is nothing to add, return {"items": []}.`;

const SHOTS: [string, object][] = [
  [
    'Members: Даша, Алёна, Петя\nSpeaker: Даша\nToday is 2026-10-02, Friday.\nАлёна моет посуду каждый вечер, в субботу семейный ужин в семь, а мусор выносим по очереди я и Петя по вторникам',
    {
      items: [
        { title: 'Мыть посуду', mode: 'assign', people: ['Алёна'], rotate: false, repeat: 'daily' },
        { title: 'Семейный ужин', mode: 'event', people: ['all'], repeat: 'once', day: '2026-10-03', time: '19:00' },
        { title: 'Вынести мусор', mode: 'assign', people: ['Даша', 'Петя'], rotate: true, repeat: 'days', weekdays: ['TU'] },
      ],
    },
  ],
  [
    'Members: Даша, Алёна\nSpeaker: Даша\nToday is 2026-10-02, Friday.\nАлёна, завтра в шесть вечера забери Лёву из садика, а по субботам ужинаем все вместе в восемь',
    {
      items: [
        { title: 'Забрать Лёву из садика', mode: 'assign', people: ['Алёна'], rotate: false, repeat: 'once', weekdays: [], day: '2026-10-03', time: '18:00', target: null, unit: null, currency: null },
        { title: 'Ужин вместе', mode: 'event', people: ['all'], rotate: false, repeat: 'days', weekdays: ['SA'], day: null, time: '20:00', target: null, unit: null, currency: null },
      ],
    },
  ],
  [
    'Members: Маша, Костя, Света\nSpeaker: Костя\nToday is 2026-10-02, Friday.\nзавтра купить корм тесле, каждый отжимается по 50 раз в будни, мне записаться к ветеринару, и копим 150 тысяч рублей на отпуск',
    {
      items: [
        { title: 'Купить корм Тесле', mode: 'one', repeat: 'once', day: '2026-10-03' },
        { title: 'Отжаться 50 раз', mode: 'assign', people: ['all'], rotate: false, repeat: 'weekdays' },
        { title: 'Записаться к ветеринару', mode: 'assign', people: ['Костя'], rotate: false, repeat: 'once' },
        { title: 'Отпуск', mode: 'goal', repeat: 'once', target: 150000, unit: 'рублей', currency: 'RUB' },
      ],
    },
  ],
];

export const GROUP_SPEC: ModelSpec = { system: SYSTEM, shots: SHOTS, schema: SCHEMA };

export type GroupDraft = GroupItemDraft;

/** Латиница → кириллица для сравнения имён: «Dasha» в Telegram и «Даше» в голосе — один человек. */
const LAT: [string, string][] = [['shch', 'щ'], ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'е'], ['ye', 'е'], ['ia', 'я'], ['iu', 'ю'],
  ['a', 'а'], ['b', 'б'], ['v', 'в'], ['w', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['y', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'к'], ['x', 'кс'], ['q', 'к']];
function toCyr(s: string): string {
  let out = s;
  for (const [l, c] of LAT) out = out.split(l).join(c);
  return out;
}
const norm = (s: string) => toCyr(s.toLowerCase().replace(/ё/g, 'е')).replace(/[ьъ]/g, '').replace(/[^a-zа-я0-9]/g, '');

/**
 * Имя из ответа модели → участник. Сначала точное совпадение, потом по основе:
 * «Алёне», «Алёной» → «Алёна» (без последних букв). Двое подходят одинаково — никого (лучше не угадывать).
 */
export function matchMember(name: string, members: { id: number; name: string }[]): number | null {
  const n = norm(name);
  if (!n) return null;
  const exact = members.filter((m) => norm(m.name) === n);
  if (exact.length === 1) return exact[0]!.id;
  const stem = (s: string) => (s.length > 4 ? s.slice(0, -2) : s.length > 3 ? s.slice(0, -1) : s);
  const hits = members.filter((m) => {
    const mn = norm(m.name);
    return mn.startsWith(stem(n)) || n.startsWith(stem(mn));
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

const CURRENCY_SIGN: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', GEL: '₾', UAH: '₴', TRY: '₺', VND: '₫' };
/** Валюту ставим, только если она прозвучала во фразе: модель любит дописывать рубли сама (docs/groups-goals.md). */
const CURRENCY_SAID: Record<string, RegExp> = {
  RUB: /₽|руб|rub/i,
  USD: /\$|доллар|бакс|usd|dollar/i,
  EUR: /€|евро|eur/i,
  KZT: /₸|тенге|kzt/i,
  GEL: /₾|лари|gel/i,
  UAH: /₴|гривн|uah/i,
  TRY: /₺|лир|try/i,
  VND: /₫|донг|vnd/i,
};
/** «тысяч», «млн», «к» — множитель числа, а не единица цели. */
const MULTIPLIER = /^(тыс|тысяч|тысячи|тысяча|млн|миллион|миллиона|миллионов|к|k|thousand|million)\.?$/i;

function rruleOf(repeat: string, weekdays: unknown): string | null {
  if (repeat === 'daily') return 'FREQ=DAILY';
  if (repeat === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (repeat === 'weekends') return 'FREQ=WEEKLY;BYDAY=SA,SU';
  if (repeat === 'days' || repeat === 'weekly') {
    const days = Array.isArray(weekdays) ? (weekdays as string[]).filter((d) => (WD as readonly string[]).includes(d)) : [];
    return days.length ? `FREQ=WEEKLY;BYDAY=${days.join(',')}` : repeat === 'weekly' ? 'FREQ=WEEKLY' : null;
  }
  return null;
}

/** Ответ модели → черновики дел для этой группы. Имена, которых нет в группе, отбрасываем. */
export function toGroupDrafts(raw: unknown, today: string, members: { id: number; name: string }[], speakerId: number, said = ''): GroupDraft[] {
  const list = (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) return [];
  const out: GroupDraft[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const title = typeof r.title === 'string' ? cleanText(r.title, 120) : '';
    const mode = ['one', 'assign', 'event', 'goal'].includes(r.mode as string) ? (r.mode as GroupMode) : 'one';
    if (!title) continue;
    const people = Array.isArray(r.people) ? (r.people as unknown[]).filter((p): p is string => typeof p === 'string') : [];
    const all = people.some((p) => ['all', 'все', 'каждый', 'everyone'].includes(p.toLowerCase()));
    const ids = all ? [] : [...new Set(people.map((p) => (/^(я|мне|сама?|me)$/i.test(p) ? speakerId : matchMember(p, members))).filter((x): x is number => x !== null))];
    // Назначили кому-то, кого не узнали, — делаем «кто-то один», а не дело в пустоту.
    const finalMode: GroupMode = mode === 'assign' && !all && ids.length === 0 ? 'one' : mode;
    const day = typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.day >= today ? r.day : today;
    const tm = typeof r.time === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(r.time.trim()) : null;
    const time = tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 ? `${tm[1]!.padStart(2, '0')}:${tm[2]}` : null;
    const target = finalMode === 'goal' && typeof r.target === 'number' && r.target > 0 && r.target < 1e12 ? r.target : null;
    if (finalMode === 'goal' && !target) continue;
    const code = typeof r.currency === 'string' ? r.currency.toUpperCase() : '';
    const currency = CURRENCY_SIGN[code] && CURRENCY_SAID[code]?.test(said) ? CURRENCY_SIGN[code]! : null;
    let unitWord = typeof r.unit === 'string' ? r.unit.trim().slice(0, 30) : '';
    // Единица-валюта без названной валюты («рублей», которых не было) и множители — не единица.
    if (MULTIPLIER.test(unitWord) || (!currency && Object.values(CURRENCY_SAID).some((re) => re.test(unitWord)) && !Object.values(CURRENCY_SAID).some((re) => re.test(said)))) unitWord = '';
    out.push({
      title,
      mode: finalMode,
      day,
      time: finalMode === 'goal' ? null : time,
      // «по субботам» модель иногда отдаёт как «один раз» без даты + дни недели — это повтор.
      rrule: finalMode === 'goal' ? null : rruleOf(r.repeat === 'once' && !r.day && Array.isArray(r.weekdays) && r.weekdays.length ? 'days' : String(r.repeat), r.weekdays),
      assignees: finalMode === 'assign' || finalMode === 'event' ? ids : [],
      all_members: (finalMode === 'assign' || finalMode === 'event') && (all || (finalMode === 'event' && ids.length === 0)),
      rotate: finalMode === 'assign' && r.rotate === true && (all || ids.length > 1),
      target,
      duration_min: finalMode !== 'goal' && typeof r.duration === 'number' && r.duration > 0 && r.duration <= 20160 ? Math.round(r.duration) : null,
      // Единица: валюта — только если её сказали; слово — как сказали (формы уточним словарём позже, docs/groups-goals.md).
      unit: finalMode !== 'goal' ? null : currency ? { type: 'money', forms: [currency, currency, currency], currency } : unitWord ? { type: 'custom', forms: [unitWord, unitWord, unitWord] } : null,
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** Разобрать фразу из группового чата: участники и говорящий — в подсказке. */
export async function parseGroupItems(env: Env, text: string, today: string, members: { id: number; name: string }[], speakerId: number): Promise<GroupDraft[]> {
  const speaker = members.find((m) => m.id === speakerId)?.name ?? '';
  const input = `Members: ${members.map((m) => m.name).join(', ')}\nSpeaker: ${speaker}\n${todayLine(today)}\n${text.slice(0, 2000)}`;
  return toGroupDrafts((await askModel(env, input, GROUP_SPEC)).raw, today, members, speakerId, text);
}
