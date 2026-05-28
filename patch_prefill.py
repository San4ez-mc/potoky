import sys

CONTENT_FILE = '/var/www/content.fineko.space/php-mvc/app/views/content.php'

with open(CONTENT_FILE, 'r', encoding='utf-8') as f:
    content = f.read()

original = content
changes = 0

SAMPLE_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'

# ── Helpers ──────────────────────────────────────────────────────────────────
def patch_textarea(content, field_id, default_value):
    """Replace empty <textarea ...id="ID"...></textarea> with default value."""
    import re
    # Match textarea tags with the given id and empty content
    pattern = r'(<textarea\b[^>]*\bid="' + re.escape(field_id) + r'"[^>]*>)(</textarea>)'
    replacement = r'\g<1>' + default_value + r'\g<2>'
    new_content, n = re.subn(pattern, replacement, content)
    return new_content, n

def patch_input_value(content, field_id, default_value):
    """Add or replace value="" in <input ...id="ID"...> — sets a non-empty value."""
    import re
    # Match input tags with the given id
    # First try: already has value="" → replace with value="default"
    pattern_empty = r'(<input\b[^>]*\bid="' + re.escape(field_id) + r'"[^>]*\s)value=""'
    new_content, n = re.subn(pattern_empty, r'\g<1>value="' + default_value + '"', content)
    if n:
        return new_content, n
    # Second try: no value attribute at all → inject before >
    pattern_noval = r'(<input\b[^>]*\bid="' + re.escape(field_id) + r'"[^>]*)(>)'
    new_content, n = re.subn(pattern_noval, r'\g<1> value="' + default_value + r'"\2', content)
    return new_content, n

# ── ai-bg fields ─────────────────────────────────────────────────────────────
content, n = patch_textarea(content, 'ai-bg-prompt',
    'cinematic dark office with holographic financial screens, dramatic blue lighting, 8K professional photography, vertical 9:16')
changes += n; print(f'ai-bg-prompt: {n}')

content, n = patch_textarea(content, 'ai-bg-title',
    'Фінансова система твого бізнесу')
changes += n; print(f'ai-bg-title: {n}')

content, n = patch_input_value(content, 'ai-bg-subtitle', 'Cashflow · P&L · Баланс')
changes += n; print(f'ai-bg-subtitle: {n}')

content, n = patch_input_value(content, 'ai-bg-extra', '\U0001f4cc ЛАЙФХАК')
changes += n; print(f'ai-bg-extra: {n}')

# ── multi-plate fields ────────────────────────────────────────────────────────
content, n = patch_input_value(content, 'multi-plate-tag', '\U0001f4cc ЛАЙФХАК · ТОП-3')
changes += n; print(f'multi-plate-tag: {n}')

content, n = patch_textarea(content, 'multi-plate-title',
    'За одне заняття — повна фінансова система')
changes += n; print(f'multi-plate-title: {n}')

content, n = patch_input_value(content, 'multi-plate-subtitle', 'Cashflow · P&L · Баланс')
changes += n; print(f'multi-plate-subtitle: {n}')

content, n = patch_input_value(content, 'multi-plate-cta', 'Пиши + у коментарях \U0001f447')
changes += n; print(f'multi-plate-cta: {n}')

# ── social-proof fields ───────────────────────────────────────────────────────
content, n = patch_textarea(content, 'social-proof-quote',
    'Нарешті зрозумів куди йдуть гроші! Вже перший місяць у плюс \U0001f60a Дякуюза курс!')
changes += n; print(f'social-proof-quote: {n}')

content, n = patch_input_value(content, 'social-proof-author', 'Марія К.')
changes += n; print(f'social-proof-author: {n}')

content, n = patch_input_value(content, 'social-proof-result', 'Так тримати! \U0001f4aa')
changes += n; print(f'social-proof-result: {n}')

content, n = patch_input_value(content, 'social-proof-date', 'Сьогодні')
changes += n; print(f'social-proof-date: {n}')

# ── video fields ──────────────────────────────────────────────────────────────
content, n = patch_input_value(content, 'video-subs-videoUrl', SAMPLE_VIDEO)
changes += n; print(f'video-subs-videoUrl: {n}')

content, n = patch_input_value(content, 'video-karaoke-videoUrl', SAMPLE_VIDEO)
changes += n; print(f'video-karaoke-videoUrl: {n}')

# ── broll-kling prompt ────────────────────────────────────────────────────────
content, n = patch_textarea(content, 'broll-kling-prompt',
    'cinematic slow motion coins falling on dark marble surface, dramatic gold and blue lighting, shallow depth of field, 4K ultra realistic')
changes += n; print(f'broll-kling-prompt: {n}')

# ── summary ───────────────────────────────────────────────────────────────────
print(f'\nTotal replacements: {changes}')
if changes == 0:
    print('ERROR: nothing changed!')
    sys.exit(1)

with open(CONTENT_FILE, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'Done. Total lines: {len(content.splitlines())}')
