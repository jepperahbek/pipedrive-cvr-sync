import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

/** Identity extracted from a verified Pipedrive iframe JWT. */
export interface PipedriveIdentity {
  userId: number | null;
  companyId: number | null;
  raw: jwt.JwtPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      pipedrive?: PipedriveIdentity;
    }
  }
}

export interface VerifyJwtOptions {
  /** App client secret used to verify the HS256 signature. */
  secret: string;
  /** If set, the token's company id must equal this (single-tenant guard). */
  expectedCompanyId?: number;
}

/**
 * Pull a numeric claim from any of several candidate names. The exact claim
 * names in Pipedrive's getSignedToken() payload should be confirmed against a
 * real token during integration; we read the documented user/company ids
 * defensively so a naming variant does not silently break the company guard.
 */
function pickNumber(payload: jwt.JwtPayload, keys: string[]): number | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  }
  return null;
}

function extractIdentity(payload: jwt.JwtPayload): PipedriveIdentity {
  return {
    userId: pickNumber(payload, ['userId', 'user_id', 'uid', 'sub']),
    companyId: pickNumber(payload, ['companyId', 'company_id', 'cid']),
    raw: payload,
  };
}

/**
 * Express middleware that verifies the Pipedrive iframe JWT supplied as
 * `Authorization: Bearer <jwt>`. Rejects missing/invalid/expired tokens with
 * 401, and tokens from a different company (when expectedCompanyId is set) with
 * 403. On success it attaches `req.pipedrive`.
 */
export function verifyPipedriveJwt(opts: VerifyJwtOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? req.header('Authorization');
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: 'unauthorized', message: 'Manglende eller ugyldig autorisation.' });
      return;
    }

    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(match[1], opts.secret, { algorithms: ['HS256'] });
      if (typeof decoded === 'string') throw new Error('unexpected string payload');
      payload = decoded;
    } catch {
      // covers bad signature, malformed token, and expiry (TokenExpiredError)
      res.status(401).json({ error: 'unauthorized', message: 'Sessionen er udløbet. Genindlæs panelet.' });
      return;
    }

    const identity = extractIdentity(payload);

    // Fail-closed company guard: if a company id is configured, the JWT must
    // carry a matching claim. Missing claims are treated as foreign tenants.
    if (
      opts.expectedCompanyId !== undefined &&
      identity.companyId !== opts.expectedCompanyId
    ) {
      res.status(403).json({ error: 'forbidden', message: 'Adgang nægtet for denne virksomhed.' });
      return;
    }

    req.pipedrive = identity;
    next();
  };
}
