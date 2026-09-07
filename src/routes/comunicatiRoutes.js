// src/routes/comunicatiRoutes.js
import express from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ✅ MAPPA RUOLI (singolare → plurale)
const ruoliMappa = {
    'tesserato': 'tesserati',
    'presidente': 'presidenti',
    'direttore': 'direttori',
    'manutentore': 'manutentori',
};

// ============================================================
// 0. API PER I DROPDOWN (NUOVE)
// ============================================================

// GET /regioni - Ottieni tutte le regioni uniche da asd_centri
router.get('/regioni', authenticate, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('asd_centri')
            .select('regione')
            .not('regione', 'is', null)
            .neq('regione', '')
            .order('regione');

        if (error) throw error;

        // Estrai valori unici
        const regioniUniche = [...new Set(data.map(t => t.regione))].sort();
        const result = regioniUniche.map(regione => ({
            id: regione,
            nome: regione,
            sigla: regione.substring(0, 2).toUpperCase()
        }));

        res.json({ success: true, regioni: result });
    } catch (error) {
        console.error('❌ Errore recupero regioni:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /province/:regione - Ottieni province per regione
router.get('/province/:regione', authenticate, async (req, res) => {
    try {
        const { regione } = req.params;

        const { data, error } = await supabaseAdmin
            .from('asd_centri')
            .select('provincia')
            .eq('regione', regione)
            .not('provincia', 'is', null)
            .neq('provincia', '')
            .order('provincia');

        if (error) throw error;

        const provinceUniche = [...new Set(data.map(t => t.provincia))].sort();
        const result = provinceUniche.map(provincia => ({
            id: provincia,
            nome: provincia,
            sigla: provincia.substring(0, 2).toUpperCase()
        }));

        res.json({ success: true, province: result });
    } catch (error) {
        console.error('❌ Errore recupero province:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /asd - Ottieni tutte le ASD
// NOTA: /asd esiste già in interventoRoutes.js, ma la mettiamo per completezza
router.get('/asd', authenticate, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('asd_centri')
            .select('id, nome, regione, provincia')
            .order('nome');

        if (error) throw error;
        res.json({ success: true, asd: data });
    } catch (error) {
        console.error('❌ Errore recupero ASD:', error);
        res.status(500).json({ error: error.message });
    }
});
// ============================================================
// 1. CREA UN NUOVO COMUNICATO (ADMIN O PRESIDENTE)
// ============================================================
router.post('/', authenticate, async (req, res) => {
    try {
        const { titolo, contenuto, destinatari, priorita, data_scadenza, tipo, link, filtro_regione, filtro_provincia, filtro_asd_id } = req.body;
        const userId = req.user.id;

        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('id, ruolo, asd_id')
            .eq('user_id', userId)
            .single();

        if (userError || !user) {
            return res.status(403).json({ error: 'Non autorizzato' });
        }

        const isAdmin = user.ruolo === 'admin';
        const isPresidente = user.ruolo === 'presidente';

        if (!isAdmin && !isPresidente) {
            return res.status(403).json({ error: 'Permessi insufficienti' });
        }

        // 🔐 SE È PRESIDENTE → FORZA i filtri sulla sua ASD
        let filtroRegioneFinale = filtro_regione || null;
        let filtroProvinciaFinale = filtro_provincia || null;
        let filtroAsdFinale = filtro_asd_id || null;
        let destinatariFinali = destinatari;

        if (isPresidente) {
            if (!user.asd_id) {
                return res.status(400).json({ error: 'Presidente senza ASD associata' });
            }
            // Forza il filtro ASD
            filtroAsdFinale = user.asd_id;
            // Forza destinatari: solo tesserati
            destinatariFinali = ['tesserati'];
            // Ignora filtri geografici
            filtroRegioneFinale = null;
            filtroProvinciaFinale = null;
            console.log(`🔐 Presidente ASD ${user.asd_id}: comunicato limitato ai suoi tesserati`);
        }

        // ✅ SCADENZA AUTOMATICA per dirette YouTube (1 ora)
        let scadenzaFinale = data_scadenza || null;
        if (tipo === 'diretta_youtube' && !scadenzaFinale) {
            const dataScadenza = new Date(Date.now() + 60 * 60 * 1000); // 1 ora
            scadenzaFinale = dataScadenza.toISOString();
            console.log(`⏰ Scadenza automatica per diretta YouTube: ${scadenzaFinale}`);
        }

        const { data, error } = await supabaseAdmin
            .from('comunicati')
            .insert({
                titolo,
                contenuto,
                destinatari: destinatariFinali,
                priorita: priorita || 'normale',
                data_scadenza: scadenzaFinale,
                pubblicato: true,
                creato_da: user.id,
                created_at: new Date().toISOString(),
                tipo: tipo || 'comunicato',
                link: link || null,
                filtro_regione: filtroRegioneFinale,
                filtro_provincia: filtroProvinciaFinale,
                filtro_asd_id: filtroAsdFinale
            })
            .select()
            .single();

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // ✅ INVIA NOTIFICHE PUSH AI DESTINATARI
        try {
            console.log(`📨 Invio notifiche push per comunicato ${data.id}: "${data.titolo}"`);

            const { data: tokens, error: tokenError } = await supabaseAdmin
                .from('device_tokens')
                .select('fcm_token')
                .eq('is_active', true);

            if (tokenError) {
                console.error('❌ Errore recupero token FCM:', tokenError);
            } else if (tokens && tokens.length > 0) {
                const tokenList = tokens.map(t => t.fcm_token);
                console.log(`📱 Token FCM trovati: ${tokenList.length}`);

                const { sendPushNotificationMultiple } = await import('../services/firebaseService.js');

                await sendPushNotificationMultiple(
                    tokenList,
                    data.titolo,
                    data.contenuto?.substring(0, 100) || 'Nuovo comunicato disponibile',
                    {
                        tipo: 'comunicato',
                        comunicato_id: String(data.id),
                        click_action: 'FLUTTER_NOTIFICATION_CLICK',
                    }
                );
                console.log(`✅ Notifiche push inviate per comunicato ${data.id}`);
            } else {
                console.log('ℹ️ Nessun token FCM attivo trovato');
            }
        } catch (pushError) {
            console.error('❌ Errore invio notifiche push:', pushError);
        }

        res.status(201).json({ success: true, comunicato: data });

    } catch (error) {
        console.error('❌ Errore creazione comunicato:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 2. ELIMINA UN COMUNICATO (SOLO ADMIN)
// ============================================================
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const comunicatoId = parseInt(req.params.id);

        // Verifica che sia admin
        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo')
            .eq('user_id', userId)
            .single();

        if (userError || user?.ruolo !== 'admin') {
            return res.status(403).json({ error: 'Non autorizzato' });
        }

        // Elimina il comunicato
        const { error } = await supabaseAdmin
            .from('comunicati')
            .delete()
            .eq('id', comunicatoId);

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({ success: true, message: 'Comunicato eliminato' });

    } catch (error) {
        console.error('❌ Errore eliminazione comunicato:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 3. OTTIENI I COMUNICATI PER UN UTENTE (CON FILTRI - OTTIMIZZATO)
// ============================================================
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Recupera il ruolo e asd_id dell'utente
        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo, asd_id')
            .eq('user_id', userId)
            .maybeSingle();

        if (userError) {
            return res.status(400).json({ error: userError.message });
        }

        const ruolo = user?.ruolo || 'tesserato';
        const isAdmin = ruolo === 'admin';

        // 2. Recupera i dati dell'utente UNA SOLA VOLTA (per i filtri)
        let userData = null;

        if (ruolo === 'tesserato') {
            // Per i tesserati → prendi da tesserati
            const { data, error } = await supabaseAdmin
                .from('tesserati')
                .select('regione, provincia, asd_id')
                .eq('id', userId)
                .maybeSingle();

            if (!error && data) {
                userData = data;
            }
        } else {
            // Per manutentori, direttori, presidenti → prendi da asd_centri tramite asd_id
            if (user?.asd_id) {
                const { data, error } = await supabaseAdmin
                    .from('asd_centri')
                    .select('regione, provincia')
                    .eq('id', user.asd_id)
                    .maybeSingle();

                if (!error && data) {
                    userData = {
                        regione: data.regione,
                        provincia: data.provincia,
                        asd_id: user.asd_id
                    };
                }
            }
        }

        // 3. Recupera i comunicati
        let comunicatiBase;

        if (isAdmin) {
            // Admin → tutti i comunicati
            const { data, error } = await supabaseAdmin
                .from('comunicati')
                .select('*')
                .eq('pubblicato', true)
                .order('data_pubblicazione', { ascending: false });

            if (error) {
                return res.status(400).json({ error: error.message });
            }
            comunicatiBase = data;
        } else {
            // Altri ruoli → usa RPC
            const ruoloNormalizzato = ruoliMappa[ruolo] || ruolo;
            console.log(`🔍 Ruolo: ${ruolo} → normalizzato: ${ruoloNormalizzato}`);

            const { data, error } = await supabaseAdmin
                .rpc('get_comunicati_per_ruolo', { ruolo_input: ruoloNormalizzato });

            if (error) {
                console.error('❌ Errore RPC:', error);
                return res.status(400).json({ error: error.message });
            }
            comunicatiBase = data;
        }

        // 4. Applica filtri geografici (in memoria)
        const comunicatiFiltrati = comunicatiBase.filter(comunicato => {
            // Se non ha filtri, è visibile a tutti
            if (!comunicato.filtro_regione && 
                !comunicato.filtro_provincia && 
                !comunicato.filtro_asd_id) {
                return true;
            }

            // Se ha filtri ma non abbiamo dati utente, escludi
            if (!userData) return false;

            // Verifica regione
            if (comunicato.filtro_regione && 
                userData.regione !== comunicato.filtro_regione) {
                return false;
            }

            // Verifica provincia
            if (comunicato.filtro_provincia && 
                userData.provincia !== comunicato.filtro_provincia) {
                return false;
            }

            // Verifica ASD
            if (comunicato.filtro_asd_id && 
                userData.asd_id !== comunicato.filtro_asd_id) {
                return false;
            }

            return true;
        });

        // 5. CONTA LE LETTURE PER OGNI COMUNICATO
        const comunicatiConConteggio = await Promise.all(comunicatiFiltrati.map(async (c) => {
            const { count, error } = await supabaseAdmin
                .from('comunicati_letti')
                .select('*', { count: 'exact', head: true })
                .eq('comunicato_id', c.id);

            if (error) {
                console.error('❌ Errore conteggio letture:', error);
                return { ...c, letti_count: 0 };
            }

            return { ...c, letti_count: count || 0 };
        }));

        // 6. Recupera i comunicati già letti da questo utente
        const { data: letti, error: lettiError } = await supabaseAdmin
            .from('comunicati_letti')
            .select('comunicato_id')
            .eq('user_id', userId);

        if (lettiError) {
            return res.status(400).json({ error: lettiError.message });
        }

        const lettiIds = letti.map(l => l.comunicato_id);
        const comunicatiConLetto = comunicatiConConteggio.map(c => ({
            ...c,
            letto: lettiIds.includes(c.id)
        }));

        res.json({ success: true, comunicati: comunicatiConLetto });

    } catch (error) {
        console.error('❌ Errore recupero comunicati:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 4. SEGNA UN COMUNICATO COME LETTO
// ============================================================
router.post('/:id/lettura', authenticate, async (req, res) => {
    try {
        const comunicatoId = parseInt(req.params.id);
        const userId = req.user.id;

        const { data: comunicato, error: checkError } = await supabaseAdmin
            .from('comunicati')
            .select('id')
            .eq('id', comunicatoId)
            .single();

        if (checkError || !comunicato) {
            return res.status(404).json({ error: 'Comunicato non trovato' });
        }

        const { error } = await supabaseAdmin
            .from('comunicati_letti')
            .insert({
                comunicato_id: comunicatoId,
                user_id: userId,
                letto_il: new Date().toISOString()
            });

        if (error) {
            if (error.code !== '23505') {
                return res.status(400).json({ error: error.message });
            }
        }

        res.json({ success: true, message: 'Comunicato segnato come letto' });

    } catch (error) {
        console.error('❌ Errore segnatura lettura:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// ============================================================
// 5. OTTIENI IL NUMERO DI COMUNICATI NON LETTI (USA RPC)
// ============================================================
router.get('/non-letti', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: user, error: userError } = await supabaseAdmin
            .from('manutentori')
            .select('ruolo, asd_id')
            .eq('user_id', userId)
            .maybeSingle();

        if (userError) {
            return res.status(400).json({ error: userError.message });
        }

        const ruolo = user?.ruolo || 'tesserato';
        const ruoloNormalizzato = ruoliMappa[ruolo] || ruolo;

        // ✅ USA RPC PER IL FILTRO
        const { data: comunicati, error } = await supabaseAdmin
            .rpc('get_comunicati_per_ruolo', { ruolo_input: ruoloNormalizzato });

        if (error) {
            console.error('❌ Errore RPC (non-letti):', error);
            return res.status(400).json({ error: error.message });
        }

        const comunicatiIds = comunicati.map(c => c.id);

        if (comunicatiIds.length === 0) {
            return res.json({ success: true, nonLetti: 0 });
        }

        const { data: letti, error: lettiError } = await supabaseAdmin
            .from('comunicati_letti')
            .select('comunicato_id')
            .eq('user_id', userId)
            .in('comunicato_id', comunicatiIds);

        if (lettiError) {
            return res.status(400).json({ error: lettiError.message });
        }

        const lettiIds = letti.map(l => l.comunicato_id);
        const nonLetti = comunicatiIds.filter(id => !lettiIds.includes(id)).length;

        res.json({ success: true, nonLetti });

    } catch (error) {
        console.error('❌ Errore conteggio non letti:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

export default router;