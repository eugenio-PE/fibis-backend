import express from 'express';
import {
    getTesserati,
    getTesseratoById,
    createTesserato,
    updateTesserato,
    deleteTesserato,
    importTesseratiFromCSV,
    addStecca,
    getStecche
} from '../controllers/tesseratiController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Rotta per ottenere la lista tesserati (GET)
router.get('/', authenticate, getTesserati);

// Rotta per ottenere un singolo tesserato (GET)
router.get('/:id', authenticate, getTesseratoById);

// Rotta per creare un nuovo tesserato (POST)
router.post('/', authenticate, requireRole(['admin', 'presidente']), createTesserato);

// Rotta per aggiornare un tesserato (PUT)
router.put('/:id', authenticate, requireRole(['admin', 'presidente']), updateTesserato);

// Rotta per eliminare un tesserato (DELETE)
router.delete('/:id', authenticate, requireRole(['admin']), deleteTesserato);

// Rotta per importazione massiva da CSV (POST)
router.post('/import-csv', authenticate, requireRole(['admin']), importTesseratiFromCSV);

// Rotta per aggiungere una stecca a un tesserato (POST)
router.post('/:id/stecca', authenticate, addStecca);

// Rotta per ottenere le stecche di un tesserato (GET)
router.get('/:id/stecca', authenticate, getStecche);

export default router;