// Голос в мини-аппе: куда что сказано — себе или в группу (и кому в ней). 02.10.2026 владелица сказала
// «добавь в группу Тестим бота: Алёне…», а всё легло в её личные дела — микрофон знал только личный разбор.
//
// Как решаем, не тратя лишних запросов к модели:
//  1. Ищем группы в самой фразе: по названию («в группу тестим бота», «в семью») — без модели.
//     Ещё — по имени участника с большой буквы («Алёне погулять с Плюшей»), если такое имя только в одной группе.
//     И группа, с экрана которой нажали микрофон.
//  2. Групп нет — обычный личный разбор, как раньше (один запрос).
//  3. Есть — групповой разбор для каждой (участники и говорящий — в подсказке), а личный — параллельно,
//     только если во фразе есть и личное («себе», «мне лично», или группа названа явно — тогда фраза может быть смешанной).
//     Личный разбор получает строку Groups и не берёт сказанное для группы; совпавшее по названию отбрасываем.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GroupDraft } from './groupVoice';
import { matchMember, parseGroupItems } from './groupVoice';
import { parseHabits, type Parsed } from './voice';

export interface VoiceGroup {
  id: number;
  title: string;
  members: { id: number; name: string }[];
}

export interface RoutedVoice extends Parsed {
  groups: { group: { id: number; title: string }; items: (GroupDraft & { names: string[] })[] }[];
}

/** Сколько групп разбираем за раз: больше в одной фразе почти не бывает, а каждая — запрос к модели. */
const MAX_GROUPS = 3;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/g, ' ');
const words = (s: string) => norm(s).split(/\s+/).filter((w) => w.length >= 2);
/** Основа слова: «семью» ~ «семья», «бота» ~ «бот». */
const stem = (w: string) => (w.length > 5 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w);

/** Название группы прозвучало: все его слова (по основе) есть во фразе. */
export function titleMentioned(text: string, title: string): boolean {
  const said = words(text);
  const need = words(title);
  if (!need.length) return false;
  return need.every((w) => said.some((s) => s.startsWith(stem(w)) || w.startsWith(stem(s))) );
}

/** Признаки личного во фразе, где есть группа. */
const PERSONAL = /(^|[^а-яё])(себе|для себя|лично|в мои дела|мои дела|в личн|myself|for me personally)([^а-яё]|$)/i;

/** Имена с большой буквы (не в начале предложения) — кандидаты в участники. */
export function namedPeople(text: string): string[] {
  return text
    .split(/[.!?…]+/)
    .flatMap((sentence) => sentence.trim().split(/[\s,;:]+/).slice(1))
    .filter((w) => /^[A-ZА-ЯЁ][a-zа-яё]{2,}$/.test(w));
}

/** Группы, о которых фраза. screenGroup — с экрана какой группы нажали микрофон. */
export function groupsOf(text: string, groups: VoiceGroup[], me: number, screenGroup: number | null): { list: VoiceGroup[]; explicit: boolean } {
  const byTitle = groups.filter((g) => titleMentioned(text, g.title));
  if (byTitle.length) return { list: byTitle.slice(0, MAX_GROUPS), explicit: true };
  // «в группу …», а название распознали криво — если группа одна, это она.
  if (/групп/i.test(text) && groups.length === 1) return { list: groups, explicit: true };
  const screen = groups.find((g) => g.id === screenGroup);
  if (screen) return { list: [screen], explicit: false };
  // Имя другого человека, который есть ровно в одной из групп.
  const hits = new Set<VoiceGroup>();
  for (const name of namedPeople(text)) {
    const inGroups = groups.filter((g) => matchMember(name, g.members.filter((m) => m.id !== me)) !== null);
    if (inGroups.length === 1) hits.add(inGroups[0]!);
  }
  return { list: [...hits].slice(0, MAX_GROUPS), explicit: false };
}

/** Группы человека с участниками — для разбора. */
export async function voiceGroups(sb: SupabaseClient, userId: number): Promise<VoiceGroup[]> {
  const mine = (await sb.from('group_members').select('group_id, groups!inner(id, title, archived_at)').eq('user_id', userId).is('groups.archived_at', null)).data as unknown as
    | { group_id: number; groups: { id: number; title: string } }[]
    | null;
  if (!mine?.length) return [];
  const ids = mine.map((m) => m.group_id);
  const rows = ((await sb.from('group_members').select('group_id, user_id, users(first_name)').in('group_id', ids).order('joined_at')).data ?? []) as unknown as { group_id: number; user_id: number; users: { first_name: string } | null }[];
  return mine.map((m) => ({
    id: m.group_id,
    title: m.groups.title,
    members: rows.filter((r) => r.group_id === m.group_id).map((r) => ({ id: r.user_id, name: r.users?.first_name ?? '' })),
  }));
}

const titleKey = (s: string) => words(s).slice(0, 3).map(stem).join(' ');

export async function routeVoice(env: Parameters<typeof parseHabits>[0], text: string, today: string, me: number, groups: VoiceGroup[], screenGroup: number | null): Promise<RoutedVoice> {
  const { list, explicit } = groupsOf(text, groups, me, screenGroup);
  if (!list.length) return { ...(await parseHabits(env, text, today)), groups: [] };

  const withPersonal = explicit || PERSONAL.test(text);
  const others = (g: VoiceGroup) => list.filter((x) => x.id !== g.id).map((x) => x.title);
  const [personal, ...perGroup] = await Promise.all([
    withPersonal ? parseHabits(env, text, today, list.map((g) => ({ title: g.title, members: g.members.filter((m) => m.id !== me).map((m) => m.name) }))) : null,
    ...list.map((g) => parseGroupItems(env, text, today, g.members, me, { group: g.title, otherGroups: others(g), personalToo: withPersonal })),
  ]);

  const routed = list
    .map((g, i) => ({
      group: { id: g.id, title: g.title },
      // Имена тех, кому назначено; '' — это сам говорящий («тебе»).
      items: (perGroup[i] ?? []).map((d) => ({ ...d, names: d.assignees.map((id) => (id === me ? '' : g.members.find((m) => m.id === id)?.name ?? '…')) })),
    }))
    .filter((g) => g.items.length > 0);
  // То, что ушло в группу, личным не дублируем.
  const taken = new Set(routed.flatMap((g) => g.items.map((d) => titleKey(d.title))));
  return {
    habits: personal?.habits.filter((h) => !taken.has(titleKey(h.title))) ?? [],
    todos: personal?.todos.filter((d) => !taken.has(titleKey(d.title))) ?? [],
    by: personal?.by ?? 'gemini',
    groups: routed,
  };
}
