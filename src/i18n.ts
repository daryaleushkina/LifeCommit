import { createContext, useContext } from 'react';

const ru = {
  openInTelegram: 'Откройте LifeCommit в Telegram',
  loadError: 'Не получилось загрузиться. Проверьте интернет и попробуйте ещё раз.',
  retry: 'Ещё раз',
  error: 'Что-то пошло не так. Попробуй ещё раз.',
  // навигация
  today: 'Сегодня',
  me: 'Я',
  // онбординг
  onboardingTitle: 'Чего я хочу?',
  intents: {
    check: { title: 'Делать что-то каждый день', examples: 'зарядка, таблетки, уборка' },
    count: { title: 'Набирать количество', examples: 'страницы, шаги, слова' },
    limit: { title: 'Делать чего-то меньше', examples: 'соцсети, кофе, сладкое' },
    abstain: { title: 'Бросить привычку', examples: 'курение, алкоголь' },
  },
  // сегодня
  addTask: 'Добавить дело',
  nothingDue: 'На сегодня всё',
  archivedLink: (n: number) => `Отложенные · ${n}`,
  clean: 'Сегодня без',
  slip: 'Сегодня было',
  of: 'из',
  enterValue: 'ввести число',
  limitReached: (n: number) => `Бесплатно — до ${n} дел. Можно отложить какое-то дело.`,
  // редактор
  newTask: 'Новое дело',
  editTask: 'Дело',
  titlePh: { count: 'Например, читать', check: 'Например, зарядка', limit: 'Например, соцсети', abstain: 'Например, не курить' },
  lastSlip: 'Последний раз',
  kindLabel: 'Тип цели',
  kinds: { count: 'Количество', check: 'Да или нет', limit: 'Лимит', abstain: 'Отказ' },
  kindHints: {
    count: 'Сделать сколько-то раз. Например, 20 отжиманий.',
    check: 'Просто отметить: сделано или нет. Например, убраться.',
    limit: 'Не больше нормы. Например, 60 минут в соцсетях.',
    abstain: 'Совсем без этого. Например, не курить.',
  },
  goal: 'Цель',
  limitGoal: 'Не больше',
  unitPh: 'раз',
  when: 'Когда',
  schedules: { daily: 'Каждый день', weekdays: 'По дням', per_week: 'Раз в неделю' },
  perWeek: (n: number) => `${n} раз в неделю`,
  weekdaysShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  who: 'Кто видит',
  visibility: { private: 'Только я', followers: 'Подписчики', public: 'Все' },
  add: 'Добавить',
  save: 'Сохранить',
  postpone: 'Отложить',
  goalTomorrow: 'Цель стала легче — применится с завтра.',
  cleanDays: (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')} без`,
  // архив
  archive: 'Отложенные',
  restore: 'Вернуть',
  deleteForever: 'Удалить',
  deleteForeverConfirm: 'Удалить дело вместе с историей?',
  // профиль
  activeDays: (n: number) => `${n} ${plural(n, 'активный день', 'активных дня', 'активных дней')}`,
  year: 'Год',
  months: 'Месяцы',
  monthNames: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  reminders: 'Напоминание',
  off: 'Выкл',
  dayEnds: 'День заканчивается',
  privacy: 'Приватность профиля',
  closed: 'Закрытый',
  open: 'Открытый',
  language: 'Язык',
  langName: 'Русский',
  support: 'Поддержать проект',
  allowBot: 'Разрешить боту напоминать',
  deleteAccount: 'Удалить аккаунт',
  deleteConfirm: 'Удалить аккаунт и все данные без возможности восстановления?',
};

type Dict = typeof ru;

const en: Dict = {
  openInTelegram: 'Open LifeCommit in Telegram',
  loadError: "Couldn't load. Check your connection and try again.",
  retry: 'Try again',
  error: 'Something went wrong. Try again.',
  today: 'Today',
  me: 'Me',
  onboardingTitle: 'What do I want?',
  intents: {
    check: { title: 'Do something every day', examples: 'workout, meds, tidying up' },
    count: { title: 'Reach an amount', examples: 'pages, steps, words' },
    limit: { title: 'Do less of something', examples: 'social media, coffee, sweets' },
    abstain: { title: 'Quit a habit', examples: 'smoking, alcohol' },
  },
  addTask: 'Add a habit',
  nothingDue: 'All done for today',
  archivedLink: (n) => `Postponed · ${n}`,
  clean: 'Not today',
  slip: 'It happened',
  of: 'of',
  enterValue: 'enter a number',
  limitReached: (n) => `Free plan: up to ${n} habits. You can postpone one.`,
  newTask: 'New habit',
  editTask: 'Habit',
  titlePh: { count: 'e.g. reading', check: 'e.g. workout', limit: 'e.g. social media', abstain: 'e.g. no smoking' },
  lastSlip: 'Last time',
  kindLabel: 'Goal type',
  kinds: { count: 'Amount', check: 'Yes or no', limit: 'Limit', abstain: 'Quit' },
  kindHints: {
    count: 'Do it a number of times. E.g. 20 push-ups.',
    check: 'Just mark it done or not. E.g. tidy up.',
    limit: 'Stay under a limit. E.g. 60 minutes of social media.',
    abstain: 'Go without it entirely. E.g. no smoking.',
  },
  goal: 'Goal',
  limitGoal: 'At most',
  unitPh: 'reps',
  when: 'When',
  schedules: { daily: 'Every day', weekdays: 'On days', per_week: 'Per week' },
  perWeek: (n) => `${n} times a week`,
  weekdaysShort: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  who: 'Who sees it',
  visibility: { private: 'Only me', followers: 'Followers', public: 'Everyone' },
  add: 'Add',
  save: 'Save',
  postpone: 'Postpone',
  goalTomorrow: 'The goal got easier — it applies from tomorrow.',
  cleanDays: (n) => `${n} ${n === 1 ? 'day' : 'days'} without`,
  archive: 'Postponed',
  restore: 'Restore',
  deleteForever: 'Delete',
  deleteForeverConfirm: 'Delete this habit with its history?',
  activeDays: (n) => `${n} active ${n === 1 ? 'day' : 'days'}`,
  year: 'Year',
  months: 'Months',
  monthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  reminders: 'Reminder',
  off: 'Off',
  dayEnds: 'Day ends at',
  privacy: 'Profile privacy',
  closed: 'Closed',
  open: 'Open',
  language: 'Language',
  langName: 'English',
  support: 'Support the project',
  allowBot: 'Let the bot remind me',
  deleteAccount: 'Delete account',
  deleteConfirm: 'Delete your account and all data permanently?',
};

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const dictionaries = { ru, en };
export type Lang = keyof typeof dictionaries;

export const LangContext = createContext<Lang>('ru');
export const useT = (): Dict => dictionaries[useContext(LangContext)];
