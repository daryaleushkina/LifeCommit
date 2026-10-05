// Значки привычек для приложения iOS/Mac — из тех же рисунков, что в мини-аппе (src/components/KindIcon.tsx), а не
// перерисованные на глаз. Плитка рендерится React'ом в SVG, разбирается и записывается в
// apple/App/Components/KindIcons.generated.swift. Поменяли рисунок в мини-аппе — `node apple/scripts/icons.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const dir = mkdtempSync(join(tmpdir(), 'lc-icons-'));

// По одному названию на значок: первое слово из словаря shared/habitIcon.ts (проверяется ниже — тот ли значок вышел).
const entry = `
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { KindTile } from ${JSON.stringify(join(root, 'src/components/KindIcon.tsx'))};
import { habitIcon } from ${JSON.stringify(join(root, 'shared/habitIcon.ts'))};
const titles = { gym: 'спортзал', run: 'бег', walk: 'прогулка', yoga: 'йога', exercise: 'зарядка', swim: 'плавание', bike: 'велосипед',
  water: 'вода', read: 'читать', study: 'курсы', write: 'дневник', sleep: 'сон', meds: 'таблетки', food: 'завтрак', sweets: 'сладкое',
  smoke: 'курить', alcohol: 'алкоголь', coffee: 'кофе', phone: 'телефон', clean: 'уборка', money: 'деньги', work: 'работа',
  music: 'музыка', art: 'рисовать', care: 'зубы', pet: 'собака', people: 'позвонить' };
const out = { kind: {}, habit: {} };
for (const kind of ['check', 'count', 'abstain']) out.kind[kind] = renderToStaticMarkup(createElement(KindTile, { kind }));
for (const [icon, title] of Object.entries(titles)) {
  if (habitIcon(title) !== icon) throw new Error('название «' + title + '» даёт не ' + icon + ', а ' + habitIcon(title));
  out.habit[icon] = renderToStaticMarkup(createElement(KindTile, { kind: 'check', title }));
}
console.log(JSON.stringify(out));
`;
writeFileSync(join(dir, 'entry.tsx'), entry);
// esbuild — тот, что пришёл с vite (в корне node_modules его нет).
const fromRoot = createRequire(join(root, 'package.json'));
const esbuild = createRequire(fromRoot.resolve('vite'))('esbuild');
await esbuild.build({
  entryPoints: [join(dir, 'entry.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile: join(dir, 'out.cjs'),
  nodePaths: [join(root, 'node_modules')],
  logLevel: 'warning',
});
const rendered = JSON.parse(execFileSync(process.execPath, [join(dir, 'out.cjs')], { cwd: root, encoding: 'utf8' }));

/** Атрибуты тега: name="value". */
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`не число: ${v}`);
  return n;
};
const ink = (v) => (v === undefined || v === 'none' ? 'nil' : v === 'var(--k-ink)' ? '.ink' : v === 'var(--k-mid)' ? '.mid' : (() => { throw new Error(`цвет ${v}`); })());

function parts(svg) {
  const inner = svg.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>.*$/s, '');
  const shapes = [...inner.matchAll(/<(rect|circle|path)\b([^>]*?)\/?>/g)];
  return shapes.map(([, tag, raw]) => {
    const a = attrs(raw);
    let shape;
    if (tag === 'rect') shape = `.rect(x: ${num(a.x)}, y: ${num(a.y)}, width: ${num(a.width)}, height: ${num(a.height)}, radius: ${num(a.rx ?? 0)})`;
    else if (tag === 'circle') shape = `.circle(cx: ${num(a.cx)}, cy: ${num(a.cy)}, r: ${num(a.r)})`;
    else shape = `.path(${JSON.stringify(a.d)})`;
    let rotate = 'nil';
    if (a.transform) {
      const m = /^rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)$/.exec(a.transform);
      if (!m) throw new Error(`transform ${a.transform}`);
      rotate = `IconRotation(degrees: ${num(m[1])}, cx: ${num(m[2])}, cy: ${num(m[3])})`;
    }
    const width = a['stroke-width'] ? num(a['stroke-width']) : a.stroke ? 1 : 0;
    return `IconPart(${shape}, fill: ${ink(a.fill)}, stroke: ${ink(a.stroke)}, lineWidth: ${width}, rotate: ${rotate})`;
  });
}

const block = (map) =>
  Object.entries(map)
    .map(([name, svg]) => `        .${name}: [\n${parts(svg).map((p) => `            ${p},`).join('\n')}\n        ],`)
    .join('\n');

const swift = `// Создано apple/scripts/icons.mjs из src/components/KindIcon.tsx — не править руками.
// Рисунки 48×48: заливка — средний цвет плитки (.mid), линии — тёмный (.ink), как в мини-аппе.
import LifeCommitKit

extension KindIcons {
    static let kind: [TaskKind: [IconPart]] = [
${block(rendered.kind)}
    ]

    static let habit: [HabitIcon: [IconPart]] = [
${block(rendered.habit)}
    ]
}
`;
const target = join(root, 'apple/App/Components/KindIcons.generated.swift');
const before = (() => {
  try {
    return readFileSync(target, 'utf8');
  } catch {
    return '';
  }
})();
// --check — только сверить (проверка перед пушем): значки в приложении разошлись с мини-аппом — ошибка.
if (process.argv.includes('--check')) {
  if (before !== swift) {
    console.error(`значки iOS/Mac разошлись с src/components/KindIcon.tsx — пересоберите: node apple/scripts/icons.mjs`);
    process.exit(1);
  }
  console.log('значки совпадают с мини-аппом');
} else {
  writeFileSync(target, swift);
  console.log(before === swift ? 'значки не изменились' : `записано: ${target}`);
}
