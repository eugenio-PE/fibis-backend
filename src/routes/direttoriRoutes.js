import express from 'express';
import { getMieGare } from '../controllers/direttoriController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// ROTTE DIRETTORI / ARBITRI
// ============================================================

// GET: Gare dove l'utente è arbitro o direttore
router.get(
  '/mie-gare',
  authenticate,
  requireRole(['direttore', 'arbitro', 'admin', 'settore_tecnico']),
  getMieGare
);

export default router;