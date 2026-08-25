import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { 
    salvaCredenziali, 
    getCredenziali 
} from '../controllers/credenzialiController.js';

const router = express.Router();

// 🔒 Rotte per le credenziali del portale - SOLO PER PRESIDENTI!
// La password è cifrata e MAI esposta in chiaro
router.post('/credenziali-portale', authenticate, requireRole(['presidente']), salvaCredenziali);
router.get('/credenziali-portale', authenticate, requireRole(['presidente']), getCredenziali);

export default router;