'use strict';
// Реклама без привʼязки в CRM (кабінет без доступу), назва якої точно збігається з назвою кількох товарів (D0043 і D0098 —
// «Чоловічий зимовий пуховик»): бот показує обидва й питає номер, а не «уточню в менеджера» (16.10, valentynasalamon).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const API = path.join(__dirname, '..', '..', 'apps', 'api', 'src', 'services');
const { db } = require(path.join(API, 'shopAgent/lib'));
const FT = require(path.join(API, 'funnelTests'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
(async () => {
    const name = '16.10 Р1. Реклама без привʼязки «Допис в Instagram: Чоловічий зимовий пуховик…» → дві моделі з такою назвою — показати й спитати номер';
    const steps = [{ type: 'ad_reply', text: 'Які кольори доступні?', referral: { adId: 'test-unbound-puffer-ad', source: 'ADS', type: 'OPEN_THREAD', adTitle: 'Допис в Instagram: Чоловічий зимовий пуховик...._Group_1' } }, { type: 'text', text: '2' }];
    const exp = 'Реклама не привʼязана в CRM, а в каталозі дві моделі з назвою «Чоловічий зимовий пуховик» (D0043 і D0098). На перше повідомлення бот показує обидві (фото, назва, ціна) і просить обрати номер — НЕ каже «уточню в менеджера» і не кличе менеджера. На «2» — показує картку саме другої моделі з того списку і відповідає про її кольори.';
    const ex = await db.funnelTest.findFirst({ where: { botId: BOT, name } });
    const id = ex ? (await db.funnelTest.update({ where: { id: ex.id }, data: { steps, expectedOutcome: exp } })).id : (await FT.createTest({ botId: BOT, name, steps, expectedOutcome: exp, createdBy: 'claude' })).id;
    console.log(id); process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
