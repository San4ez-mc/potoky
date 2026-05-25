import React, { useState, useRef } from 'react';

const HF_API = 'https://hyperframes.flows.fineko.space';

// ─── Template definitions ───────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'social-reel',
    label: 'Рілс: Список тез',
    icon: '📋',
    category: 'reel',
    description: 'Анімовані bullet-points. Кожен пункт з\'являється по черзі.',
    fields: [
      { key: 'text',        label: 'Заголовок',        type: 'text',     placeholder: 'Фінансова система бізнесу' },
      { key: 'brandHandle', label: 'Бренд / @нік',     type: 'text',     placeholder: '@fineko.space' },
      { key: 'points',      label: 'Пункти (по одному на рядок)', type: 'textarea', placeholder: 'Cashflow: знаєш куди йдуть гроші\nP&L: бачиш реальний прибуток\nБаланс: контролюєш активи і борги' },
      { key: 'duration',    label: 'Тривалість (сек)', type: 'number',   placeholder: '', defaultValue: '' },
    ],
    transform: (raw) => ({
      text: raw.text,
      brandHandle: raw.brandHandle,
      points: raw.points ? raw.points.split('\n').map(s => s.trim()).filter(Boolean) : [],
      ...(raw.duration ? { duration: Number(raw.duration) } : {}),
    }),
  },
  {
    id: 'data-chart',
    label: 'Рілс: Bar Chart',
    icon: '📊',
    category: 'reel',
    description: 'Анімований стовпчастий графік. Ідеально для фінансових показників.',
    fields: [
      { key: 'text',        label: 'Заголовок',    type: 'text',     placeholder: 'Cashflow за квітень' },
      { key: 'subText',     label: 'Підзаголовок', type: 'text',     placeholder: 'Аналіз доходів і витрат' },
      { key: 'brandHandle', label: 'Бренд / @нік', type: 'text',     placeholder: '@fineko.space' },
      { key: 'items',       label: 'Стовпці (назва | число | #колір)', type: 'textarea',
        placeholder: 'Дохід | 245000 | #00c48c\nВитрати | 178000 | #ff6b6b\nПрибуток | 67000 | #00d4ff' },
    ],
    transform: (raw) => ({
      text: raw.text,
      subText: raw.subText,
      brandHandle: raw.brandHandle,
      items: raw.items
        ? raw.items.split('\n').map(s => {
            const [label, value, color] = s.split('|').map(x => x.trim());
            return { label, value: Number(value) || 0, color: color || '#00d4ff' };
          }).filter(i => i.label)
        : [],
    }),
  },
  {
    id: 'social-story',
    label: 'Сторі: Фото + текст',
    icon: '🖼',
    category: 'story',
    description: 'Фото як фон з темною накладкою. Заголовок і підзаголовок знизу.',
    fields: [
      { key: 'text',        label: 'Заголовок',        type: 'text',     placeholder: 'Знаєш скільки ти заробляєш?' },
      { key: 'subText',     label: 'Підзаголовок',     type: 'text',     placeholder: 'Розберемось за 3 уроки' },
      { key: 'brandHandle', label: 'Бренд / @нік',     type: 'text',     placeholder: '@fineko.space' },
      { key: 'photoUrl',    label: 'URL фото (необов\'язково)', type: 'text', placeholder: 'https://...' },
      { key: 'duration',    label: 'Тривалість (сек)', type: 'number',   placeholder: '8', defaultValue: '8' },
    ],
    transform: (raw) => ({
      text: raw.text,
      subText: raw.subText,
      brandHandle: raw.brandHandle,
      photoUrl: raw.photoUrl || '',
      ...(raw.duration ? { duration: Number(raw.duration) } : {}),
    }),
  },
];

const CATEGORIES = [
  { id: 'all',   label: 'Всі' },
  { id: 'reel',  label: 'Рілс (відео)' },
  { id: 'story', label: 'Сторіз (відео)' },
];

const QUALITY_OPTIONS = [
  { value: 'draft',    label: 'Чернетка (швидко)' },
  { value: 'standard', label: 'Стандарт' },
  { value: 'high',     label: 'Висока якість' },
];

// ─── Main component ──────────────────────────────────────────────────────────

export function ContentStudio() {
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState(null);
  const [values, setValues] = useState({});
  const [quality, setQuality] = useState('draft');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { videoUrl, duration }
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  const filtered = TEMPLATES.filter(t => category === 'all' || t.category === category);

  function selectTemplate(tpl) {
    setSelected(tpl);
    setResult(null);
    setError(null);
    // pre-fill defaults
    const defaults = {};
    tpl.fields.forEach(f => {
      if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
    });
    setValues(defaults);
  }

  function handleField(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  async function handleGenerate() {
    if (!selected) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = selected.transform(values);
      const resp = await fetch(`${HF_API}/render/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: selected.id, data, quality, fps: 24 }),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) throw new Error(json.error || 'Помилка рендеру');
      setResult(json);
      // auto-play after a tick
      setTimeout(() => videoRef.current?.play(), 100);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left panel: template picker ─────────────────────── */}
      <div className="w-72 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        {/* Category tabs */}
        <div className="px-3 pt-4 pb-2 border-b border-gray-800">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Тип контенту</div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  category === c.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Template cards */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => selectTemplate(tpl)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                selected?.id === tpl.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-800 hover:border-gray-600 bg-gray-900/50 hover:bg-gray-800/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{tpl.icon}</span>
                <span className="text-sm font-medium text-white">{tpl.label}</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{tpl.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel: form + preview ─────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col lg:flex-row gap-0 h-full">

            {/* Form */}
            <div className="lg:w-96 shrink-0 p-6 border-r border-gray-800 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white">{selected.label}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{selected.description}</p>
              </div>

              {selected.fields.map(f => (
                <FormField
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? ''}
                  onChange={val => handleField(f.key, val)}
                />
              ))}

              {/* Quality */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Якість</label>
                <select
                  value={quality}
                  onChange={e => setQuality(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {QUALITY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Spinner />
                    Рендеримо відео...
                  </>
                ) : (
                  '▶ Згенерувати'
                )}
              </button>

              {error && (
                <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-xs text-red-300">
                  {error}
                </div>
              )}
            </div>

            {/* Preview */}
            <div className="flex-1 p-6 flex flex-col items-center justify-start gap-4">
              <div className="text-xs text-gray-500 self-start">Прев'ю результату</div>

              {loading && (
                <div className="flex flex-col items-center justify-center gap-3 text-gray-500 py-20">
                  <Spinner size="lg" />
                  <span className="text-sm">Рендеримо... може зайняти 1–2 хвилини</span>
                </div>
              )}

              {!loading && !result && (
                <div className="flex flex-col items-center justify-center gap-2 text-gray-600 py-20 text-center">
                  <span className="text-4xl">🎬</span>
                  <span className="text-sm">Заповни форму і натисни «Згенерувати»</span>
                </div>
              )}

              {result && (
                <div className="flex flex-col items-center gap-3 w-full">
                  {/* 9:16 video container */}
                  <div
                    className="relative bg-black rounded-2xl overflow-hidden shadow-2xl"
                    style={{ width: 270, height: 480 }}
                  >
                    <video
                      ref={videoRef}
                      src={result.videoUrl}
                      controls
                      loop
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Тривалість: {result.duration}с</span>
                    <span>·</span>
                    <span>9:16</span>
                  </div>

                  <div className="flex gap-2 w-full max-w-xs">
                    <a
                      href={result.videoUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-center text-white transition-colors"
                    >
                      ⬇ Завантажити
                    </a>
                    <button
                      onClick={() => { navigator.clipboard.writeText(result.videoUrl); }}
                      className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-center text-white transition-colors"
                    >
                      🔗 Копіювати URL
                    </button>
                  </div>

                  <button
                    onClick={handleGenerate}
                    disabled={loading}
                    className="w-full max-w-xs py-2 rounded-lg border border-blue-600/50 text-xs text-blue-400 hover:bg-blue-600/10 transition-colors"
                  >
                    ↻ Перегенерувати
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FormField({ field, value, onChange }) {
  const base = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors";
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{field.label}</label>
      {field.type === 'textarea' ? (
        <textarea
          rows={4}
          value={value}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value)}
          className={base + ' resize-none font-mono text-xs'}
        />
      ) : (
        <input
          type={field.type}
          value={value}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value)}
          className={base}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600 py-24">
      <span className="text-5xl">🎨</span>
      <div className="text-base font-medium text-gray-400">Content Studio</div>
      <div className="text-sm text-gray-600 text-center max-w-xs">
        Вибери тип контенту зліва щоб почати генерацію
      </div>
    </div>
  );
}

function Spinner({ size = 'sm' }) {
  const s = size === 'lg' ? 'w-8 h-8 border-2' : 'w-4 h-4 border-2';
  return (
    <div className={`${s} border-gray-600 border-t-blue-400 rounded-full animate-spin`} />
  );
}
