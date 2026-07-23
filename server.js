import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './src/routes/authRoutes.js';
import interventoRoutes from './src/routes/interventoRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import { supabase } from './src/config/supabase.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configurato correttamente
app.use(cors({
  origin: [
    'https://fibis-admin.vercel.app',
    'https://fibismanutentori.vercel.app',     // ← underscores!
    'https://fibisdirettori.vercel.app',      // ← underscores!
    'https://fibispresidenti.vercel.app',     // ← underscores!
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