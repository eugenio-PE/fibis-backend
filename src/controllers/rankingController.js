import { supabaseAdmin } from '../config/supabase.js';

// ============================================================
// GET /api/ranking/atleta/:id_tesserato
// Ranking di un singolo atleta con storico
// ============================================================
export const getRankingAtleta = async (req, res) => {
    try {
        const { id_tesserato } = req.params;
        const { limit = 30 } = req.query;

        // 1. Ottieni il ranking più recente
        const { data: current, error: currentError } = await supabaseAdmin
            .from('ranking_snapshot')
            .select('*')
            .eq('id_tesserato', id_tesserato)
            .order('data_snapshot', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (currentError) throw currentError;

        // 2. Ottieni lo storico (per il grafico)
        const { data: history, error: historyError } = await supabaseAdmin
            .from('ranking_snapshot')
            .select('*')
            .eq('id_tesserato', id_tesserato)
            .order('data_snapshot', { ascending: true })
            .limit(parseInt(limit));

        if (historyError) throw historyError;

        // 3. Ottieni i dati dell'atleta
        const { data: atleta, error: atletaError } = await supabaseAdmin
            .from('tesserati')
            .select('nome, cognome, disciplina, categoria, asd_centri:nome')
            .eq('id', id_tesserato)
            .single();

        if (atletaError && atletaError.code !== 'PGRST116') throw atletaError;

        res.json({
            atleta: atleta || null,
            current: current || null,
            history: history || [],
            total: history?.length || 0
        });
    } catch (error) {
        console.error('❌ Errore getRankingAtleta:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// GET /api/ranking/top
// Top N atleti per disciplina
// ============================================================
export const getTopRanking = async (req, res) => {
    try {
        const { disciplina, limit = 100, categoria } = req.query;

        let query = supabaseAdmin
            .from('ranking_snapshot')
            .select(`
                *,
                tesserati!inner (
                    nome,
                    cognome,
                    disciplina,
                    categoria,
                    asd_centri (nome)
                )
            `)
            .order('data_snapshot', { ascending: false })
            .limit(1);

        // Filtro per disciplina (se fornita)
        if (disciplina) {
            query = query.eq('tesserati.disciplina', disciplina);
        }

        // Filtro per categoria (se fornita)
        if (categoria) {
            query = query.eq('tesserati.categoria', categoria);
        }

        // Per ottenere la top list, dobbiamo prendere l'ultimo snapshot per ogni atleta
        // Questa è una soluzione semplificata: prendiamo tutti i ranking recenti
        const { data: allRankings, error } = await supabaseAdmin
            .from('ranking_snapshot')
            .select(`
                *,
                tesserati!inner (
                    nome,
                    cognome,
                    disciplina,
                    categoria,
                    asd_centri (nome)
                )
            `)
            .order('data_snapshot', { ascending: false });

        if (error) throw error;

        // Raggruppa per atleta (prendi l'ultimo snapshot per ciascuno)
        const latestByAtleta = {};
        for (const r of allRankings) {
            const key = r.id_tesserato;
            if (!latestByAtleta[key] || r.data_snapshot > latestByAtleta[key].data_snapshot) {
                latestByAtleta[key] = r;
            }
        }

        // Converti in array e ordina per posizione
        let rankings = Object.values(latestByAtleta);
        
        // Applica filtri aggiuntivi (disciplina, categoria) se specificati
        if (disciplina) {
            rankings = rankings.filter(r => r.tesserati?.disciplina === disciplina);
        }
        if (categoria) {
            rankings = rankings.filter(r => r.tesserati?.categoria === categoria);
        }

        // Ordina per posizione (prima i numeri più bassi)
        rankings.sort((a, b) => (a.posizione || 999) - (b.posizione || 999));

        // Limita il numero di risultati
        rankings = rankings.slice(0, parseInt(limit));

        res.json({
            rankings,
            total: rankings.length,
            filters: { disciplina, categoria }
        });
    } catch (error) {
        console.error('❌ Errore getTopRanking:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// GET /api/ranking/trend/:id_tesserato
// Trend del ranking (ultimi N giorni)
// ============================================================
export const getTrendAtleta = async (req, res) => {
    try {
        const { id_tesserato } = req.params;
        const { giorni = 30 } = req.query;

        const { data, error } = await supabaseAdmin
            .from('ranking_snapshot')
            .select('posizione, punteggio, data_snapshot')
            .eq('id_tesserato', id_tesserato)
            .gte('data_snapshot', new Date(Date.now() - giorni * 86400000).toISOString())
            .order('data_snapshot', { ascending: true });

        if (error) throw error;

        // Calcola il trend: ultima posizione - prima posizione
        let trend = 0;
        if (data && data.length >= 2) {
            const first = data[0];
            const last = data[data.length - 1];
            trend = first.posizione - last.posizione; // positivo = migliorato
        }

        res.json({
            id_tesserato,
            data: data || [],
            trend,
            giorni: parseInt(giorni)
        });
    } catch (error) {
        console.error('❌ Errore getTrendAtleta:', error);
        res.status(500).json({ error: error.message });
    }
};