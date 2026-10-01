// Нагрузка ТОЛЬКО на локальный стенд: `pnpm db:start`, `pnpm dev`, затем `pnpm load` (VUS=100 по умолчанию).
// На прод не направлять: 01.10.2026 нагрузочный тест по боевому Worker'у повесил приложение у владелицы.
// Пользователи — с фальшивой подписью initData (DEV_AUTH_BYPASS=1 в .dev.vars), id 800000001 и дальше.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:5173';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('only local');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      stages: [
        { duration: '20s', target: Number(__ENV.VUS || 100) },
        { duration: '40s', target: Number(__ENV.VUS || 100) },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: { http_req_failed: ['rate<0.01'] },
};

function auth(id) {
  const q = [
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['hash', 'mock-hash-not-valid-for-backend'],
    ['signature', 'mock-signature'],
    ['user', JSON.stringify({ id, first_name: 'Load', language_code: 'ru' })],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return { headers: { Authorization: `tma ${q}`, 'content-type': 'application/json' } };
}

const day = new Date().toISOString().slice(0, 10);

export default function () {
  const h = auth(800000000 + __VU);
  check(http.post(`${BASE}/api/session`, JSON.stringify({ timezone: 'Asia/Ho_Chi_Minh' }), h), { session: (r) => r.status === 200 });
  check(http.get(`${BASE}/api/today`, h), { today: (r) => r.status === 200 });
  const add = http.post(`${BASE}/api/todos/batch`, JSON.stringify({ todos: [{ title: `load ${__ITER}`, day }] }), h);
  check(add, { add: (r) => r.status === 201 });
  const id = add.status === 201 ? add.json('ids.0') : null;
  if (id) check(http.patch(`${BASE}/api/todos/${id}`, JSON.stringify({ done: true }), h), { done: (r) => r.status === 200 });
  check(http.get(`${BASE}/api/heatmap`, h), { heatmap: (r) => r.status === 200 });
  check(http.get(`${BASE}/api/calendar?from=${day}&to=${day}`, h), { calendar: (r) => r.status === 200 });
}
