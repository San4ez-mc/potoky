// Лёгкий JS-беавтифаєр ДЛЯ ЧИТАННЯ (не для виконання коду).
// Поважає рядки/шаблони/regex/коментарі; розбиває на { } ; та коми верхнього рівня.
// Використовується для показу коду нод у трейсі сесій та як фолбек-форматер.
export function formatJs(src) {
    if (typeof src !== 'string' || !src.trim()) return src || '';
    const s = src;
    let out = '';
    let indent = 0;
    const IND = '  ';
    let paren = 0;
    let i = 0;
    const n = s.length;
    let prevSig = '';
    const trimEnd = () => { out = out.replace(/[ \t]+$/, ''); };
    const nl = () => { trimEnd(); out += '\n' + IND.repeat(Math.max(0, indent)); };
    const skipWs = () => { while (i < n && /\s/.test(s[i])) i++; };
    while (i < n) {
        const c = s[i];
        if (c === '/' && s[i + 1] === '/') { let j = i; while (j < n && s[j] !== '\n') j++; if (!/\s$/.test(out) && out && !out.endsWith('\n')) out += ' '; out += s.slice(i, j); prevSig = ''; i = j; nl(); skipWs(); continue; }
        if (c === '/' && s[i + 1] === '*') { let j = i + 2; while (j < n && !(s[j] === '*' && s[j + 1] === '/')) j++; j += 2; out += s.slice(i, j); i = j; continue; }
        if (c === '"' || c === "'" || c === '`') {
            const q = c; let j = i + 1;
            while (j < n) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === q) { j++; break; } j++; }
            out += s.slice(i, j); prevSig = q; i = j; continue;
        }
        if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prevSig)) {
            let j = i + 1; let inCls = false;
            while (j < n) { const d = s[j]; if (d === '\\') { j += 2; continue; } if (d === '[') inCls = true; else if (d === ']') inCls = false; else if (d === '/' && !inCls) { j++; break; } else if (d === '\n') break; j++; }
            while (j < n && /[a-z]/i.test(s[j])) j++;
            out += s.slice(i, j); prevSig = '/'; i = j; continue;
        }
        if (c === '(' || c === '[') { paren++; out += c; prevSig = c; i++; continue; }
        if (c === ')' || c === ']') { paren = Math.max(0, paren - 1); out += c; prevSig = c; i++; continue; }
        if (c === '{') {
            let k = i + 1; while (k < n && /\s/.test(s[k])) k++;
            if (s[k] === '}') { out += '{}'; prevSig = '}'; i = k + 1; continue; }
            out += '{'; indent++; nl(); prevSig = '{'; i++; skipWs(); continue;
        }
        if (c === '}') {
            indent = Math.max(0, indent - 1); trimEnd(); if (!out.endsWith('\n')) nl(); out += '}'; prevSig = '}'; i++;
            skipWs();
            while (i < n && /[;,)\].]/.test(s[i])) { out += s[i]; prevSig = s[i]; i++; skipWs(); }
            if (/^(else|catch|finally|while)\b/.test(s.slice(i))) { out += ' '; continue; }
            if (i < n && s[i] !== '}' && s[i] !== ')' && s[i] !== ']') nl();
            continue;
        }
        if (c === ';' && paren === 0) { out += ';'; i++; skipWs(); if (i < n && s[i] !== '}') nl(); prevSig = ';'; continue; }
        if (/\s/.test(c)) { if (!/\s$/.test(out) && out !== '') out += ' '; i++; continue; }
        out += c; prevSig = c; i++;
    }
    return out.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, idx, arr) => !(l === '' && (arr[idx - 1] === '' || idx === 0))).join('\n');
}

// Груба евристика: рядок схожий на JS-код (а не звичайний текст/URL).
export function looksLikeJs(s) {
    if (typeof s !== 'string' || s.length < 40) return false;
    let hits = 0;
    if (/\b(var|let|const|function|return|await|async)\b/.test(s)) hits++;
    if (/=>|\)\s*\{|\}\s*(else|catch|finally)/.test(s)) hits++;
    if (/;\s*\w/.test(s)) hits++;
    if (/context\.|keys\.|await fetch|JSON\.(parse|stringify)/.test(s)) hits++;
    return hits >= 2;
}
