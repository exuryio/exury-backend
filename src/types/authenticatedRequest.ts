import { type JwtPayload } from 'jsonwebtoken';
import { type Request } from 'express';

export interface DecodedToken extends JwtPayload {
  userId: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: DecodedToken;
}