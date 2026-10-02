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
2. В **Settings → Build and Deployment** выключите Override у **Build Command** и **Output Directory**. Сборка сама кладёт страницу и API в результат деплоя.
3. **Environment Variables**: добавьте `GEMINI_API_KEY` — бесплатный ключ из [Google AI Studio](https://aistudio.google.com/) (Get API key). Тогда презентации собирает Gemini (`gemini-2.5-flash`; другую модель можно задать в `GEMINI_MODEL`), а LLM7 остаётся запасной моделью на случай, если у Gemini кончится лимит. По желанию `GEMINI_RPD` — ваш дневной лимит запросов из AI Studio, чтобы индикатор показывал остаток.
   Для запасной модели добавьте `LLM7_TOKEN` — бесплатный токен с [dash.llm7.io](https://dash.llm7.io). Без него встроенная модель быстро упирается в общий лимит и отвечает «лимит исчерпан». Вместо этого можно задать свою модель: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.
4. После деплоя откройте URL проекта (например `https://picasso-fawn.vercel.app`). Проверка: `/api/health` отвечает `{"ok":true,"ready":true,...}`; поле `"token":true` значит, что токен подхватился. После изменения переменных нужен **Redeploy**.

**Вариант A — всё на Vercel:** открывайте сайт по URL Vercel; `config.json` можно оставить пустым — API на том же домене.

**Вариант B — GitHub Pages + API на Vercel:** в `docs/config.json` задайте `"apiBase": "https://picasso.vercel.app"`.

Проверка: `curl https://picasso.vercel.app/api/health`

## Локально

```bash
npm start
```

Откройте http://127.0.0.1:3000 — API на том же хосте, `config.json` не нужен.
