'use strict';

const { z } = require('zod');
const { ValidationError } = require('@platform/errors');

/**
 * Validate req.params, req.query, or req.body against a zod schema.
 * Usage: router.get('/:id', validateParams({ params: z.object({ id: z.string().uuid() }) }), handler)
 */
function validateParams(schemas) {
    return (req, res, next) => {
        try {
            if (schemas.params) {
                req.params = schemas.params.parse(req.params);
            }
            if (schemas.query) {
                req.query = schemas.query.parse(req.query);
            }
            if (schemas.body) {
                req.body = schemas.body.parse(req.body);
            }
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new ValidationError('Validation failed', { issues: error.issues });
            }
            throw error;
        }
    };
}

module.exports = { validateParams };
