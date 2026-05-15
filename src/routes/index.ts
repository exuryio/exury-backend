/**
 * API Routes
 */
import { Router, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { quoteController } from '../controllers/quote.controller';
import { orderController } from '../controllers/order.controller';
import { paydoController } from '../controllers/paydo.controller';
import { balanceController } from '../controllers/balance.controller';
import { authController } from '../controllers/auth.controller';
import { kycController } from '../controllers/kyc.controller';
import { AuthenticatedRequest, DecodedToken } from '../types/authenticatedRequest';

const router = Router();

const decodeTokenMiddleware = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.split(' ')[1];

  if (!bearerToken) {
    return next();
  }

  const decodedToken = jwt.decode(bearerToken);
  if (!decodedToken || typeof decodedToken === 'string') {
    return next();
  }

  req.user = decodedToken as DecodedToken;

  return next();
}

// Auth routes
router.post('/auth/register', (req, res) => authController.register(req, res));
router.post('/auth/login', (req, res) => authController.loginWithEmail(req, res));
router.post('/auth/verify-email', (req, res) => authController.verifyEmail(req, res));
router.post('/auth/resend-code', (req, res) => authController.resendCode(req, res));
router.post('/auth/auth0/callback', (req, res) => authController.handleAuth0Callback(req, res));
router.post('/auth/logout', (req, res) => authController.logout(req, res));

// Quote routes
router.get('/quotes', (req, res) => quoteController.getQuote(req, res));
router.post('/quotes/:id/lock', (req, res) =>
  quoteController.lockQuote(req, res)
);

// Order routes
router.post('/orders', decodeTokenMiddleware, (req, res) => orderController.createOrder(req, res));
router.get('/orders', decodeTokenMiddleware, (req, res) => orderController.getUserOrders(req, res));
router.get('/orders/:id', decodeTokenMiddleware, (req, res) => orderController.getOrder(req, res));

// PayDo webhook
router.post('/payments/paydo/webhook', (req, res) =>
  paydoController.handleWebhook(req, res)
);

// Balance routes
router.get('/users/me/balances', decodeTokenMiddleware, (req, res) =>
  balanceController.getBalances(req, res)
);
router.get('/users/me/balances/:asset', decodeTokenMiddleware, (req, res) =>
  balanceController.getBalance(req, res)
);

// KYC routes
router.get('/users/me/kyc-status', decodeTokenMiddleware, (req, res) => kycController.checkKYCStatus(req, res));

export default router;

