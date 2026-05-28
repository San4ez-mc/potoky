import sys

with open('/var/www/content.fineko.space/php-mvc/app/views/content.php', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Insert AI B-roll section before Avatar header
AVATAR_HEADER = '            <tr class="cs-block-header" data-filter="video"><td colspan="5">\U0001f916 Аватар</td></tr>'

NEW_SECTION = (
    '            <!-- B-roll AI -->\n'
    '            <tr class="cs-block-header" data-filter="video"><td colspan="5">\U0001f3ac AI B-roll (текст → відео)</td></tr>\n'
    '            <tr class="cs-data-row" data-filter="video" data-id="broll-kling">\n'
    '                <td><div class="cs-type-cell"><div class="cs-icon cs-icon-reel" style="background:#f0f9ff">\U0001f3ac</div><div>'
    '<div class="cs-type-name">AI B-roll відео (Kling 1.6 Pro)</div>'
    '<div class="cs-type-desc">Текстовий промпт → Kling 1.6 Pro (fal.ai) → вертикальне відео 9:16 для Reels/TikTok. 5 або 10 сек. ~$0.49–$0.98.</div>'
    '<span class="cs-funnel-tag">&#128279; content-video-broll</span>'
    '</div></div></td>\n'
    '                <td><span class="cs-badge cs-badge-reel">Rілс / B-roll</span></td>\n'
    '                <td style="font-size:13px;color:#374151;">9:16 \xb7 MP4</td>\n'
    '                <td><span class="cs-status-ready"><span class="cs-status-dot dot-green"></span>Готово</span></td>\n'
    '                <td><button class="cs-launch-btn" onclick="toggleForm(\'broll-kling\')">► Запустити</button></td>\n'
    '            </tr>\n'
    '            <tr class="cs-inline-row" id="form-broll-kling">\n'
    '                <td colspan="5">\n'
    '                    <div class="cs-inline-panel">\n'
    '                        <div class="cs-panel-header">\n'
    '                            <span style="font-size:20px">\U0001f3ac</span>\n'
    '                            <span class="cs-panel-title">AI B-roll відео (Kling 1.6 Pro)</span>\n'
    '                            <button class="cs-close-btn" onclick="toggleForm(\'broll-kling\')">✕</button>\n'
    '                        </div>\n'
    '                        <div class="cs-panel-inner">\n'
    '                            <div class="cs-panel-form">\n'
    '                                <div class="cs-field">\n'
    '                                    <label>Промпт для відео <span style="color:#ef4444">*</span></label>\n'
    '                                    <textarea rows="4" id="broll-kling-prompt" placeholder="cinematic slow motion shot of coins falling on dark surface, dramatic gold lighting, macro photography, 4K ultra realistic"></textarea>\n'
    '                                    <div class="cs-field-hint">Англійською. Описуй рух, атмосферу, освітлення, темп камери.</div>\n'
    '                                </div>\n'
    '                                <div class="cs-field" style="margin-bottom:6px">\n'
    '                                    <label style="font-size:12px;color:#6b7280;margin-bottom:4px">Пресети:</label>\n'
    '                                    <div style="display:flex;flex-wrap:wrap;gap:6px">\n'
    '                                        <button type="button" class="cs-pick-gallery-btn" style="font-size:12px" '
    'onclick="document.getElementById(\'broll-kling-prompt\').value=\'cinematic slow motion coins falling on dark marble surface, dramatic gold and blue lighting, shallow depth of field, 4K\'">'
    '\U0001f4b0 Монети</button>\n'
    '                                        <button type="button" class="cs-pick-gallery-btn" style="font-size:12px" '
    'onclick="document.getElementById(\'broll-kling-prompt\').value=\'dynamic financial charts rising upward with glowing neon lines, dark background, cinematic motion, blue and gold palette\'">'
    '\U0001f4c8 Графіки</button>\n'
    '                                        <button type="button" class="cs-pick-gallery-btn" style="font-size:12px" '
    'onclick="document.getElementById(\'broll-kling-prompt\').value=\'aerial city night timelapse, glowing skyscraper lights, car trails, cinematic vertical shot, ultra realistic 4K\'">'
    '\U0001f306 Місто</button>\n'
    '                                        <button type="button" class="cs-pick-gallery-btn" style="font-size:12px" '
    'onclick="document.getElementById(\'broll-kling-prompt\').value=\'hands typing on laptop in dark office, holographic financial data floating around, blue ambient light, cinematic\'">'
    '\U0001f4bb Офіс</button>\n'
    '                                        <button type="button" class="cs-pick-gallery-btn" style="font-size:12px" '
    'onclick="document.getElementById(\'broll-kling-prompt\').value=\'abstract dark fluid background with golden particles flowing upward, luxury aesthetic, 4K smooth motion\'">'
    '✨ Абстракт</button>\n'
    '                                    </div>\n'
    '                                </div>\n'
    '                                <div class="cs-field">\n'
    '                                    <label>Тривалість</label>\n'
    '                                    <select id="broll-kling-duration">\n'
    '                                        <option value="5">5 секунд (~$0.49)</option>\n'
    '                                        <option value="10">10 секунд (~$0.98)</option>\n'
    '                                    </select>\n'
    '                                </div>\n'
    '                                <div class="cs-field">\n'
    '                                    <label>Negative prompt (опційно)</label>\n'
    '                                    <input type="text" id="broll-kling-negPrompt" placeholder="залиш порожнім для стандартного">\n'
    '                                    <div class="cs-field-hint">Дефолт: blur, distort, low quality, watermark, text, logos</div>\n'
    '                                </div>\n'
    '                                <button class="cs-gen-btn" id="btn-broll-kling" onclick="generateBroll(\'broll-kling\')">\U0001f3ac Згенерувати відео</button>\n'
    '                                <div class="cs-error-box" id="err-broll-kling"></div>\n'
    '                            </div>\n'
    '                            <div class="cs-panel-preview">\n'
    '                                <div id="preview-broll-kling">\n'
    '                                    <div class="cs-preview-placeholder"><span>\U0001f3ac</span><span>Результат тут</span></div>\n'
    '                                </div>\n'
    '                            </div>\n'
    '                        </div>\n'
    '                    </div>\n'
    '                </td>\n'
    '            </tr>\n'
)

if AVATAR_HEADER in content:
    content = content.replace(AVATAR_HEADER, NEW_SECTION + AVATAR_HEADER)
    print('HTML inserted OK')
else:
    print('ERROR: avatar header not found')
    print('Searching for partial match...')
    if 'Аватар' in content:
        idx = content.index('Аватар')
        print('Found Аватар at index', idx)
        print('Context:', repr(content[max(0,idx-100):idx+50]))
    sys.exit(1)

# 2. Add JS function before sleep()
JS_ANCHOR = 'function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }'

NEW_JS = (
    'async function generateBroll(prefix) {\n'
    '    const btn = document.getElementById(\'btn-\' + prefix);\n'
    '    const errBox = document.getElementById(\'err-\' + prefix);\n'
    '    const previewDiv = document.getElementById(\'preview-\' + prefix);\n'
    '    const prompt = (document.getElementById(prefix + \'-prompt\')?.value || \'\').trim();\n'
    '    if (!prompt) { errBox.textContent = \'Вкажи промпт для відео\'; errBox.style.display = \'block\'; return; }\n'
    '    const params = {\n'
    '        prompt,\n'
    '        duration:       document.getElementById(prefix + \'-duration\')?.value || \'5\',\n'
    '        negativePrompt: (document.getElementById(prefix + \'-negPrompt\')?.value || \'\').trim(),\n'
    '    };\n'
    '    btn.disabled = true; btn.innerHTML = \'<div class="spinner"></div> Запускаємо...\';\n'
    '    errBox.style.display = \'none\';\n'
    '    previewDiv.innerHTML = \'<div class="cs-preview-placeholder"><span>\U0001f3ac</span><span>Генеруємо відео...</span></div>\'\n'
    '        + \'<div class="cs-progress"><div class="cs-progress-bar"></div></div>\'\n'
    '        + \'<div style="font-size:11px;color:#6b7280;">Kling: 30–90 секунд</div>\';\n'
    '    let jobId = null;\n'
    '    try {\n'
    '        const resp = await fetch(\'/api/content-generate\', {\n'
    '            method: \'POST\', headers: { \'Content-Type\': \'application/json\' },\n'
    '            body: JSON.stringify({ funnel: \'content-video-broll\', params }),\n'
    '        });\n'
    '        const json = await resp.json();\n'
    '        if (!resp.ok || json.error) throw new Error(json.error || \'Помилка запуску\');\n'
    '        jobId = json.jobId;\n'
    '    } catch (e) {\n'
    '        showError(prefix, e.message); btn.disabled = false; btn.innerHTML = \'\U0001f3ac Згенерувати відео\'; return;\n'
    '    }\n'
    '    btn.innerHTML = \'<div class="spinner"></div> Генеруємо...\';\n'
    '    const result = await pollStatus(jobId, prefix);\n'
    '    btn.disabled = false; btn.innerHTML = \'\U0001f3ac Згенерувати відео\';\n'
    '    if (!result) return;\n'
    '    if (result.mediaType === \'video\' && result.videoUrl) {\n'
    '        previewDiv.innerHTML = \'<div class="cs-video-box"><video src="\' + result.videoUrl + \'" controls loop playsinline autoplay muted></video></div>\'\n'
    '            + \'<div class="cs-result-actions" style="width:200px;margin-top:8px">\'\n'
    '            + \'<a class="cs-action-btn" href="\' + result.videoUrl + \'" download>⬇ Завантажити</a>\'\n'
    '            + \'<button class="cs-action-btn" onclick="copyUrl(\\\'\' + result.videoUrl + \'\\\',this)">\U0001f517 URL</button>\'\n'
    '            + \'</div>\'\n'
    '            + \'<button class="cs-regen-btn" style="width:200px;margin-top:6px" onclick="generateBroll(\\\'\' + prefix + \'\\\')">↻ Перегенерувати</button>\';\n'
    '    } else {\n'
    '        showError(prefix, result.error || \'Відео не отримано\');\n'
    '    }\n'
    '}\n\n'
)

if JS_ANCHOR in content:
    content = content.replace(JS_ANCHOR, NEW_JS + JS_ANCHOR)
    print('JS inserted OK')
else:
    print('ERROR: JS anchor not found')
    sys.exit(1)

# 3. Update counter
content = content.replace(
    '<strong style="color:#22c55e">9 готових</strong>',
    '<strong style="color:#22c55e">10 готових</strong>'
)
content = content.replace(
    'Силует\xd72 + Карусель + Solid/Photo/SocProof/Promo + Субтитри\xd72)',
    'Силует\xd72 + Карусель + Solid/Photo/SocProof/Promo + Субтитри\xd72 + AI B-roll)'
)
print('Counter updated OK')

with open('/var/www/content.fineko.space/php-mvc/app/views/content.php', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done. Total lines: ' + str(len(content.splitlines())))
