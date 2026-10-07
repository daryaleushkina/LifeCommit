// Сверка id интерфейса iOS с общим файлом shared/ui-ids.json: каждый accessibilityIdentifier (и id у кнопок,
// сегментов, свайпа) в apple/App должен быть в файле — по нему ищут кнопки сценарии Maestro (Android) и XCUITest (iOS).
// Интерполяция \(…) в id — любой хвост: «onboarding.intent.\(kind.rawValue)» сверяется с ключами «onboarding.intent.*».
// Запуск: node apple/scripts/ui-ids.mjs --check (из apple/scripts/test.sh и хука перед пушем).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const known = Object.keys(JSON.parse(readFileSync(join(root, 'shared', 'ui-ids.json'), 'utf8')).ids);

function swiftFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? swiftFiles(p) : p.endsWith('.swift') ? [p] : [];
  });
}

// Строки, которые становятся id: accessibilityIdentifier("…"), id: "…", var id = "…", ids: ["…", …], ids: … "…\($0…)".
const patterns = [/accessibilityIdentifier\("((?:[^"\\]|\\.)*)"\)/g, /\bid(?::| =) "((?:[^"\\]|\\.)*)"/g, /\bids: \[([^\]]*)\]/g, /\bids: [^\n]*?"((?:[^"\\]|\\.)*)"/g];
const used = new Map();
for (const file of swiftFiles(join(root, 'apple', 'App'))) {
  const text = readFileSync(file, 'utf8');
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const values = re.source.startsWith('\\bids: \\[') ? [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]) : [m[1]];
      for (const v of values) if (v) used.set(v, file.slice(root.length + 1));
    }
  }
}

// Вкладки: tab.\(value == .groups ? "together" : "\(value)") — сверяем все варианты.
const expand = (id) => (id.startsWith('tab.\\(') ? ['tab.today', 'tab.calendar', 'tab.together', 'tab.me'] : [id]);
const matches = (id) => {
  if (!id.includes('\\(')) return known.includes(id);
  const prefix = id.slice(0, id.indexOf('\\('));
  return known.some((k) => k.startsWith(prefix) && k.length > prefix.length);
};

const unknown = [];
for (const [id, file] of used) {
  // Строки вида «together» внутри тернарника и пустые — не id.
  if (!id.includes('.') && !id.startsWith('tab.') && id !== 'undo') continue;
  for (const one of expand(id)) if (!matches(one)) unknown.push(`${one}  (${file})`);
}
if (!used.size) {
  console.error('ui-ids: в apple/App не найдено ни одного id — сверка сломана');
  process.exit(1);
}
if (unknown.length) {
  console.error(`ui-ids: этих id нет в shared/ui-ids.json — добавьте их туда (с описанием) или поправьте имя:\n  ${unknown.join('\n  ')}`);
  process.exit(1);
}
console.log(`ui-ids: ${used.size} id iOS — все в shared/ui-ids.json`);
