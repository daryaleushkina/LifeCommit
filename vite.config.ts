import { execSync } from 'node:child_process';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { appPath } from './src/site/route';

/**
 * Корень сайта — лендинг, мини-апп — /app/. BotFather, кнопки бота в старых сообщениях и ссылки t.me/…?startapp
 * открывают корень; запуск из Telegram видно только по «#», поэтому решает страница: чистая функция appPath
 * (src/site/route.ts, под unit-тестом) вставляется текстом в <head> лендинга (обоих языков) и до загрузки страницы
 * уводит запуск из Telegram в /app/. Любая ошибка — остаёмся на лендинге.
 */
function siteRoute(): Plugin {
  let dev = false;
  return {
    name: 'lifecommit-site-route',
    configResolved(c) {
      dev = c.command === 'serve';
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // в сборке ctx.path — '/ru/index.html', в разработке с плагином Cloudflare — полный путь к файлу
        if (!/(^|\/)(ru|en)\/index\.html$/.test(ctx.path)) return html;
        const script =
          `<script>try{var p=(${appPath.toString()})({pathname:location.pathname,search:location.search,hash:location.hash,` +
          `stored:(function(){try{return !!sessionStorage.getItem('tapps/launchParams')}catch(e){return false}})(),dev:${dev}});` +
          `if(p)location.replace(p)}catch(e){}</script>`;
        return html.replace(/<meta charset[^>]*>/i, (m) => `${m}\n${script}`);
      },
    },
  };
}

/** Версия сборки для жалоб (src/feedback.ts): короткий git sha; без git — dev. */
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Удалённые привязки (Workers AI) в разработке требуют входа в Cloudflare. В GitHub Actions (CI) и облачных сессиях
  // (NO_REMOTE_BINDINGS=1) его нет, а сквозным тестам Workers AI не нужен — голос в них подменён (page.route).
  plugins: [siteRoute(), react(), cloudflare({ remoteBindings: !process.env.CI && !process.env.NO_REMOTE_BINDINGS })],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(gitSha()) },
  server: { host: true },
  environments: {
    client: {
      build: {
        rollupOptions: {
          // Мини-апп — /app/; лендинг и документы лежат как /ru/… и /en/…, а отдаются без языка в адресе
          // (worker/site.ts выбирает файл по языку человека). Код и стили сайта — site/.
          input: {
            app: 'app/index.html',
            ru: 'ru/index.html',
            en: 'en/index.html',
            ruPrivacy: 'ru/privacy/index.html',
            ruTerms: 'ru/terms/index.html',
            enPrivacy: 'en/privacy/index.html',
            enTerms: 'en/terms/index.html',
          },
        },
      },
    },
  },
});
