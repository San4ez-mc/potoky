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

## Instagram (Reels, фото, каруселі)
Публікатор: воронка **publish-instagram** (код publish-instagram-node-code.js, мок-тести test-publishers.js). Використовує Instagram API з входом через Instagram (без Facebook-сторінки).
1. Акаунт Instagram має бути **професійним** (Business або Creator): Instagram → Налаштування → Тип акаунта.
2. https://developers.facebook.com → додаток → **Add product → Instagram → API setup with Instagram login**. Права: instagram_business_basic, instagram_business_content_publish.
3. У тому ж розділі: **Redirect URL** = https://flows.fineko.space/webhook/bot/oauth-video ; акаунт Instagram додати в **Instagram testers** (App roles → Roles) і прийняти запрошення в застосунку Instagram.
4. Скопіювати **Instagram app ID** і **Instagram app secret** у ключі воронки oauth-video (IG_APP_ID, IG_APP_SECRET).
5. POST /webhook/bot/oauth-video {"platform":"instagram"} → у Telegram посилання → згода в Instagram → з адресного рядка скопіювати code= (без #_) → POST {"platform":"instagram","code":"..."} → «Instagram підключено».
6. Токен довгий (60 днів) і оновлюється сам. Публікація без медіа неможлива (текст без картинки Instagram не приймає). PNG автоматично конвертується в JPEG через content2 (/api/webhooks/public-jpeg).
7. Режим розробки Meta: публікувати можуть лише акаунти-тестери додатку; для чужих акаунтів потрібен App Review (для власного акаунта KIRO не потрібен).
8. Увімкнути в мережі KIRO Instagram: post_directly = true, autopost_slug = publish-instagram.

## Що ще не зроблено
Кросс-постинг одного ролика одразу в TikTok / Reels / Shorts (зараз кожна мережа має свої пости).
