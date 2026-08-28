// src/routes/notificationRoutes.js
import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
    saveDeviceToken,
    deleteDeviceToken,
    sendTestNotification
} from '../controllers/notificationController.js';

const router = express.Router();

// ============================================================
// ROTTE NOTIFICHE (TUTTE PROTETTE DA AUTENTICAZIONE)
// ============================================================

// Salva il token FCM del dispositivo
// POST /api/notifiche/device-token
router.post('/device-token', authenticate, saveDeviceToken);

// Elimina/disattiva il token FCM
// DELETE /api/notifiche/device-token
router.delete('/device-token', authenticate, deleteDeviceToken);

// Invia una notifica di test
// POST /api/notifiche/test
router.post('/test', authenticate, sendTestNotification);

export default router;