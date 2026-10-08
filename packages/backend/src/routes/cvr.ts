import { Router } from 'express';
import { z } from 'zod';
import { getCvrProvider } from '../cvr/index.ts';

export const cvrRouter = Router();

const cvrParamSchema = z.object({
  cvrnr: z
    .string()
    .regex(/^\d{8}$/, 'CVR-nummer skal være præcis 8 cifre'),
});

cvrRouter.get('/cvr/:cvrnr', async (req, res) => {
  const parsed = cvrParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_cvr',
      message: parsed.error.issues[0]?.message ?? 'Ugyldigt CVR-nummer',
    });
  }

  try {
    const result = await getCvrProvider().lookup(parsed.data.cvrnr);
    return res.json(result);
  } catch (err) {
    // Surface a structured error the panel can render in Danish.
    return res.status(502).json({
      error: 'cvr_lookup_failed',
      message: 'Kunne ikke hente CVR-data lige nu. Prøv igen om lidt.',
    });
  }
});
