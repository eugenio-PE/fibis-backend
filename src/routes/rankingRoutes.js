import express from 'express';
import {
    getRankingAtleta,
    getTopRanking,
    getTrendAtleta
} from '../controllers/rankingController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Rotta per ottenere il ranking di un atleta (con storico)
router.get('/atleta/:id_tesserato', authenticate, requireRole(['admin', 'settore_tecnico', 'presidente', 'tesserato']), getRankingAtleta);
router.get('/top', authenticate, requireRole(['admin', 'settore_tecnico', 'presidente', 'tesserato']), getTopRanking);
router.get('/trend/:id_tesserato', authenticate, requireRole(['admin', 'settore_tecnico', 'presidente', 'tesserato']), getTrendAtleta);

export default router;