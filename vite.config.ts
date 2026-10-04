import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { landingPath } from './src/site/route';

/**
 * Корень сайта — мини-апп, но человека из браузера (не из Telegram) отправляем на лендинг. Решает чистая функция
 * landingPath (src/site/route.ts, под unit-тестом); её текст вставляется в <head> корневого index.html и
 * выполняется до загрузки приложения. Любая ошибка — остаёмся в мини-аппе.
 */
function siteRoute(): Plugin {
  let dev = false;
  let rootHtml = '';
  return {
    name: 'lifecommit-site-route',
    configResolved(c) {
      dev = c.command === 'serve';
      rootHtml = resolve(c.root, 'index.html');
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // в сборке ctx.path — '/index.html', в разработке с плагином Cloudflare — полный путь к файлу
        if (ctx.path !== '/index.html' && ctx.path !== rootHtml) return html;
        const script =
          `<script>try{var p=(${landingPath.toString()})({pathname:location.pathname,search:location.search,hash:location.hash,` +
          `language:navigator.language||'',inFrame:window.parent!==window,hasProxy:!!window.TelegramWebviewProxy,` +
          `stored:(function(){try{return !!sessionStorage.getItem('tapps/launchParams')}catch(e){return false}})(),dev:${dev}});` +
          `if(p)location.replace(p)}catch(e){}</script>`;
        return html.replace(/<meta charset[^>]*>/i, (m) => `${m}\n    ${script}`);
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
  plugins: [siteRoute(), react(), cloudflare()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(gitSha()) },
  server: { host: true },
  environments: {
    client: {
      build: {
        rollupOptions: {
          // Мини-апп — корень; лендинг и документы — отдельные страницы (код и стили — site/).
          input: {
            app: 'index.html',
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
