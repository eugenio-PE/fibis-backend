import express from 'express';
import {
  checkIn,
  getPresenzeTurno,
  getStatsGara
} from '../controllers/presenzeController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// ROTTE PRESENZE (CHECK-IN)
// ============================================================

// POST: Registra check-in di un tesserato
router.post(
  '/check-in',
  authenticate,
  requireRole(['admin', 'settore_tecnico', 'direttore', 'arbitro']),
  checkIn
);

// GET: Lista presenze di un turno
router.get(
  '/turno/:idGara/:turno',
  authenticate,
  requireRole(['admin', 'settore_tecnico']),
  getPresenzeTurno
);

// GET: Statistiche check-in di una gara
router.get(
  '/stats/:idGara',
  authenticate,
  requireRole(['admin', 'settore_tecnico']),
  getStatsGara
);

export default router;