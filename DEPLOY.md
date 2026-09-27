# Деплой API (Vercel или Railway)

Фронт на GitHub Pages может вызывать бэкенд на Vercel/Railway. Ключ API хранится только на сервере (переменные окружения).

## Railway (Express: сайт + API)

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → репозиторий Picasso.
2. **Variables** (по желанию): `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`. Без них работает встроенная модель.
3. **Settings** → **Networking** → **Generate Domain** (например `picasso-production.up.railway.app`).
4. В `docs/config.json` укажите `"apiBase": "https://ВАШ-домен.railway.app"` (без слэша в конце), закоммитьте и запушьте — GitHub Pages подхватит конфиг.

Проверка: `curl https://ВАШ-домен.railway.app/api/health`

## Vercel (сайт и API на одном домене)

1. [vercel.com](https://vercel.com) → **Add New Project** → импорт репозитория Picasso.
2. В **Settings → Build and Deployment** выключите Override у **Build Command** и **Output Directory**. Сборка задана в `vercel.json`: страница из `docs/`, API из `api/`.
3. **Environment Variables**: при необходимости `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.
4. После деплоя откройте URL проекта (например `https://picasso-fawn.vercel.app`). Проверка: `/api/health` отвечает `{"ok":true,"ready":true}`.

**Вариант A — всё на Vercel:** открывайте сайт по URL Vercel; `config.json` можно оставить пустым — API на том же домене.

**Вариант B — GitHub Pages + API на Vercel:** в `docs/config.json` задайте `"apiBase": "https://picasso.vercel.app"`.

Проверка: `curl https://picasso.vercel.app/api/health`

## Локально

```bash
npm start
```

Откройте http://127.0.0.1:3000 — API на том же хосте, `config.json` не нужен.
