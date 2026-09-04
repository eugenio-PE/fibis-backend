import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// GET /api/gare
// Lista tutte le gare (con filtri opzionali)
// ============================================================
export const getGare = async (req, res) => {
    try {
        const { disciplina, tipologia, regione, categoria, aperte } = req.query;
        
        let query = supabaseAdmin
            .from('gare')
            .select('*');

        // Filtra per disciplina (se fornita)
        if (disciplina) {
            query = query.eq('tipologia', disciplina);
        }

        // Filtra per tipologia (se fornita)
        if (tipologia) {
            query = query.eq('tipologia', tipologia);
        }

        // Filtra per regione (se fornita)
        if (regione) {
            query = query.eq('regione', regione);
        }

        // Filtra per categoria (se fornita)
        if (categoria) {
            query = query.eq('categoria', categoria);
        }

        // Filtra solo gare con iscrizioni aperte
        if (aperte === 'true') {
            const oggi = new Date().toISOString().split('T')[0];
            query = query
                .gte('data_fine_iscrizioni', oggi)
                .lte('data_inizio_iscrizioni', oggi);
        }

        // Ordina per data
        const { data, error } = await query
            .order('data_gara', { ascending: true });

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error('❌ Errore getGare:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// GET /api/gare/:id
// Dettaglio di una singola gara
// ============================================================
export const getGaraById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('gare')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Gara non trovata' });
        }

        res.json(data);
    } catch (error) {
        console.error('❌ Errore getGaraById:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// POST /api/gare
// Crea una nuova gara (solo admin)
// ============================================================
export const createGara = async (req, res) => {
    try {
        const {
            nome,
            data_gara,
            tipologia,
            categoria,
            regione,
            luogo,
            data_inizio_iscrizioni,
            data_fine_iscrizioni,
            note,
        } = req.body;

        // Validazione base
        if (!nome || !data_gara) {
            return res.status(400).json({ error: 'Nome e data sono obbligatori' });
        }

        const { data, error } = await supabaseAdmin
            .from('gare')
            .insert({
                nome,
                data_gara,
                tipologia,
                categoria,
                regione,
                note: luogo ? `Luogo: ${luogo}` : note,
                data_inizio_iscrizioni,
                data_fine_iscrizioni,
                stato: 'programmata',
                inserito_il: new Date().toISOString(),
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: 'Gara creata con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore createGara:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// POST /api/gare/:id/iscriviti
// Iscrizione automatica di un tesserato a una gara
// ============================================================
export const iscrivitiGara = async (req, res) => {
    try {
        const { id } = req.params;
        const { id_tesserato, giorno_iscrizione } = req.body;
        const userId = req.userId;

        console.log(`📝 Iscrizione richiesta: gara=${id}, tesserato=${id_tesserato}, giorno=${giorno_iscrizione}`);

        // ✅ CONVERTI IN NUMERO PRIMA DI USARE
        const idGaraNum = parseInt(id, 10);
        const idTesseratoNum = parseInt(id_tesserato, 10);

        if (isNaN(idGaraNum) || isNaN(idTesseratoNum)) {
            return res.status(400).json({ error: 'ID gara o tesserato non validi' });
        }

        // 1. Verifica che l'utente sia autenticato e sia un tesserato
        const { data: tesserato, error: tesseratoError } = await supabaseAdmin
            .from('tesserati')
            .select('id, nome, cognome, user_id')
            .eq('id', idTesseratoNum)
            .eq('user_id', userId)
            .single();

        if (tesseratoError || !tesserato) {
            console.error('❌ Tesserato non trovato o non autorizzato:', tesseratoError);
            return res.status(403).json({ 
                error: 'Non autorizzato o tesserato non trovato' 
            });
        }

        console.log(`✅ Tesserato verificato: ${tesserato.nome} ${tesserato.cognome}`);

        // 2. Verifica che la gara esista e sia aperta
        const { data: gara, error: garaError } = await supabaseAdmin
            .from('gare')
            .select('*')
            .eq('id', idGaraNum)
            .single();

        if (garaError || !gara) {
            console.error('❌ Gara non trovata:', garaError);
            return res.status(404).json({ error: 'Gara non trovata' });
        }

        console.log(`✅ Gara verificata: ${gara.nome}`);

        // 3. Verifica che le iscrizioni siano aperte
        const oggi = new Date().toISOString().split('T')[0];
        if (!gara.data_inizio_iscrizioni || !gara.data_fine_iscrizioni) {
            return res.status(400).json({ error: 'Date iscrizioni non configurate' });
        }
        if (gara.data_inizio_iscrizioni > oggi || gara.data_fine_iscrizioni < oggi) {
            console.log(`⏳ Iscrizioni non aperte: inizio=${gara.data_inizio_iscrizioni}, fine=${gara.data_fine_iscrizioni}, oggi=${oggi}`);
            return res.status(400).json({ error: 'Iscrizioni non aperte per questa gara' });
        }

        console.log(`✅ Iscrizioni aperte: ${gara.data_inizio_iscrizioni} → ${gara.data_fine_iscrizioni}`);

        // 4. Verifica che il tesserato non sia già iscritto (CON I TIPI CORRETTI)
        console.log('🔍 Verifica iscrizione esistente...');
        const { data: existing, error: existingError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .select('id, stato')
            .eq('id_gara', idGaraNum)
            .eq('id_tesserato', idTesseratoNum)
            .maybeSingle();

        if (existingError) {
            console.error('❌ Errore verifica iscrizione esistente:', existingError);
            throw existingError;
        }

        console.log(`🔍 Iscrizione esistente: ${existing ? 'SI (stato=' + existing.stato + ')' : 'NO'}`);

        if (existing) {
            if (existing.stato === 'completata') {
                return res.status(400).json({ error: 'Tesserato già iscritto a questa gara' });
            }
            if (['in_attesa', 'in_corso', 'in_attesa_giorni', 'in_attesa_completamento'].includes(existing.stato)) {
                return res.status(400).json({ error: 'Iscrizione già in corso' });
            }
            // ✅ Se è fallita, possiamo riprovare
            if (existing.stato === 'fallita') {
                console.log(`🔄 Riavvio iscrizione fallita: ${existing.id}`);
                const { data: updated, error: updateError } = await supabaseAdmin
                    .from('iscrizioni_gare')
                    .update({ stato: 'in_attesa', ultimo_errore: null })
                    .eq('id', existing.id)
                    .select()
                    .single();
                
                if (updateError) {
                    console.error('❌ Errore riavvio iscrizione:', updateError);
                    throw updateError;
                }
                
                // ✅ AVVIA IL WORKER PER L'ISCRIZIONE RIAVVIATA (PASSANDO userId)
                try {
                    const { eseguiIscrizioneGara } = await import('../workers/iscrizioneWorker.js');
                    eseguiIscrizioneGara(existing.id, userId); // ✅ PASSA userId!
                    console.log(`✅ Worker avviato per iscrizione ${existing.id} (riavvio) con userId ${userId}`);
                } catch (workerError) {
                    console.error('❌ Errore caricamento worker (riavvio):', workerError);
                }
                
                return res.status(200).json({
                    success: true,
                    message: 'Iscrizione riavviata',
                    id: existing.id
                });
            }
        }

        // 5. Crea l'iscrizione nel database
        console.log('📝 Creazione nuova iscrizione...');
        const insertData = {
            id_gara: idGaraNum,
            id_tesserato: idTesseratoNum,
            stato: 'in_attesa'
        };

        // ✅ Aggiungi giorno_iscrizione SOLO SE fornito
        if (giorno_iscrizione) {
            insertData.giorno_iscrizione = giorno_iscrizione;
        }

        const { data: iscrizione, error: iscrizioneError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .insert(insertData)
            .select()
            .single();

        if (iscrizioneError) {
            console.error('❌ Errore creazione iscrizione:', iscrizioneError);
            throw iscrizioneError;
        }

        console.log(`✅ Iscrizione creata: ${iscrizione.id}`);

        // ✅ 🔥 AVVIA IL WORKER CON userId (MODIFICA PRINCIPALE!)
        try {
            const { eseguiIscrizioneGara } = await import('../workers/iscrizioneWorker.js');
            eseguiIscrizioneGara(iscrizione.id, userId); // ✅ PASSA userId!
            console.log(`✅ Worker avviato per iscrizione ${iscrizione.id} con userId ${userId}`);
        } catch (workerError) {
            console.error('❌ Errore caricamento worker:', workerError);
            // Non bloccare la risposta se il worker non parte
        }

        // 7. Restituisci risposta immediata
        res.status(201).json({
            success: true,
            message: 'Iscrizione avviata',
            id: iscrizione.id
        });

    } catch (error) {
        console.error('❌ Errore iscrivitiGara:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// PUT /api/gare/:id
// Aggiorna una gara esistente (solo admin)
// ============================================================
export const updateGara = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nome,
            data_gara,
            tipologia,
            categoria,
            regione,
            luogo,
            data_inizio_iscrizioni,
            data_fine_iscrizioni,
            note,
            stato,
        } = req.body;

        // Verifica che la gara esista
        const { data: existing, error: checkError } = await supabaseAdmin
            .from('gare')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Gara non trovata' });
        }

        const { data, error } = await supabaseAdmin
            .from('gare')
            .update({
                nome,
                data_gara,
                tipologia,
                categoria,
                regione,
                note: luogo ? `Luogo: ${luogo}` : note,
                data_inizio_iscrizioni,
                data_fine_iscrizioni,
                stato,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Gara aggiornata con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore updateGara:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// DELETE /api/gare/:id
// Elimina una gara (solo admin)
// ============================================================
export const deleteGara = async (req, res) => {
    try {
        const { id } = req.params;

        // Verifica che la gara esista
        const { data: existing, error: checkError } = await supabaseAdmin
            .from('gare')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Gara non trovata' });
        }

        const { error } = await supabaseAdmin
            .from('gare')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Gara eliminata con successo'
        });
    } catch (error) {
        console.error('❌ Errore deleteGara:', error);
        res.status(500).json({ error: error.message });
    }
};