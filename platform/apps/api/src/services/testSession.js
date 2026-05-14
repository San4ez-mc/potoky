'use strict';

const { db } = require('@platform/db');
const { callClaude } = require('@platform/claude');
const { BOT_REQUIREMENTS } = require('../../../../projects/finance-course/config/prerequisites');
const { enableTestChat, disableTestChat, consumeTestMessages } = require('@platform/telegram');

const { handleTelegramUpdate } = require('../../../../projects/finance-course/src/telegramHandler');

const MAX_SAFE_TELEGRAM_ID = 9007199254740991;

function toSafeNumberTelegramId(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isSafeInteger(num)) {
        throw new Error('User telegramId is not a safe integer for test delivery');
    }
    return num;
}

function buildSyntheticTelegramIdentity(botSlug) {
    const base = 700000000;
    const random = Math.floor(Math.random() * 100000000);
    const telegramId = base + random;
    return {
        telegramId,
        username: `test_${botSlug}_${Date.now()}`,
        firstName: 'Test',
        lastName: 'Runner',
        languageCode: 'uk',
    };
}

function buildUpdate(identity, text) {
    const now = Date.now();
    return {
        update_id: now,
        message: {
            message_id: now,
            from: {
                id: identity.telegramId,
                is_bot: false,
                first_name: identity.firstName || 'Test',
                last_name: identity.lastName || '',
                username: identity.username || null,
                language_code: identity.languageCode || 'uk',
            },
            chat: {
                id: identity.telegramId,
                type: 'private',
            },
            date: Math.floor(now / 1000),
            text,
        },
    };
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getByPath(source, path) {
    if (!path || typeof path !== 'string') return undefined;
    return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function setByPath(source, path, value) {
    if (!path || typeof path !== 'string') return;
    const parts = path.split('.');
    let cursor = source;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key];
    }
    cursor[parts[parts.length - 1]] = value;
}

function normalizeContextOverride(contextOverride) {
    if (!contextOverride || typeof contextOverride !== 'object' || Array.isArray(contextOverride)) {
        return {};
    }

    const normalized = {};
    for (const [rawKey, value] of Object.entries(contextOverride)) {
        if (!rawKey || typeof rawKey !== 'string') continue;
        const key = rawKey.replace(/^context\./, '');
        if (!key) continue;
        normalized[key] = value;
    }
    return normalized;
}

function renderTemplate(input, scope) {
    if (typeof input !== 'string') return input || '';
    return input.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, expr) => {
        const resolved = getByPath(scope, String(expr).trim());
        if (resolved === null || resolved === undefined) return '';
        return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    });
}

function getOutgoingEdges(edges, nodeId) {
    return (Array.isArray(edges) ? edges : []).filter((edge) => edge.source === nodeId);
}

function pickNextNodeId(edges, nodeId, branch) {
    const outgoing = getOutgoingEdges(edges, nodeId);
    if (outgoing.length === 0) return null;
    if (branch) {
        const normalized = String(branch).toLowerCase();
        const branched = outgoing.find((edge) => String(edge.sourceHandle || '').toLowerCase().includes(normalized));
        if (branched) return branched.target;
    }
    return outgoing[0].target;
}

function parseClaudeMessages(template, scope, fallbackUserMessage) {
    const fallback = [{ role: 'user', content: fallbackUserMessage || 'Продовжуємо діалог' }];
    if (!template || typeof template !== 'string') return fallback;

    try {
        const parsed = JSON.parse(renderTemplate(template, scope));
        if (Array.isArray(parsed)) {
            const items = parsed
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    role: item.role || 'user',
                    content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content || ''),
                }))
                .filter((item) => item.content);
            return items.length > 0 ? items : fallback;
        }
    } catch (_error) {
        // Ignore malformed template and use fallback
    }

    return fallback;
}

function truncateHistory(messages, maxItems = 24) {
    if (!Array.isArray(messages)) return [];
    if (messages.length <= maxItems) return messages;
    return messages.slice(messages.length - maxItems);
}

function extractJsonSegment(text) {
    if (!text || typeof text !== 'string') return null;

    const tryParse = (value) => {
        try {
            return JSON.parse(value);
        } catch (_error) {
            return null;
        }
    };

    const raw = text;
    const trimmed = raw.trim();
    const trimmedStartOffset = raw.indexOf(trimmed);

    const parsedDirect = tryParse(trimmed);
    if (parsedDirect !== null) {
        return {
            parsed: parsedDirect,
            start: Math.max(trimmedStartOffset, 0),
            end: Math.max(trimmedStartOffset, 0) + trimmed.length,
        };
    }

    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch && fencedMatch[1]) {
        const parsedFenced = tryParse(fencedMatch[1].trim());
        if (parsedFenced !== null) {
            const start = fencedMatch.index || 0;
            const end = start + fencedMatch[0].length;
            return { parsed: parsedFenced, start, end };
        }
    }

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const sliced = raw.slice(firstBrace, lastBrace + 1).trim();
        const parsedSliced = tryParse(sliced);
        if (parsedSliced !== null) {
            return {
                parsed: parsedSliced,
                start: firstBrace,
                end: lastBrace + 1,
            };
        }
    }

    return null;
}

function extractJsonValue(text) {
    return extractJsonSegment(text)?.parsed ?? null;
}

function containsMarkdown(text) {
    if (!text || typeof text !== 'string') return false;
    return /```/.test(text) || /^#{1,6}\s+/m.test(text);
}

function isUserConfirmation(text) {
    if (!text || typeof text !== 'string') return false;

    const normalized = text
        .trim()
        .toLowerCase()
        .replace(/[\s\n\t]+/g, ' ')
        .replace(/[!?,.;:()\[\]"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) return false;

    const hasPositive = /\b(так|ок|окей|okay|гаразд|вірно|правильно|yes|yep|sure|done|підтверджую|підтверджено|погоджуюсь|згоден)\b/u.test(normalized);
    const hasNegative = /\b(ні|no|not now|ще ні|не зараз|не вірно|неправильно|скасувати|cancel|stop)\b/u.test(normalized);

    return hasPositive && !hasNegative;
}

function shouldExitDialog({ exitCondition, responseText, inputText }) {
    const condition = String(exitCondition || 'json_output').trim();

    if (condition === 'json_output') {
        const jsonSegment = extractJsonSegment(responseText);
        return {
            done: jsonSegment !== null,
            parsed: jsonSegment?.parsed ?? null,
            jsonStart: jsonSegment?.start ?? null,
        };
    }

    if (condition.startsWith('keyword:')) {
        const keyword = condition.slice('keyword:'.length).trim();
        if (!keyword) return { done: false, parsed: null };
        return { done: String(responseText || '').toLowerCase().includes(keyword.toLowerCase()), parsed: null };
    }

    if (condition === 'user_confirms') {
        return { done: isUserConfirmation(inputText), parsed: null };
    }

    if (condition === 'markdown_output') {
        return { done: containsMarkdown(responseText), parsed: null };
    }

    return { done: false, parsed: null };
}

function stripJsonAndTrailingText(responseText, jsonStart) {
    if (!responseText || typeof responseText !== 'string') return '';
    if (typeof jsonStart !== 'number' || jsonStart <= 0) return '';
    return responseText.slice(0, jsonStart).trim();
}

function getFlowRuntime(context) {
    const ctx = asObject(context);
    const runtime = asObject(ctx.flowRuntime);
    if (!Array.isArray(runtime.nodesVisited)) runtime.nodesVisited = [];
    runtime.dialogHistory = asObject(runtime.dialogHistory);
    return { ctx, runtime };
}

async function findOrCreateTestUser(bot, identity) {
    const existing = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
    if (existing) return existing;

    return db.user.create({
        data: {
            telegramId: BigInt(identity.telegramId),
            username: identity.username,
            firstName: identity.firstName,
            lastName: identity.lastName,
            languageCode: identity.languageCode || 'uk',
            projectId: bot.projectId,
            metadata: { source: 'test-session-flow-runtime' },
        },
    });
}

async function getFlowDefinition(botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) return null;
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    if (nodes.length === 0) return null;
    return { nodes, edges };
}

function findStartNode(nodes) {
    return nodes.find((node) => node.type === 'start') || nodes[0] || null;
}

async function persistAssistantMessage(sessionId, content, metadata = {}) {
    if (!content) return;
    await db.message.create({
        data: {
            sessionId,
            role: 'assistant',
            content,
            metadata,
        },
    });
}

async function persistUserMessage(sessionId, content) {
    await db.message.create({
        data: {
            sessionId,
            role: 'user',
            content,
            metadata: { source: 'test_session' },
        },
    });
}

async function executeFlowStep({ sessionId, incomingUserMessage = null }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: { user: true, bot: true },
    });
    if (!session) throw new Error('Session not found');

    const flow = await getFlowDefinition(session.botId);
    if (!flow) {
        return { session, botResponse: null, flowDriven: false };
    }

    const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
    const { ctx, runtime } = getFlowRuntime(session.context);
    if (!runtime.currentNodeId) {
        runtime.currentNodeId = findStartNode(flow.nodes)?.id || null;
    }

    if (incomingUserMessage) {
        runtime.lastUserMessage = incomingUserMessage;
        runtime.waitingForUser = false;
    }

    let lastAssistant = null;
    let guard = 0;

    while (runtime.currentNodeId && guard < 40) {
        guard += 1;
        const node = nodesById.get(runtime.currentNodeId);
        if (!node) break;

        runtime.nodesVisited.push(node.id);
        const data = asObject(node.data);
        const scope = {
            context: ctx,
            user: session.user,
            session: { id: session.id, state: session.state },
            input: runtime.lastUserMessage || '',
        };

        if (node.type === 'start') {
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'message') {
            const text = renderTemplate(data.text || data.label || '', scope) || '...';
            await persistAssistantMessage(session.id, text, { nodeId: node.id, nodeType: node.type });
            lastAssistant = text;
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'claude') {
            const mode = String(data.mode || 'single');
            const exitCondition = data.exitCondition || 'json_output';
            const isUserConfirmExit = exitCondition === 'user_confirms';

            // Check if we need user input (not in finalization stage for user_confirms)
            const inFinalizationStage = isUserConfirmExit && runtime.userConfirmationReceived;
            if (!runtime.lastUserMessage && !inFinalizationStage) {
                runtime.waitingForUser = true;
                break;
            }

            const systemPrompt = renderTemplate(data.systemPrompt || 'You are a helpful assistant.', scope);
            let messages;

            if (mode === 'dialog') {
                const historyForNode = Array.isArray(runtime.dialogHistory[node.id])
                    ? runtime.dialogHistory[node.id]
                    : [];

                if (historyForNode.length > 0) {
                    messages = [...historyForNode, { role: 'user', content: runtime.lastUserMessage || '' }];
                } else if (data.messagesTemplate) {
                    messages = parseClaudeMessages(data.messagesTemplate, scope, runtime.lastUserMessage || '');
                } else {
                    messages = [{ role: 'user', content: runtime.lastUserMessage || '' }];
                }
            } else {
                messages = parseClaudeMessages(data.messagesTemplate, scope, runtime.lastUserMessage || '');
            }

            const responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages,
                options: data.model ? { model: data.model } : {},
            });

            if (mode === 'dialog') {
                // For user_confirms in finalization stage: skip exit condition check, just finalize and move on
                if (inFinalizationStage) {
                    await persistAssistantMessage(session.id, responseText, { nodeId: node.id, nodeType: node.type });
                    lastAssistant = responseText;

                    if (data.outputVar) {
                        const outputPath = String(data.outputVar).replace(/^context\./, '');
                        setByPath(ctx, outputPath, responseText);
                    }

                    const historyWithReply = truncateHistory([
                        ...messages,
                        { role: 'assistant', content: responseText },
                    ]);
                    runtime.dialogHistory[node.id] = historyWithReply;

                    runtime.userConfirmationReceived = false;
                    runtime.lastUserMessage = '';
                    runtime.waitingForUser = false;
                    runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                    continue;
                }

                // Normal exit condition check
                const exit = shouldExitDialog({
                    exitCondition: exitCondition,
                    responseText,
                    inputText: runtime.lastUserMessage,
                });

                const isJsonExit = String(exitCondition).trim() === 'json_output';
                const visibleAssistantText = (exit.done && isJsonExit)
                    ? stripJsonAndTrailingText(responseText, exit.jsonStart)
                    : responseText;

                if (visibleAssistantText) {
                    await persistAssistantMessage(session.id, visibleAssistantText, { nodeId: node.id, nodeType: node.type });
                    lastAssistant = visibleAssistantText;
                }

                const historyWithReply = truncateHistory([
                    ...messages,
                    { role: 'assistant', content: responseText },
                ]);
                runtime.dialogHistory[node.id] = historyWithReply;

                if (exit.done) {
                    if (data.outputVar && !isUserConfirmExit) {
                        const outputPath = String(data.outputVar).replace(/^context\./, '');
                        setByPath(ctx, outputPath, exit.parsed !== null ? exit.parsed : responseText);
                    }

                    // For user_confirms: flag for finalization on next iteration
                    if (isUserConfirmExit) {
                        runtime.userConfirmationReceived = true;
                        runtime.lastUserMessage = '';
                        runtime.waitingForUser = false;
                        continue;
                    }

                    // Regular exit
                    runtime.lastUserMessage = '';
                    runtime.waitingForUser = false;
                    runtime.userConfirmationReceived = false;
                    runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                } else {
                    runtime.lastUserMessage = '';
                    runtime.waitingForUser = true;
                    break;
                }
                continue;
            }

            await persistAssistantMessage(session.id, responseText, { nodeId: node.id, nodeType: node.type });
            lastAssistant = responseText;

            if (data.outputVar) {
                setByPath(ctx, String(data.outputVar).replace(/^context\./, ''), responseText);
            }

            runtime.lastUserMessage = '';
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'saveFile') {
            const fileType = data.fileType || 'generated_artifact';
            const contentPath = data.contentVar ? String(data.contentVar).replace(/^context\./, '') : '';
            const normalizedFileType = (contentPath === 'articles_result' && (fileType === 'cashflow_articles' || fileType === 'pl_articles'))
                ? 'articles'
                : fileType;

            let fileContent = '';
            if (data.contentVar) {
                const value = getByPath(ctx, contentPath);
                fileContent = typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2);
            }
            if (!fileContent) {
                fileContent = data.template ? renderTemplate(data.template, scope) : `Generated by node ${node.id}`;
            }

            const duplicateInSession = await db.file.findFirst({
                where: {
                    sessionId: session.id,
                    content: fileContent,
                    fileType: normalizedFileType,
                },
                select: { id: true },
            });

            if (duplicateInSession) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            await db.file.create({
                data: {
                    userId: session.userId,
                    botId: session.botId,
                    sessionId: session.id,
                    fileType: normalizedFileType,
                    fileName: `${normalizedFileType}_${Date.now()}.md`,
                    filePath: `/tmp/test-flow/${session.id}/${normalizedFileType}.md`,
                    content: fileContent,
                    version: 1,
                },
            });

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'generateDocument') {
            const sourceVar = data.sourceVar ? String(data.sourceVar).replace(/^context\./, '') : '';
            const template = data.template || 'default';
            const filename = renderTemplate(data.filename || 'document.docx', scope);
            const sendToUser = data.sendToUser === true;

            let sourceContent = '';
            if (sourceVar) {
                const value = getByPath(ctx, sourceVar);
                sourceContent = typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2);
            }

            // Generate simple document content (can be enhanced with docx library)
            let documentContent = '';
            if (template === 'student_profile') {
                const profileData = sourceContent ? (typeof sourceContent === 'string' ? JSON.parse(sourceContent) : sourceContent) : {};
                documentContent = `
ПРОФІЛЬ СТУДЕНТА — Урок 1.1
${new Date().toLocaleDateString('uk-UA')}

Ім'я: ${profileData.name || '—'}
Роль: ${profileData.role || '—'}
Компанія: ${profileData.company_description || '—'}
Головна фінансова проблема: ${profileData.main_problem || '—'}

---
Цей документ згенеровано автоматично системою курсу.
Зберігається у вашому профілі та доступний на всіх наступних заняттях.
                `.trim();
            } else if (template === 'business_process') {
                documentContent = sourceContent || 'Business process document';
            } else {
                documentContent = sourceContent || 'Generated document';
            }

            // Save as file artifact
            const fileType = `document_${template}`;
            const fileName = filename || `${template}_${Date.now()}.txt`;

            const duplicateInSession = await db.file.findFirst({
                where: {
                    sessionId: session.id,
                    content: documentContent,
                    fileType: fileType,
                },
                select: { id: true },
            });

            if (!duplicateInSession) {
                await db.file.create({
                    data: {
                        userId: session.userId,
                        botId: session.botId,
                        sessionId: session.id,
                        fileType: fileType,
                        fileName: fileName,
                        filePath: `/tmp/test-flow/${session.id}/${fileName}`,
                        content: documentContent,
                        version: 1,
                    },
                });
            }

            // If sendToUser is true, persist message with document reference
            if (sendToUser) {
                await persistAssistantMessage(session.id, `📄 Документ: ${fileName}`, {
                    nodeId: node.id,
                    nodeType: node.type,
                    attachment: { type: 'document', fileName, template },
                });
                lastAssistant = `📄 Документ: ${fileName}`;
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'condition') {
            let result = false;
            try {
                const expr = data.condition || 'false';
                result = Boolean(Function('context', 'user', 'session', 'input', `return (${expr});`)(ctx, session.user, session, runtime.lastUserMessage || ''));
            } catch (_error) {
                result = false;
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id, result ? 'true' : 'false');
            continue;
        }

        if (node.type === 'httpEncode') {
            const sourceVar = data.sourceVar ? String(data.sourceVar).replace(/^context\./, '') : '';
            const outputVar = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : '';
            
            if (!sourceVar || !outputVar) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            try {
                const sourceValue = getByPath(ctx, sourceVar);
                const textToEncode = typeof sourceValue === 'string' ? sourceValue : JSON.stringify(sourceValue || '');
                const encoded = Buffer.from(textToEncode).toString('base64');
                setByPath(ctx, outputVar, encoded);
            } catch (_error) {
                // Silently skip encoding on error
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'httpRequest') {
            const url = renderTemplate(data.url || '', ctx);
            const method = (data.method || 'GET').toUpperCase();
            const outputVar = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : '';
            
            if (!url) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            try {
                const https = require('https');
                const response = await new Promise((resolve, reject) => {
                    https.get(url, (res) => {
                        let data = Buffer.alloc(0);
                        res.on('data', (chunk) => {
                            data = Buffer.concat([data, chunk]);
                        });
                        res.on('end', () => resolve(data));
                        res.on('error', reject);
                    }).on('error', reject);
                });

                if (outputVar) {
                    setByPath(ctx, outputVar, response.toString('base64'));
                }
            } catch (_error) {
                // Silently skip HTTP request on error
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'sendPhoto') {
            const photoVar = data.photoVar ? String(data.photoVar).replace(/^context\./, '') : '';
            const caption = renderTemplate(data.caption || '', ctx);
            
            if (!photoVar) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            try {
                const photoData = getByPath(ctx, photoVar);
                let photoUrl = '';

                // If photoData is base64, convert to data URL
                if (typeof photoData === 'string' && photoData.length > 0) {
                    if (photoData.startsWith('http')) {
                        photoUrl = photoData;
                    } else {
                        photoUrl = `data:image/png;base64,${photoData}`;
                    }
                }

                if (photoUrl) {
                    // Store as metadata for later telegram send
                    await persistAssistantMessage(session.id, caption || '📸 Фото', {
                        nodeId: node.id,
                        nodeType: node.type,
                        attachment: { type: 'photo', url: photoUrl, caption },
                    });

                    if (caption) {
                        lastAssistant = caption;
                    }
                }
            } catch (_error) {
                // Silently skip on error
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
    }

    const completed = !runtime.currentNodeId;
    const state = completed ? 'completed' : runtime.currentNodeId;
    const updatedContext = {
        ...ctx,
        flowRuntime: runtime,
        currentNode: runtime.currentNodeId || null,
    };

    const updatedSession = await db.session.update({
        where: { id: session.id },
        data: {
            state,
            context: updatedContext,
            isActive: !completed,
            completedAt: completed ? new Date() : null,
            lastActive: new Date(),
        },
    });

    return {
        session: updatedSession,
        botResponse: lastAssistant,
        flowDriven: true,
        contextSnapshot: updatedContext,
    };
}

async function resolveBot({ botId, botSlug }) {
    if (!botId && !botSlug) {
        throw new Error('Provide botId or botSlug');
    }

    const bot = await db.bot.findFirst({
        where: botId ? { id: botId } : { slug: botSlug },
        include: { project: true },
    });

    if (!bot) {
        throw new Error('Bot not found');
    }

    if (bot.project?.slug !== 'finance-course') {
        throw new Error('Test session currently supports finance-course bots only');
    }

    return bot;
}

async function resolveIdentity(userId, botSlug) {
    if (!userId) {
        return buildSyntheticTelegramIdentity(botSlug);
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error('User not found');
    }

    return {
        telegramId: toSafeNumberTelegramId(user.telegramId),
        username: user.username || `test_user_${user.id.slice(0, 8)}`,
        firstName: user.firstName || 'Test',
        lastName: user.lastName || '',
        languageCode: user.languageCode || 'uk',
    };
}

async function getLatestAssistantMessage(sessionId) {
    return db.message.findFirst({
        where: { sessionId, role: 'assistant' },
        orderBy: { createdAt: 'desc' },
    });
}

async function findLatestSession(userId, botId) {
    return db.session.findFirst({
        where: { userId, botId },
        orderBy: { startedAt: 'desc' },
    });
}

async function ensurePrerequisiteFiles(userId, bot) {
    const requirements = BOT_REQUIREMENTS[bot.slug] || { files: [] };

    for (const fileType of requirements.files || []) {
        const latest = await db.file.findFirst({
            where: { userId, fileType },
            orderBy: { version: 'desc' },
        });

        if (latest) {
            continue;
        }

        await db.file.create({
            data: {
                userId,
                botId: bot.id,
                fileType,
                fileName: `${fileType}_seed_v1.md`,
                filePath: `/tmp/test-seed/${userId}/${fileType}_v1.md`,
                content: `Seed file for automated regression: ${fileType}`,
                version: 1,
            },
        });
    }
}

async function startTestSession({ botId, botSlug, userId, contextOverride }) {
    const bot = await resolveBot({ botId, botSlug });
    const identity = await resolveIdentity(userId, bot.slug);

    const flow = await getFlowDefinition(bot.id);
    if (flow) {
        const user = await findOrCreateTestUser(bot, identity);
        await ensurePrerequisiteFiles(user.id, bot);
        const overrideContext = normalizeContextOverride(contextOverride);

        const startNode = findStartNode(flow.nodes);
        const created = await db.session.create({
            data: {
                userId: user.id,
                botId: bot.id,
                state: startNode?.id || 'start',
                context: {
                    ...overrideContext,
                    currentNode: startNode?.id || null,
                    testMode: 'flow',
                    flowRuntime: {
                        currentNodeId: startNode?.id || null,
                        waitingForUser: false,
                        nodesVisited: [],
                        lastUserMessage: '',
                    },
                },
            },
        });

        const stepped = await executeFlowStep({ sessionId: created.id });
        const firstMessage = await getLatestAssistantMessage(created.id);

        return {
            sessionId: created.id,
            firstMessage: firstMessage?.content || null,
            currentState: stepped.session.state,
            contextSnapshot: stepped.contextSnapshot,
            slotsSnapshot: stepped.contextSnapshot?.slots || {},
            testUser: {
                id: user.id,
                telegramId: identity.telegramId,
                username: identity.username,
            },
            warning: null,
            mode: 'flow',
        };
    }

    let warning = null;
    const diagnostics = [];
    const attempts = [
        `/start ${bot.slug}`,
        '/start',
        'Привіт',
        `/start ${bot.slug}`,
    ];

    for (const message of attempts) {
        try {
            enableTestChat(identity.telegramId);
            await handleTelegramUpdate(buildUpdate(identity, message));
        } catch (error) {
            warning = error.message;
        } finally {
            disableTestChat(identity.telegramId);
            consumeTestMessages(identity.telegramId);
        }

        const existingUser = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
        if (!existingUser) {
            diagnostics.push({ message, userCreated: false, sessionCreated: false, warning });
            continue;
        }

        await ensurePrerequisiteFiles(existingUser.id, bot);

        const existingSession = await findLatestSession(existingUser.id, bot.id);
        diagnostics.push({
            message,
            userCreated: true,
            sessionCreated: Boolean(existingSession),
            warning,
        });
        if (existingSession) break;
    }

    const user = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
    if (!user) {
        throw new Error('Test user was not created by handler');
    }

    const session = await findLatestSession(user.id, bot.id);

    if (!session) {
        throw new Error(`Test session was not created. Diagnostics: ${JSON.stringify(diagnostics)}`);
    }

    const firstMessage = await getLatestAssistantMessage(session.id);

    return {
        sessionId: session.id,
        firstMessage: firstMessage?.content || null,
        currentState: session.state,
        contextSnapshot: session.context,
        slotsSnapshot: session.context?.slots || {},
        testUser: {
            id: user.id,
            telegramId: identity.telegramId,
            username: identity.username,
        },
        warning,
    };
}

async function sendTestMessage({ sessionId, message }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: { user: true, bot: { include: { project: true } } },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    if (session.context?.testMode === 'flow') {
        await persistUserMessage(session.id, message);
        const stepped = await executeFlowStep({ sessionId: session.id, incomingUserMessage: message });

        return {
            sessionId: session.id,
            botResponse: stepped.botResponse,
            currentState: stepped.session.state,
            contextSnapshot: stepped.contextSnapshot,
            slotsSnapshot: stepped.contextSnapshot?.slots || {},
            warning: null,
            mode: 'flow',
        };
    }

    if (session.bot.project?.slug !== 'finance-course') {
        throw new Error('Test session currently supports finance-course bots only');
    }

    const identity = {
        telegramId: toSafeNumberTelegramId(session.user.telegramId),
        username: session.user.username || `test_user_${session.user.id.slice(0, 8)}`,
        firstName: session.user.firstName || 'Test',
        lastName: session.user.lastName || '',
        languageCode: session.user.languageCode || 'uk',
    };

    let warning = null;
    try {
        enableTestChat(identity.telegramId);
        await handleTelegramUpdate(buildUpdate(identity, message));
    } catch (error) {
        warning = error.message;
    } finally {
        disableTestChat(identity.telegramId);
    }

    const sentMessages = consumeTestMessages(identity.telegramId);
    const lastSent = sentMessages.length > 0 ? sentMessages[sentMessages.length - 1] : null;

    const latestAssistantMessage = await getLatestAssistantMessage(session.id);
    const updatedSession = await db.session.findUnique({ where: { id: session.id } });

    return {
        sessionId: session.id,
        botResponse: lastSent?.text || latestAssistantMessage?.content || null,
        currentState: updatedSession?.state || session.state,
        contextSnapshot: updatedSession?.context || session.context,
        slotsSnapshot: (updatedSession?.context || session.context)?.slots || {},
        warning,
    };
}

async function getTestSessionState({ sessionId }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: {
            user: { select: { id: true, firstName: true, username: true, telegramId: true } },
            bot: { select: { id: true, name: true, slug: true } },
            messages: { orderBy: { createdAt: 'asc' }, take: 200 },
            files: { orderBy: { createdAt: 'desc' }, take: 100 },
        },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    return {
        sessionId: session.id,
        bot: session.bot,
        user: session.user,
        isActive: session.isActive,
        currentState: session.state,
        currentNode: session.context?.currentNode || session.context?.currentNodeId || session.state || null,
        nodesVisited: session.context?.flowRuntime?.nodesVisited || null,
        context: session.context,
        slots: session.context?.slots || {},
        history: session.messages,
        files: session.files,
    };
}

async function endTestSession({ sessionId }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: {
            _count: { select: { messages: true, apiCalls: true, files: true } },
        },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    const updatedSession = session.isActive
        ? await db.session.update({
            where: { id: sessionId },
            data: { isActive: false, completedAt: new Date(), lastActive: new Date() },
        })
        : session;

    return {
        sessionId,
        summary: {
            isActive: updatedSession.isActive,
            completedAt: updatedSession.completedAt,
            state: updatedSession.state,
        },
        nodesVisited: updatedSession.context?.flowRuntime?.nodesVisited || null,
        filesCreated: session._count.files,
        messagesCount: session._count.messages,
        apiCallsCount: session._count.apiCalls,
        slotsSet: Object.keys(updatedSession.context?.slots || {}).length,
    };
}

module.exports = {
    startTestSession,
    sendTestMessage,
    getTestSessionState,
    endTestSession,
};
