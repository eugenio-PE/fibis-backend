import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Carica le variabili d'ambiente
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Client per operazioni amministrative (bypassa RLS)
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey
);

// Client per operazioni pubbliche (usa RLS)
export const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey
);

console.log('✅ Supabase configurato correttamente');