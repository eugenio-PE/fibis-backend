import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;        // ← AGGIUNGI QUESTO
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Client per operazioni amministrative (bypassa RLS)
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Client per operazioni pubbliche (rispetta RLS)
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,  // ← CAMBIA QUI! Usa la Anon Key
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

console.log('✅ Supabase configurato correttamente');