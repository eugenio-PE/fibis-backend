import { supabase, supabaseAdmin } from '../config/supabase.js';

export async function authenticate(req, res, next) {
  try {
    console.log('🔵 [1] authenticate - INIZIO');

    let token = req.headers.authorization?.split(' ')[1];
    console.log('🔵 [2] Token ricevuto:', token ? `SI (prime 20 caratteri: ${token.substring(0, 20)}...)` : 'NO');

    if (!token) {
      console.log('❌ [3] Token non fornito');
      return res.status(401).json({ error: 'Token non fornito' });
    }

    // 🔧 PULISCI IL TOKEN: rimuovi virgolette, spazi e caratteri extra
    token = token.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    console.log('🔵 [2b] Token pulito:', token ? `SI (prime 20 caratteri: ${token.substring(0, 20)}...)` : 'NO');

    console.log('🔵 [4] Verifica token con Supabase...');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error('❌ [5] Errore verifica token Supabase:', error.message);
      return res.status(401).json({ error: 'Token non valido' });
    }

    if (!user) {
      console.log('❌ [6] Utente non trovato');
      return res.status(401).json({ error: 'Token non valido' });
    }

    console.log('🔵 [7] Utente trovato:', user.email, '(ID:', user.id, ')');

    req.user = user;
    req.userId = user.id;
    console.log('🔵 [8] req.userId impostato a:', req.userId);

    console.log('✅ [9] authenticate - COMPLETATO');
    next();
  } catch (error) {
    console.error('❌ [10] Errore authenticate:', error.message);
    return res.status(401).json({ error: 'Autenticazione fallita' });
  }
}

export function requireRole(roles = []) {
  return async (req, res, next) => {
    try {
      console.log('🔵 [11] requireRole - INIZIO, ruoli richiesti:', roles);
      console.log('🔵 [12] req.userId:', req.userId);

      const { data: manutentore, error } = await supabaseAdmin
        .from('manutentori')
        .select('ruolo')
        .eq('user_id', req.userId)
        .maybeSingle();

      if (error) {
        console.error('❌ [13] Errore query manutentori:', error.message);
        return res.status(403).json({ error: 'Utente non autorizzato' });
      }

      if (!manutentore) {
        console.log('❌ [14] Manutentore non trovato per user_id:', req.userId);
        return res.status(403).json({ error: 'Utente non autorizzato' });
      }

      console.log('🔵 [15] Ruolo trovato:', manutentore.ruolo);

      if (!roles.includes(manutentore.ruolo)) {
        console.log('❌ [16] Ruolo non autorizzato:', manutentore.ruolo, 'non in', roles);
        return res.status(403).json({ error: 'Permessi insufficienti' });
      }

      console.log('✅ [17] requireRole - COMPLETATO');
      next();
    } catch (error) {
      console.error('❌ [18] Errore requireRole:', error.message);
      return res.status(500).json({ error: 'Errore di autorizzazione' });
    }
  };
}