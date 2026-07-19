import express from 'express';
import { login, setupOTP, verifyOTPCode, getMe, verificaOTP } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Rotte pubbliche
router.post('/login', login);

// Rotte protette (richiedono autenticazione)
router.post('/setup-otp', authenticate, setupOTP);
router.post('/verify-otp', authenticate, verifyOTPCode);
router.get('/me', authenticate, getMe);

// Verifica OTP (pubblica per test)
router.post('/verifica-otp', verificaOTP);

export default router;