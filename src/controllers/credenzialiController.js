import { supabaseAdmin } from '../config/supabase.js';
import crypto from 'crypto';

// ============================================================
// CONFIGURAZIONE CIFRATURA
// ============================================================
const ENCRYPTION_KEY = process.env.PORTALE_CREDENTIALS_ENCRYPTION_KEY || 'default-key-32-chars-long!!!';
const IV_LENGTH = 16;

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// ============================================================
// SALVA/AGGIORNA CREDENZIALI PORTALE
// POST /api/presidenti/credenziali-portale
// ============================================================
export const salvaCredenziali = async (req, res) => {
    try {
        const { username, password } = req.body;
        const userId = req.userId;

        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Username e password sono obbligatori' 
            });
        }

        // 1. Recupera l'id del manutentore (presidente) dal user_id
        const { data: manutentore, error: manutentoreError } = await supabaseAdmin
            .from('manutentori')
            .select('id')
            .eq('user_id', userId)
            .single();

        if (manutentoreError || !manutentore) {
            return res.status(404).json({ error: 'Presidente non trovato' });
        }

        // 2. Cifra la password
        const passwordCifrata = encrypt(password);

        // 3. Salva o aggiorna nel database
        const { data, error } = await supabaseAdmin
            .from('credenziali_portale_presidenti')
            .upsert({
                id_presidente: manutentore.id,
                username: username,
                password_cifrata: passwordCifrata,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'id_presidente'
            })
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Credenziali salvate con successo',
            data: {
                username: data.username,
                updated_at: data.updated_at
            }
        });

    } catch (error) {
        console.error('❌ Errore salvataggio credenziali:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// RECUPERA CREDENZIALI (SOLO USERNAME E DATA)
// GET /api/presidenti/credenziali-portale
// ============================================================
export const getCredenziali = async (req, res) => {
    try {
        const userId = req.userId;

        // 1. Recupera l'id del manutentore (presidente) dal user_id
        const { data: manutentore, error: manutentoreError } = await supabaseAdmin
            .from('manutentori')
            .select('id')
            .eq('user_id', userId)
            .single();

        if (manutentoreError || !manutentore) {
            return res.status(404).json({ error: 'Presidente non trovato' });
        }

        // 2. Recupera le credenziali (solo username e data, MAI la password!)
        const { data, error } = await supabaseAdmin
            .from('credenziali_portale_presidenti')
            .select('username, updated_at')
            .eq('id_presidente', manutentore.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ 
                    hasCredentials: false,
                    message: 'Nessuna credenziale configurata'
                });
            }
            throw error;
        }

        res.json({
            hasCredentials: true,
            username: data.username,
            updated_at: data.updated_at
        });

    } catch (error) {
        console.error('❌ Errore recupero credenziali:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// FUNZIONE INTERNA PER RECUPERARE CREDENZIALI (PER PUPPETEER)
// ⚠️ USATA SOLO DAL WORKER - MAI ESPOSTA AL FRONTEND!
// ============================================================
export async function getCredenzialiPerPuppeteer(idPresidente) {
    try {
        const { data, error } = await supabaseAdmin
            .from('credenziali_portale_presidenti')
            .select('username, password_cifrata')
            .eq('id_presidente', idPresidente)
            .single();

        if (error) throw error;
        if (!data) throw new Error('Credenziali non trovate');

        // Decifra la password SOLO in memoria
        const password = decrypt(data.password_cifrata);
        
        return {
            username: data.username,
            password: password
        };

    } catch (error) {
        console.error('❌ Errore recupero credenziali per Puppeteer:', error);
        throw error;
    }
}