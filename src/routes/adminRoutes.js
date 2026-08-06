import express from 'express';
import { generaControlli, aggiornaEsito, importaManutentori } from '../controllers/controlliController.js';
import { scanQR } from '../controllers/interventoController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// ============================================
// ROTTE PER MANUTENTORI (CRUD)
// ============================================

// GET: Lista tutti i manutentori
router.get('/admin/manutentori', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('*')
      .order('cognome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea un nuovo manutentore/presidente/direttore
router.post('/admin/manutentori', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { nome, cognome, email, telefono, azienda, data_scadenza_albo, ruolo, asd_id } = req.body;

    // 1. Verifica se l'utente esiste già in auth.users
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Errore listUsers:', listError);
      throw listError;
    }

    const existingUser = existingUsers?.users?.find(u => u.email === email);

    let userId;
    if (existingUser) {
      // Utente già esistente, usa il suo ID
      userId = existingUser.id;
      console.log(`📌 Utente già esistente: ${email} (${userId})`);
    } else {
      // 2. Crea un nuovo utente in Supabase Auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
        email,
        password: 'PasswordTemporanea123!',
      });

      if (authError) {
        console.error('❌ Errore signUp:', authError);
        throw authError;
      }
      userId = authData.user.id;
      console.log(`✅ Utente creato: ${email} (${userId})`);
    }

    // 3. Prepara i dati da inserire
    const insertData = {
      user_id: userId,
      nome,
      cognome,
      email,
      telefono: telefono || '',
      ruolo: ruolo || 'manutentore',
      is_active: true,
    };

    // Campi specifici per ruolo
    if (ruolo === 'manutentore') {
      insertData.azienda = azienda || '';
      insertData.data_scadenza_albo = data_scadenza_albo;
    } else if (ruolo === 'presidente') {
      insertData.asd_id = asd_id || null;
      insertData.data_scadenza_albo = '2026-08-31';  // Scadenza affiliazione
    } else if (ruolo === 'direttore') {
      insertData.data_scadenza_albo = '2026-08-31';  // Scadenza tessera
    } else {
      // Per altri ruoli, usa i campi standard
      insertData.data_scadenza_albo = data_scadenza_albo || null;
    }

    // 4. Inserisci in manutentori
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('❌ Errore insert manutentori:', error);
      throw error;
    }

    console.log(`✅ ${ruolo} creato: ${nome} ${cognome} (${email})`);
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Errore creazione manutentore:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna un manutentore
router.put('/admin/manutentori/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, cognome, email, telefono, azienda, data_scadenza_albo, ruolo, is_active, asd_id } = req.body;

    const updateData = {
      nome,
      cognome,
      email,
      telefono,
      azienda,
      data_scadenza_albo,
      ruolo,
      is_active,
    };

    if (ruolo === 'presidente') {
      updateData.asd_id = asd_id || null;
    } else {
      updateData.asd_id = null;
    }

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore aggiornamento manutentore:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina un manutentore
router.delete('/admin/manutentori/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: manutentore, error: findError } = await supabaseAdmin
      .from('manutentori')
      .select('user_id')
      .eq('id', id)
      .single();

    if (findError) throw findError;

    const { error: deleteError } = await supabaseAdmin
      .from('manutentori')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    if (manutentore.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(manutentore.user_id);
    }

    res.json({ message: 'Manutentore eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTE PER PRODOTTI (CRUD)
// ============================================

// GET: Lista tutti i prodotti
router.get('/admin/prodotti', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('prodotti_omologati')
      .select('*')
      .order('marca', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea un nuovo prodotto
router.post('/admin/prodotti', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id_produttore, categoria, marca, modello, codice_omologazione } = req.body;

    const { data, error } = await supabaseAdmin
      .from('prodotti_omologati')
      .insert({
        id_produttore,
        categoria,
        marca,
        modello,
        codice_omologazione,
        attivo: true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna un prodotto
router.put('/admin/prodotti/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { id_produttore, categoria, marca, modello, codice_omologazione, attivo } = req.body;

    const { data, error } = await supabaseAdmin
      .from('prodotti_omologati')
      .update({
        id_produttore,
        categoria,
        marca,
        modello,
        codice_omologazione,
        attivo,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina un prodotto
router.delete('/admin/prodotti/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('prodotti_omologati')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Prodotto eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTE PER DIRETTORI DI GARA (CRUD)
// ============================================

// GET: Lista tutti i direttori di gara
router.get('/admin/direttori', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('*')
      .eq('ruolo', 'direttore')
      .order('cognome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea un nuovo direttore di gara
router.post('/admin/direttori', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { nome, cognome, email, telefono, data_scadenza_albo } = req.body;

    const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
      email,
      password: 'PasswordTemporanea123!',
    });

    if (authError) throw authError;

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .insert({
        user_id: authData.user.id,
        nome,
        cognome,
        email,
        telefono: telefono || '',
        ruolo: 'direttore',
        is_active: true,
        data_scadenza_albo: data_scadenza_albo || '2099-12-31',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna un direttore di gara
router.put('/admin/direttori/:id', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, cognome, email, telefono, is_active } = req.body;

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .update({
        nome,
        cognome,
        email,
        telefono,
        is_active,
      })
      .eq('id', id)
      .eq('ruolo', 'direttore')
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina un direttore di gara
router.delete('/admin/direttori/:id', authenticate, requireRole(['admin', 'settore_tecnico']), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: direttore, error: findError } = await supabaseAdmin
      .from('manutentori')
      .select('user_id')
      .eq('id', id)
      .eq('ruolo', 'direttore')
      .single();

    if (findError) throw findError;

    const { error: deleteError } = await supabaseAdmin
      .from('manutentori')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    if (direttore.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(direttore.user_id);
    }

    res.json({ message: 'Direttore di gara eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Lista direttori disponibili (per Presidenti ASD)
router.get('/direttori/disponibili', authenticate, async (req, res) => {
  try {
    const { data: manutentore } = await supabaseAdmin
      .from('manutentori')
      .select('ruolo')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (!manutentore || manutentore.ruolo !== 'presidente') {
      return res.status(403).json({ error: 'Accesso riservato ai presidenti ASD' });
    }

    const { data, error } = await supabaseAdmin
      .from('manutentori')
      .select('id, nome, cognome, email')
      .eq('ruolo', 'direttore')
      .eq('is_active', true)
      .order('cognome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore GET /direttori/disponibili:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTE PER CONTROLLI A SORPRESA
// ============================================

router.post('/controlli/genera', authenticate, requireRole(['admin']), generaControlli);
router.put('/controlli/:id', authenticate, requireRole(['admin', 'ispettore']), aggiornaEsito);

// ============================================
// ROTTA PER IMPORTAZIONE CSV
// ============================================

router.post('/admin/manutentori/import', authenticate, requireRole(['admin']), importaManutentori);

// ============================================
// ROTTE PER ASD
// ============================================

// GET: Lista tutte le ASD
router.get('/admin/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .select(`
        *,
        biliardi (*)
      `)
      .order('nome', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crea una nuova ASD (AGGIORNATO con nuovi campi)
router.post('/admin/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { 
      nome, indirizzo, 
      responsabile_nome, responsabile_email, responsabile_telefono,
      codice, stagione, cap, comune, provincia, regione, 
      email_contatto, telefono_contatto, pec,
      responsabile_cognome, cf_responsabile, cf_asd
    } = req.body;

    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .insert({
        nome,
        indirizzo,
        responsabile_nome,
        responsabile_email,
        responsabile_telefono,
        codice,
        stagione,
        cap,
        comune,
        provincia,
        regione,
        email_contatto,
        telefono_contatto,
        pec,
        responsabile_cognome,
        cf_responsabile,
        cf_asd,
        attivo: true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Errore creazione ASD:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT: Aggiorna una ASD (AGGIORNATO con nuovi campi)
router.put('/admin/asd/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      nome, indirizzo, 
      responsabile_nome, responsabile_email, responsabile_telefono,
      codice, stagione, cap, comune, provincia, regione, 
      email_contatto, telefono_contatto, pec,
      responsabile_cognome, cf_responsabile, cf_asd
    } = req.body;

    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .update({
        nome,
        indirizzo,
        responsabile_nome,
        responsabile_email,
        responsabile_telefono,
        codice,
        stagione,
        cap,
        comune,
        provincia,
        regione,
        email_contatto,
        telefono_contatto,
        pec,
        responsabile_cognome,
        cf_responsabile,
        cf_asd,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Errore aggiornamento ASD:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina una ASD
router.delete('/admin/asd/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    await supabaseAdmin
      .from('biliardi')
      .delete()
      .eq('id_asd', id);

    const { error } = await supabaseAdmin
      .from('asd_centri')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'ASD eliminata con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Genera QR per ASD
router.get('/asd/:id/qr', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .select('qr_code, nome')
      .eq('id', id)
      .single();

    if (error) throw error;

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const qrUrl = `${baseUrl}/asd/${data.qr_code}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`;

    res.json({
      qr_url: qrImageUrl,
      qr_code: data.qr_code,
      asd_nome: data.nome,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Genera QR per ASD (crea nuovo QR code)
router.post('/admin/asd/:id/genera-qr', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Recupera l'ASD
    const { data: asd, error: findError } = await supabaseAdmin
      .from('asd_centri')
      .select('codice, nome')
      .eq('id', id)
      .single();
    
    if (findError) throw findError;
    
    // 2. Genera un UUID per il QR code (USA crypto.randomUUID() NATIVO)
    const qrCode = crypto.randomUUID();
    
    // 3. Aggiorna l'ASD con il QR code
    const { data, error } = await supabaseAdmin
      .from('asd_centri')
      .update({ qr_code: qrCode })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    // 4. Costruisci l'URL del QR
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`;
    
    res.json({
      qr_code: qrCode,
      qr_code_url: qrImageUrl,   // ← CAMBIATO: qr_code_url invece di qr_url
      asd_nome: asd.nome,
    });
  } catch (error) {
    console.error('❌ Errore generazione QR:', error);
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// ROTTA PUBBLICA PER QR
// ============================================

router.get('/asd/:qrCode', scanQR);

// ============================================
// ROTTE PER BILIARDI
// ============================================

// POST: Aggiungi biliardo
router.post('/admin/biliardi', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id_asd, nome_tavolo, tipo, dimensioni } = req.body;
    
    const { data, error } = await supabaseAdmin
      .from('biliardi')
      .insert({
        id_asd,
        nome_tavolo,
        tipo: tipo || 'pool',
        dimensioni: dimensioni || '9ft',
        attivo: true
      })
      .select()
      .single();
      
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Elimina biliardo
router.delete('/admin/biliardi/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabaseAdmin
      .from('biliardi')
      .delete()
      .eq('id', id);
      
    if (error) throw error;
    res.json({ message: 'Biliardo eliminato con successo' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STATISTICHE PER LA DASHBOARD
// ============================================

router.get('/stats/asd', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('asd_centri')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/biliardi', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('biliardi')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/interventi', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('interventi')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/manutentori', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('manutentori')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json(count || 0);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROTTA PER IMPORTAZIONE CSV ASD
// ============================================

router.post('/admin/asd/import', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { asd } = req.body;

    if (!asd || asd.length === 0) {
      return res.status(400).json({ error: 'Nessun dato da importare' });
    }

    let importati = 0;
    let aggiornati = 0;
    let presidentiCreati = 0;
    let errori = 0;

    for (const record of asd) {
      try {
        // ===== 1. MAPPA CAMPI CSV =====
        const data = {
          codice: record['Codice']?.trim() || null,
          stagione: record['Stagione']?.trim() || null,
          nome: record['Denominazione']?.trim() || null,
          indirizzo: record['Indirizzo sede legale']?.trim() || null,
          cap: record['CAP']?.toString() || null,
          comune: record['Comune sede legale']?.trim() || null,
          provincia: record['Prov.']?.trim() || null,
          regione: record['Regione']?.trim() || null,
          email_contatto: record['e-mail']?.trim() || null,
          telefono_contatto: record['telefono']?.toString() || null,
          pec: record['PEC']?.trim() || null,
          responsabile_cognome: record['Cognome Resp.Legale']?.trim() || null,
          responsabile_nome: record['Nome Resp.Legale']?.trim() || null,
          cf_responsabile: record['Codice Fiscale']?.trim() || null,
          cf_asd: record['Codice fiscale']?.trim() || null,
          attivo: true
        };

        // ===== 2. UPSERT ASD =====
        let asdId;

        if (data.codice) {
          const { data: existing, error: findError } = await supabaseAdmin
            .from('asd_centri')
            .select('id')
            .eq('codice', data.codice)
            .maybeSingle();

          if (findError) throw findError;

          if (existing) {
            const { error: updateError } = await supabaseAdmin
              .from('asd_centri')
              .update(data)
              .eq('id', existing.id);

            if (updateError) throw updateError;
            asdId = existing.id;
            aggiornati++;
          } else {
            const { data: newAsd, error: insertError } = await supabaseAdmin
              .from('asd_centri')
              .insert(data)
              .select()
              .single();

            if (insertError) throw insertError;
            asdId = newAsd.id;
            importati++;
          }
        } else {
          const { data: newAsd, error: insertError } = await supabaseAdmin
            .from('asd_centri')
            .insert(data)
            .select()
            .single();

          if (insertError) throw insertError;
          asdId = newAsd.id;
          importati++;
        }

        // ===== 3. CREA PRESIDENTE AUTOMATICAMENTE =====
        const emailPresidente = record['e-mail']?.trim();
        const nomePresidente = record['Nome Resp.Legale']?.trim();
        const cognomePresidente = record['Cognome Resp.Legale']?.trim();

        if (emailPresidente && nomePresidente && cognomePresidente && asdId) {
          try {
            // Verifica se l'utente esiste già in auth.users
            const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
            const existingUser = existingUsers?.users?.find(u => u.email === emailPresidente);

            let userId;

            if (existingUser) {
              // Utente già esistente in Auth
              userId = existingUser.id;
            } else {
              // Crea nuovo utente in Supabase Auth
              const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
                email: emailPresidente,
                password: 'PasswordTemporanea123!',
              });

              if (authError) throw authError;
              userId = authData.user.id;
            }

            // Verifica se il presidente esiste già in manutentori
            const { data: existingPresidente } = await supabaseAdmin
              .from('manutentori')
              .select('id')
              .eq('email', emailPresidente)
              .eq('ruolo', 'presidente')
              .maybeSingle();

            if (!existingPresidente) {
              // Crea il record in manutentori
              const { error: insertPresidenteError } = await supabaseAdmin
                .from('manutentori')
                .insert({
                  user_id: userId,
                  nome: nomePresidente,
                  cognome: cognomePresidente,
                  email: emailPresidente,
                  ruolo: 'presidente',
                  asd_id: asdId,
                  is_active: true,
                  data_scadenza_albo: '2026-08-31',  // ← AGGIUNTO!
                });

              if (insertPresidenteError) throw insertPresidenteError;
              presidentiCreati++;
            }
          } catch (presidenteError) {
            console.error('❌ Errore creazione presidente per ASD', asdId, ':', presidenteError);
            // Non bloccare l'importazione per errore del presidente
          }
        }

      } catch (recordError) {
        console.error('❌ Errore su record:', recordError);
        errori++;
      }
    }

    res.json({
      importati,
      aggiornati,
      presidentiCreati,
      errori,
      totale: asd.length
    });

  } catch (error) {
    console.error('❌ Errore importazione ASD:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;