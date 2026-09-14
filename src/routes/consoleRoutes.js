import express from 'express';
import {
  getGare,
  getGiorni,
  getTurni,
  getDettaglioTurno,
  getArbitriDisponibili,
  getArbitriGara,
  assegnaArbitriGara,
  rimuoviArbitroGara
} from '../controllers/consoleController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Ruoli autorizzati alla console
const CONSOLE_ROLES = ['admin', 'settore_tecnico'];

// ============================================================
// ROTTE CONSOLE
// ============================================================

// GET: Lista gare (filtrabile per ?tipologia=libera)
router.get(
  '/gare',
  authenticate,
  requireRole(CONSOLE_ROLES),
  getGare
);

// GET: Giorni di una gara (solo qualificazione)
router.get(
  '/giorni/:idGara',
  authenticate,
  requireRole(CONSOLE_ROLES),
  getGiorni
);

// GET: Turni di una gara in un giorno
router.get(
  '/turni/:idGara/:giorno',
  authenticate,
  requireRole(CONSOLE_ROLES),
  getTurni
);

// GET: Dettaglio turno (iscritti + check-in)
router.get(
  '/turno/:idGara/:turno',
  authenticate,
  requireRole(CONSOLE_ROLES),
  getDettaglioTurno
);
// ============================================================
// ROTTE ARBITRI
// ============================================================

// GET: Arbitri disponibili (ruolo = 'arbitro')
router.get(
  '/arbitri-disponibili',
  authenticate,
  requireRole(CONSOLE_ROLES),
  getArbitriDisponibili
);

// GET: Arbitri assegnati a una gara
router.get(
  '/arbitri-gara/:idGara',
  authenticate,
  requireRole(CONSOLE_ROLES),
  getArbitriGara
);

// POST: Assegna arbitri a una gara
router.post(
  '/arbitri-gara/:idGara',
  authenticate,
  requireRole(CONSOLE_ROLES),
  assegnaArbitriGara
);

// DELETE: Rimuovi arbitro da una gara
router.delete(
  '/arbitri-gara/:idGara/:idManutentore',
  authenticate,
  requireRole(CONSOLE_ROLES),
  rimuoviArbitroGara
);

export default router;