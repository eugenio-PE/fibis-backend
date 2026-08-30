import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// ✅ CARICA LE VARIABILI D'AMBIENTE SUBITO
dotenv.config();

// ✅ POI IMPORTI TUTTO IL RESTO
import authRoutes from './src/routes/authRoutes.js';
import interventoRoutes from './src/routes/interventoRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import { supabase } from './src/config/supabase.js';
import gareRoutes from './src/routes/gareRoutes.js';
import tesseratiRoutes from './src/routes/tesseratiRoutes.js';
import rankingRoutes from './src/routes/rankingRoutes.js';
import credenzialiRoutes from './src/routes/credenzialiRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
// ✅ AVVIA IL CRON JOB ALL'AVVIO DEL SERVER
import './src/workers/cron.js';
import comunicatiRoutes from './src/routes/comunicatiRoutes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configurato correttamente
app.use(cors({
  origin: [
    'https://fibis-admin.vercel.app',
    'https://fibis-admin-7f3a3zjdm-fibis.vercel.app',
    'https://fibismanutentori.vercel.app',
    'https://fibisdirettori.vercel.app',
    'https://fibispresidenti.vercel.app',
    'https://fibistesserati.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ROUTES - collegate correttamente
app.use('/api/auth', authRoutes);
app.use('/api', interventoRoutes);
app.use('/api', adminRoutes);
app.use('/api', gareRoutes);          // ← gareRoutes (contiene /gare, /gare-admin, /gare/:id, ecc.)
app.use('/api/tesserati', tesseratiRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/presidenti', credenzialiRoutes);
app.use('/api/notifiche', notificationRoutes);
app.use('/api/comunicati', comunicatiRoutes);

// Health check (sempre accessibile)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: '🚀 Server FIBiS funzionante!'
  });
});

// ROTTA DI FALLBACK per test (se le route non funzionano)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('📥 Tentativo login:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.log('❌ Errore login:', error.message);
      return res.status(401).json({ error: error.message });
    }

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        email: data.user.email,
        id: data.user.id
      }
    });
  } catch (error) {
    console.log('❌ Errore server:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:3000`);
  console.log(`📊 Health check: http://localhost:3000/api/health`);
});