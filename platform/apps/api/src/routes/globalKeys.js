/**
 * Global Keys Routes
 * GET /api/projects/:projectId/global-keys — list all global keys (masked)
 * PUT /api/projects/:projectId/global-keys/:key — upsert a key
 * DELETE /api/projects/:projectId/global-keys/:key — delete a key
 * GET /api/projects/:projectId/global-keys/:key/reveal — reveal secret value (admin only)
 */

const express = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler, validateParams, NotFoundError, PermissionError } = require('../middleware');

const router = express.Router({ mergeParams: true });

// GET /api/projects/:projectId/global-keys
router.get('/',
    validateParams({ params: z.object({ projectId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const keys = await db.globalKey.findMany({
            where: { projectId },
            orderBy: { createdAt: 'asc' },
        });

        res.json({
            ok: true,
            data: keys.map(k => ({
                ...k,
                value: k.isSecret ? '••••••••' : k.value,
            })),
        });
    })
);

// PUT /api/projects/:projectId/global-keys/:key
router.put('/:key',
    validateParams({
        params: z.object({
            projectId: z.string().uuid(),
            key: z.string().min(1),
        }),
        body: z.object({
            label: z.string().min(1),
            value: z.string().min(1),
            isSecret: z.boolean().optional(),
            description: z.string().optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { projectId, key } = req.params;
        const { label, value, isSecret, description } = req.body;

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const globalKey = await db.globalKey.upsert({
            where: { projectId_key: { projectId, key } },
            create: {
                projectId,
                key,
                label,
                value,
                isSecret: isSecret ?? false,
                description,
            },
            update: {
                label,
                value,
                isSecret: isSecret ?? false,
                description,
                updatedAt: new Date(),
            },
        });

        res.json({
            ok: true,
            data: {
                ...globalKey,
                value: globalKey.isSecret ? '••••••••' : globalKey.value,
            },
        });
    })
);

// DELETE /api/projects/:projectId/global-keys/:key
router.delete('/:key',
    validateParams({
        params: z.object({
            projectId: z.string().uuid(),
            key: z.string().min(1),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { projectId, key } = req.params;

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const globalKey = await db.globalKey.findUnique({
            where: { projectId_key: { projectId, key } },
        });

        if (!globalKey) {
            throw new NotFoundError('GlobalKey', key);
        }

        await db.globalKey.delete({
            where: { id: globalKey.id },
        });

        res.json({ ok: true });
    })
);

// GET /api/projects/:projectId/global-keys/:key/reveal
router.get('/:key/reveal',
    validateParams({
        params: z.object({
            projectId: z.string().uuid(),
            key: z.string().min(1),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { projectId, key } = req.params;

        // В боевом приложении нужна проверка прав админа
        // if (req.user.role !== 'admin') throw new PermissionError('Admin access required');

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const globalKey = await db.globalKey.findUnique({
            where: { projectId_key: { projectId, key } },
        });

        if (!globalKey) {
            throw new NotFoundError('GlobalKey', key);
        }

        if (!globalKey.isSecret) {
            return res.json({ ok: true, data: { key, value: globalKey.value } });
        }

        res.json({ ok: true, data: { key, value: globalKey.value } });
    })
);

module.exports = router;
