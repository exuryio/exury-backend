/**
 * API Routes
 */
import { Router } from 'express';
import { quoteController } from '../controllers/quote.controller';
import { orderController } from '../controllers/order.controller';
import { paydoController } from '../controllers/paydo.controller';
import { balanceController } from '../controllers/balance.controller';
import { authController } from '../controllers/auth.controller';
import { bankAccountController } from '../controllers/bank-account.controller';
import { userWalletController } from '../controllers/user-wallet.controller';
import { depositWalletsController } from '../controllers/deposit-wallets.controller';

const router = Router();

// Auth routes (públicas)
router.post('/auth/register', (req, res) => authController.register(req, res));
router.post('/auth/login', (req, res) => authController.loginWithEmail(req, res));
router.post('/auth/verify-email', (req, res) => authController.verifyEmail(req, res));
router.post('/auth/resend-code', (req, res) => authController.resendCode(req, res));
router.post('/auth/auth0/callback', (req, res) => authController.handleAuth0Callback(req, res));
router.post('/auth/logout', (req, res) => authController.logout(req, res));

// Quote routes (públicas: el simulador muestra precios antes de crear cuenta)
router.get('/quotes', (req, res) => quoteController.getQuote(req, res));
router.post('/quotes/:id/lock', (req, res) =>
  quoteController.lockQuote(req, res)
);

// Order routes
router.post('/orders', (req, res) => orderController.createOrder(req, res));
router.get('/orders', (req, res) => orderController.getUserOrders(req, res));
// Rutas tipadas: el front llama /orders/sell/:id o /orders/buy/:id para dejar el
// tipo visible en Network/logs sin tener que abrir la respuesta.
// Internamente el controller valida que la orden coincida con el tipo de la URL.
router.get('/orders/sell/:id', (req, res) =>
  orderController.getOrder(req, res, 'sell')
);
router.get('/orders/buy/:id', (req, res) =>
  orderController.getOrder(req, res, 'buy')
);
// Ruta genérica (compat hacia atrás): no filtra por tipo.
router.get('/orders/:id', (req, res) => orderController.getOrder(req, res));
router.post('/orders/:id/sell/payout', (req, res) =>
  orderController.initiateSellPayout(req, res)
);

// PayDo webhook (no requiere JWT: PayDo llama sin sesión; validación por firma/IP a futuro)
router.post('/payments/paydo/webhook', (req, res) =>
  paydoController.handleWebhook(req, res)
);

// Balance routes
router.get('/users/me/balances', (req, res) =>
  balanceController.getBalances(req, res)
);
router.get('/users/me/balances/:asset', (req, res) =>
  balanceController.getBalance(req, res)
);

// Bank accounts del usuario (sell flow). El IBAN no se devuelve nunca: sólo el hash vive en DB.
router.get('/users/me/bank-accounts', (req, res) =>
  bankAccountController.list(req, res)
);
router.post('/users/me/bank-accounts', (req, res) =>
  bankAccountController.create(req, res)
);
router.delete('/users/me/bank-accounts/:id', (req, res) =>
  bankAccountController.remove(req, res)
);

// Wallets del usuario (buy: destino / sell: origen declarado).
router.get('/users/me/wallets', (req, res) =>
  userWalletController.list(req, res)
);
router.post('/users/me/wallets', (req, res) =>
  userWalletController.create(req, res)
);
router.delete('/users/me/wallets/:id', (req, res) =>
  userWalletController.remove(req, res)
);

// Deposit wallets de Exury (públicas, sirven la info desde env var EXURY_DEPOSIT_WALLETS_JSON).
router.get('/deposit-wallets', (req, res) =>
  depositWalletsController.getDepositWallets(req, res)
);

export default router;
