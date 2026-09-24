'use strict';
// Вигаданий бізнес для QA-тестів воронок (онбординг + Content Manager). Живе лише в ізольованих
// проєктах content2 «QA — тести воронок» і «QA — порожній» — реальні компанії тести не чіпають.

const QA_PROJECT_NAME = 'QA — Content Manager';
const QA_EMPTY_PROJECT_NAME = 'QA — порожній';

const PRODUCT_MAIN = 'Підписка «Ранок з Крихтою»';

const PROFILE = [
    {
        kind: 'founder',
        data: {
            core: 'Власниця невеликої київської пекарні, 8 років у ресторанній справі, починала су-шефом. Клієнти довіряють їй за уважність до смаків і вміння запамʼятати, що любить кожен постійний гість.',
            strengths: [
                'я вмію запамʼятовувати смаки кожного постійного клієнта',
                'я вмію робити свіжу випічку без консервантів щодня',
                'я вмію створювати відчуття дому вранці',
            ],
            interactionStyle: 'Тепла, уважна, з легким гумором. Говорить просто, без пафосу.',
            differentiators: [
                'Пече тільки на вершковому маслі, без маргарину',
                'Випічка щодня зранку, без заморозки',
                'Знає постійних клієнтів по імені й смаках',
            ],
            selfPresentation: ['Пекарка з 8-річним досвідом. Роблю так, щоб ранок у Києві починався з теплого хліба.'],
            archetypePrimary: 'Опікун',
            archetypeSecondary: 'Творець',
            archetypeDirection: 'Турбота і підтримка + створення нового',
            archetypeReasoning: 'Опікун — бо дбає про комфорт і смаки клієнтів; Творець як підсилювач — бо сама вигадує рецепти.',
        },
    },
    {
        kind: 'product',
        data: {
            name: PRODUCT_MAIN,
            description: 'Щоденна доставка свіжої випічки та кави вранці за підпискою по Києву.',
            pains: 'Немає часу зранку зайти в пекарню; магазинна випічка несвіжа; кожного дня одне й те саме.',
            transformation: 'Ранок починається зі свіжої випічки без походів по магазинах.',
            benefits: 'Свіже щодня, без консервантів, доставка до 8:00, можна поставити на паузу.',
            price: '990 грн на місяць',
            audience: 'Зайняті мешканці Києва 25-45 років, які цінують свіже й економлять ранковий час.',
            priority: 1,
        },
    },
    {
        kind: 'persona',
        data: {
            name: 'Зайнята мама в місті',
            pains: ['Немає часу зранку', 'Діти вередують на сніданок', 'Магазинна випічка розчаровує'],
            goals: ['Швидкий смачний сніданок для всієї родини', 'Менше ранкового стресу'],
            triggers: ['Ранкова метушня перед школою', 'Свято чи гості на вихідних'],
            objections: ['Дорого порівняно з магазином', 'А якщо не буде вдома, коли привезуть?'],
            language: 'Проста мова, про час, дітей і домашній затишок',
            tone: 'Тепло, підтримка, без тиску',
            forbiddenWords: ['інновація', 'унікальний', 'революційний'],
        },
    },
    {
        kind: 'brand',
        data: {
            title: 'Тон голосу Крихти',
            content: 'Теплий, домашній, з легким гумором. Пише як людина, а не бренд. Короткі речення чергуються з довшими. Без пафосу і корпоративних кліше. Іноді дужка в кінці як усмішка :)',
        },
    },
    {
        kind: 'strategy',
        data: {
            contentPillars: ['Закулісся пекарні', 'Свіжа випічка щодня', 'Історії постійних клієнтів', 'Ранковий ритуал'],
            intentDistribution: { educate: 20, sell: 20, trust: 30, storytelling: 20, entertainment: 10 },
        },
    },
    {
        kind: 'topics',
        data: {
            topics: [
                { rubric: 'personal', title: 'Як я почала пекти о четвертій ранку і не збожеволіла', contentType: 'lifestyle', cyclePosition: 'hope' },
                { rubric: 'galuzi', title: 'Чому магазинний круасан несмачний уже за годину', contentType: 'pain', cyclePosition: 'pain' },
                { rubric: 'nuances', title: '«Дорого за хліб?» — рахуємо разом, з чого складається ціна', contentType: 'objection', cyclePosition: 'objection' },
                { rubric: 'cases', title: 'Клієнтка, яка відмовилась від походів у магазин зранку', contentType: 'testimonial', cyclePosition: 'benefit' },
                { rubric: 'tools', title: '3 способи зберегти свіжість випічки до вечора', contentType: 'engagement', cyclePosition: 'benefit' },
                { rubric: 'personal', title: 'Що входить у мою ранкову підписку і що я туди ніколи не покладу', contentType: 'benefit', cyclePosition: 'desire' },
                { rubric: 'entertainment', title: 'Типи людей у черзі за круасанами о восьмій ранку', contentType: 'entertainment', cyclePosition: 'pain' },
                { rubric: 'heroes', title: 'Пекар, який навчив мене замішувати тісто на дотик', contentType: 'lifestyle', cyclePosition: 'super_benefit' },
            ],
        },
    },
    {
        kind: 'leadmagnet',
        data: {
            name: 'Чек-лист: сніданок за 10 хвилин',
            description: 'Короткий чек-лист швидких сніданків для зайнятих ранків.',
            productName: PRODUCT_MAIN,
        },
    },
];

module.exports = { QA_PROJECT_NAME, QA_EMPTY_PROJECT_NAME, PRODUCT_MAIN, PROFILE };
