import express from 'express';
import {
    getRankingAtleta,
    getTopRanking,
    getTrendAtleta
} from '../controllers/rankingController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Rotta per ottenere il ranking di un atleta (con storico)
router.get('/atleta/:id_tesserato', authenticate, getRankingAtleta);

// Rotta per ottenere la top list
router.get('/top', authenticate, getTopRanking);

// Rotta per ottenere il trend di un atleta
router.get('/trend/:id_tesserato', authenticate, getTrendAtleta);

export default router;