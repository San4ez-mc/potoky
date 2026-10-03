# Автопостинг відео в TikTok і YouTube Shorts: що підключити

Код публікації готовий і перевірений на імітованих відповідях API (`scripts/autopost/test-publishers.js`, 17 тестів).
Не вистачає лише облікових даних акаунтів. Кроки одноразові.

## Загальна схема
content2 (планувальник) → воронка `content-scheduler` → воронка `publish-tiktok` / `publish-youtube-shorts` → результат назад у content2
(`/api/webhooks/scheduler-done`: «опубліковано» або «помилка» + сповіщення). Токени підключає воронка **`oauth-video`**
(проєкт «Контент платформа»): вона сама записує їх у ключі воронок-публікаторів.

## TikTok
1. https://developers.tiktok.com → створити додаток (Web). Додати продукти **Login Kit** і **Content Posting API**.
2. Scopes: `user.info.basic`, `video.upload`, `video.publish`.
3. Redirect URI: `https://flows.fineko.space/webhook/bot/oauth-video` (сторінка не відкриється — це нормально, потрібен лише `code` з адресного рядка).
4. Скопіювати **Client key** і **Client secret** у ключі воронки `oauth-video` (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`).
5. Надіслати `POST https://flows.fineko.space/webhook/bot/oauth-video` з тілом `{"platform":"tiktok"}` → у Telegram прийде посилання.
   Відкрити, увійти в акаунт KIRO, дати згоду → з адресного рядка скопіювати значення після `code=`.
6. Надіслати `{"platform":"tiktok","code":"<код>"}` → у Telegram прийде «TikTok підключено».
7. **Аудит:** поки додаток не пройшов аудит TikTok, API публікує лише приватно (SELF_ONLY). Для публічних постів у кабінеті TikTok
   треба подати додаток на аудит Content Posting API (опис, відео-демо, політика конфіденційності). Код сам обирає найвищу дозволену приватність.
8. refresh-токен живе ~365 днів і оновлюється автоматично при кожній публікації.

## YouTube Shorts
1. https://console.cloud.google.com → проєкт → **APIs & Services → Enable APIs** → увімкнути **YouTube Data API v3**.
2. **OAuth consent screen**: External, додати свою пошту в Test users (або опублікувати застосунок).
3. **Credentials → Create credentials → OAuth client ID** (тип Web application), Redirect URI: `https://flows.fineko.space/webhook/bot/oauth-video`.
4. Скопіювати **Client ID** і **Client secret** у ключі `oauth-video` (`YT_CLIENT_ID`, `YT_CLIENT_SECRET`).
5. `{"platform":"youtube"}` → посилання → обрати акаунт, **на каналі якого** будуть Shorts → дати згоду → скопіювати `code=`.
6. `{"platform":"youtube","code":"<код>"}` → «YouTube підключено».
7. **Аудит:** поки проєкт Google Cloud не пройшов аудит YouTube API, завантажені відео примусово стають private. Квота за замовчуванням ≈ 6 завантажень на добу.

## Увімкнення автопостингу в KIRO
Після підключення: у мережі KIRO TikTok → `post_directly = true`, `autopost_slug = publish-tiktok`; YouTube → `publish-youtube-shorts`.
Один раз спробувати на одному ролику; результат прийде в Telegram і в календар.

## Що ще не зроблено
Instagram Reels (потрібен публікатор через Meta Graph API: `media_type=REELS`).
