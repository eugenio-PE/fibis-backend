import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// GET /api/tesserati
// Lista tutti i tesserati (con filtri opzionali)
// ============================================================
export const getTesserati = async (req, res) => {
    try {
        const { asd_id, disciplina, stato, search, stagione } = req.query;
        
        let query = supabaseAdmin
            .from('tesserati')
            .select(`
                *,
                asd_centri:asd_id (nome, codice)
            `);

        // Filtri
        if (asd_id) query = query.eq('asd_id', asd_id);
        if (disciplina) query = query.eq('disciplina', disciplina);
        if (stato) query = query.eq('stato', stato);
        if (stagione) query = query.eq('stagione', stagione);
        if (search) {
            query = query.or(`nome.ilike.%${search}%,cognome.ilike.%${search}%,email.ilike.%${search}%,matricola::text.ilike.%${search}%,codice_tessera.ilike.%${search}%`);
        }

        const { data, error } = await query.order('cognome', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('❌ Errore getTesserati:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// GET /api/tesserati/:id
// Dettaglio di un singolo tesserato
// ============================================================
export const getTesseratoById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('tesserati')
            .select(`
                *,
                asd_centri:asd_id (nome, codice, indirizzo, responsabile_nome),
                certificati_medici (*),
                stecche_tesserati (*)
            `)
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Tesserato non trovato' });
        }

        res.json(data);
    } catch (error) {
        console.error('❌ Errore getTesseratoById:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// POST /api/tesserati
// Crea un nuovo tesserato
// ============================================================
export const createTesserato = async (req, res) => {
    try {
        const {
            asd_id,
            nome,
            cognome,
            data_nascita,
            codice_fiscale,
            email,
            telefono,
            disciplina,
            categoria,
            data_tesseramento,
            data_scadenza,
            foto_url,
            stato = 'attivo',
            consenso_privacy = false,
            consenso_ranking = false,
            stagione,
            sesso,
            matricola,
            codice_tessera,
            tipo_tessera,
            qualifica,
            livello,
            categoria_ranking
        } = req.body;

        // Validazione base
        if (!nome || !cognome || !asd_id) {
            return res.status(400).json({ error: 'Nome, cognome e ASD sono obbligatori' });
        }

        // Verifica matricola univoca (se fornita)
        if (matricola) {
            const { data: existing } = await supabaseAdmin
                .from('tesserati')
                .select('id')
                .eq('matricola', matricola)
                .maybeSingle();
            
            if (existing) {
                return res.status(400).json({ error: 'Matricola già esistente' });
            }
        }

        const { data, error } = await supabaseAdmin
            .from('tesserati')
            .insert({
                asd_id,
                nome,
                cognome,
                data_nascita,
                codice_fiscale,
                email,
                telefono,
                disciplina,
                categoria,
                data_tesseramento,
                data_scadenza,
                foto_url,
                stato,
                consenso_privacy,
                consenso_ranking,
                stagione,
                sesso,
                matricola,
                codice_tessera,
                tipo_tessera,
                qualifica,
                livello,
                categoria_ranking
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: 'Tesserato creato con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore createTesserato:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// PUT /api/tesserati/:id
// Aggiorna un tesserato esistente
// ============================================================
export const updateTesserato = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            asd_id,
            nome,
            cognome,
            data_nascita,
            codice_fiscale,
            email,
            telefono,
            disciplina,
            categoria,
            data_tesseramento,
            data_scadenza,
            foto_url,
            stato,
            consenso_privacy,
            consenso_ranking,
            stagione,
            sesso,
            matricola,
            codice_tessera,
            tipo_tessera,
            qualifica,
            livello,
            categoria_ranking
        } = req.body;

        // Verifica che il tesserato esista
        const { data: existing, error: checkError } = await supabaseAdmin
            .from('tesserati')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Tesserato non trovato' });
        }

        // Verifica matricola univoca (se fornita e diversa da quella attuale)
        if (matricola) {
            const { data: existingMatricola } = await supabaseAdmin
                .from('tesserati')
                .select('id')
                .eq('matricola', matricola)
                .neq('id', id)
                .maybeSingle();
            
            if (existingMatricola) {
                return res.status(400).json({ error: 'Matricola già esistente' });
            }
        }

        const { data, error } = await supabaseAdmin
            .from('tesserati')
            .update({
                asd_id,
                nome,
                cognome,
                data_nascita,
                codice_fiscale,
                email,
                telefono,
                disciplina,
                categoria,
                data_tesseramento,
                data_scadenza,
                foto_url,
                stato,
                consenso_privacy,
                consenso_ranking,
                stagione,
                sesso,
                matricola,
                codice_tessera,
                tipo_tessera,
                qualifica,
                livello,
                categoria_ranking,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Tesserato aggiornato con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore updateTesserato:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// DELETE /api/tesserati/:id
// Elimina un tesserato (soft delete - cambia stato in 'sospeso')
// ============================================================
export const deleteTesserato = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('tesserati')
            .update({ 
                stato: 'sospeso',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: 'Tesserato non trovato' });
        }

        res.json({
            success: true,
            message: 'Tesserato sospeso con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore deleteTesserato:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// POST /api/tesserati/import-csv
// Importa tesserati da CSV (massivo)
// ============================================================
export const importTesseratiFromCSV = async (req, res) => {
    try {
        const { tesserati } = req.body;

        if (!tesserati || !Array.isArray(tesserati) || tesserati.length === 0) {
            return res.status(400).json({ error: 'Nessun dato da importare' });
        }

        const results = {
            success: 0,
            errors: 0,
            details: []
        };

        for (const row of tesserati) {
            try {
                // Mappa i campi dal CSV
                const data = {
                    asd_id: row.asd_id,
                    nome: row.nome,
                    cognome: row.cognome,
                    data_nascita: row.data_nascita,
                    codice_fiscale: row.codice_fiscale,
                    email: row.email,
                    telefono: row.telefono,
                    disciplina: row.qualifica ? mapQualificaToDisciplina(row.qualifica) : null,
                    categoria: row.categoria,
                    data_tesseramento: row.data_tesseramento || new Date().toISOString().split('T')[0],
                    data_scadenza: row.data_scadenza,
                    stato: 'attivo',
                    stagione: row.stagione,
                    sesso: row.sesso,
                    matricola: row.matricola,
                    codice_tessera: row.codice_tessera,
                    tipo_tessera: row.tipo_tessera,
                    qualifica: row.qualifica,
                    livello: row.livello,
                    categoria_ranking: row['Categoria Ranking'] || row['categoria_ranking'] || 'terza'
                };

                // Verifica che i campi obbligatori ci siano
                if (!data.nome || !data.cognome || !data.asd_id) {
                    throw new Error('Nome, cognome e ASD sono obbligatori');
                }

                // Verifica matricola univoca
                if (data.matricola) {
                    const { data: existing } = await supabaseAdmin
                        .from('tesserati')
                        .select('id')
                        .eq('matricola', data.matricola)
                        .maybeSingle();
                    
                    if (existing) {
                        throw new Error(`Matricola ${data.matricola} già esistente`);
                    }
                }

                const { error } = await supabaseAdmin
                    .from('tesserati')
                    .insert(data);

                if (error) throw error;

                results.success++;
                results.details.push({ matricola: data.matricola, nome: data.nome, cognome: data.cognome, status: 'ok' });
            } catch (error) {
                results.errors++;
                results.details.push({ 
                    matricola: row.matricola || 'N/A', 
                    nome: row.nome, 
                    cognome: row.cognome, 
                    status: 'error', 
                    error: error.message 
                });
            }
        }

        res.json({
            success: true,
            message: `Importazione completata: ${results.success} inseriti, ${results.errors} errori`,
            data: results
        });
    } catch (error) {
        console.error('❌ Errore importTesseratiFromCSV:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// Helper: mappa qualifica → disciplina
// ============================================================
function mapQualificaToDisciplina(qualifica) {
    const map = {
        'Stecca': 'stecca',
        'Carambola': 'carambola',
        'Boccette': 'boccette',
        'Pool/Snooker': 'pool_snooker',
        'Bowling': 'bowling'
    };
    return map[qualifica] || null;
}

// ============================================================
// POST /api/tesserati/:id/stecca
// Aggiunge una stecca a un tesserato
// ============================================================
export const addStecca = async (req, res) => {
    try {
        const { id } = req.params;
        const { marca, modello, tipo_marca, peso, lunghezza, materiale } = req.body;

        if (!marca) {
            return res.status(400).json({ error: 'La marca è obbligatoria' });
        }

        const { data: tesserato, error: checkError } = await supabaseAdmin
            .from('tesserati')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !tesserato) {
            return res.status(404).json({ error: 'Tesserato non trovato' });
        }

        const { data, error } = await supabaseAdmin
            .from('stecche_tesserati')
            .insert({
                id_tesserato: id,
                marca,
                modello,
                tipo_marca,
                peso,
                lunghezza,
                materiale
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: 'Stecca aggiunta con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore addStecca:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// GET /api/tesserati/:id/stecca
// Recupera tutte le stecche di un tesserato
// ============================================================
export const getStecche = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('stecche_tesserati')
            .select('*')
            .eq('id_tesserato', id)
            .order('data_inserimento', { ascending: false });

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error('❌ Errore getStecche:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// POST /api/tesserati/:id/logo
// Upload logo sponsor personale (solo eccellenze)
// ============================================================
export const uploadLogo = async (req, res) => {
    try {
        const { id } = req.params;
        const { logo_url } = req.body;

        if (!logo_url) {
            return res.status(400).json({ error: 'URL del logo richiesto' });
        }

        // Verifica che il tesserato esista
        const { data: tesserato, error: checkError } = await supabaseAdmin
            .from('tesserati')
            .select('id, categoria_ranking')
            .eq('id', id)
            .single();

        if (checkError || !tesserato) {
            return res.status(404).json({ error: 'Tesserato non trovato' });
        }

        // Verifica che sia un'eccellenza
        const eccellenza = ['master', 'nazionali', 'nazionali_pro'].includes(
            tesserato.categoria_ranking?.toLowerCase()
        );

        if (!eccellenza) {
            return res.status(403).json({ error: 'Solo le categorie eccellenza possono avere un logo personale' });
        }

        // Aggiorna il logo
        const { data, error } = await supabaseAdmin
            .from('tesserati')
            .update({ logo_sponsor_url: logo_url })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Logo caricato con successo',
            data
        });
    } catch (error) {
        console.error('❌ Errore uploadLogo:', error);
        res.status(500).json({ error: error.message });
    }
};