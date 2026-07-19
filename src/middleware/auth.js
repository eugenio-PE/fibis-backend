import { supabase } from '../config/supabase.js';

export async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token non fornito' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token non valido' });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Autenticazione fallita' });
  }
}

export function requireRole(roles = []) {
  return async (req, res, next) => {
    try {
      const { data: manutentore, error } = await supabase
        .from('manutentori')
        .select('ruolo')
        .eq('user_id', req.userId)
        .single();

      if (error || !manutentore) {
        return res.status(403).json({ error: 'Utente non autorizzato' });
      }

      if (!roles.includes(manutentore.ruolo)) {
        return res.status(403).json({ error: 'Permessi insufficienti' });
      }

      next();
    } catch (error) {
      return res.status(500).json({ error: 'Errore di autorizzazione' });
    }
  };
}