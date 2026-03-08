const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { mergeVideos } = require('../utils/merge-util');

const { ALIBABA_API_KEY: ENV_ALIBABA_API_KEY, QWEN_MODEL: ENV_QWEN_MODEL, WAN_MODEL: ENV_WAN_MODEL, TTS_MODEL: ENV_TTS_MODEL } = process.env;

// Debug log helper
function debugLog(msg) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync(path.join(__dirname, '../debug-log.txt'), logMsg);
}
debugLog('Server controller loaded');

const COSMY_VOICE_ID = process.env.COSMY_VOICE_ID || 'cosyvoice-v1';

// DASH SCOPE VOICE MAPPING (English Focus)
const VOICE_MAP = {
  // Male
  'sam': 'sam',
  'ray': 'sam',
  'george': 'george',
  'tom': 'george',
  'kevin': 'sam',
  'bapak': 'longanyang',
  'bapa': 'longanyang',
  'ayah': 'longwan',
  'male': 'longanyang',
  'longanyang': 'longanyang',
  'longwan': 'longwan',
  // Female
  'beth': 'betty',
  'betty': 'betty',
  'bella': 'bella',
  'anne': 'bella',
  'ibu': 'loongma',
  'mama': 'loongma',
  'female': 'loongma',
  'loongstella': 'loongstella',
  'loongma': 'loongma'
};

const ALIBABA_API_KEY = process.env.ALIBABA_API_KEY || '';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-max';
const WAN_MODEL = process.env.WAN_MODEL || 'wan2.6-t2v';
const TTS_MODEL = process.env.TTS_MODEL || 'cosyvoice-v3-flash';
const DASHSCOPE_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_WAN = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
const DASHSCOPE_WANX = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const DASHSCOPE_TTS = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-to-speech/synthesis';

// ── Helper: call Qwen ─────────────────────────────────────────
async function callQwen(systemPrompt, userContent, model = QWEN_MODEL, temperature = 0.7) {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const res = await axios.post(
        `${DASHSCOPE_BASE}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 4000,
          temperature: temperature,
        },
        {
          headers: {
            Authorization: `Bearer ${ALIBABA_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 180000,
        }
      );
      let raw = res.data.choices[0].message.content;
      debugLog(`Qwen Raw Response: ${raw.substring(0, 100)}...`);

      try {
        let clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(clean);
      } catch (parseErr) {
        debugLog(`JSON.parse failed, attempting regex extract...`);
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch (innerErr) {
            debugLog(`Regex extract JSON failed: ${innerErr.message}`);
          }
        }

        debugLog('CRITICAL: Qwen returned non-JSON string. Converting to mock structure.');
        return {
          detected_mood: 'neutral',
          characters: [],
          dialogs: [],
          scenes: [
            { visual: 'Visual interpretation based on text', narasi: raw.substring(0, 50), prompt_wan: raw.substring(0, 100) },
            { visual: 'Continuation', narasi: '...', prompt_wan: '...' }
          ]
        };
      }
    } catch (e) {
      attempts++;
      debugLog(`Qwen API Error (Attempt ${attempts}/${maxAttempts}): ${e.message}`);
      if (attempts >= maxAttempts) {
        throw e;
      }
      await new Promise(r => setTimeout(r, 2000 * attempts));
    }
  }
}

// ── Helper: call Qwen-VL (Vision Analysis) ──────────────────────
async function callQwenVL(imageUrl) {
  if (!ALIBABA_API_KEY || !imageUrl) return "a subject from the reference image";

  try {
    const res = await axios.post(
      `${DASHSCOPE_BASE}/chat/completions`,
      {
        model: "qwen-vl-max",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe the main subject of this image in 5 words or less. Focus on physical characteristics (e.g. 'a ginger tabby cat', 'a black puppy'). Use English." },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 100,
      },
      {
        headers: {
          Authorization: `Bearer ${ALIBABA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    const desc = res.data.choices[0].message.content.trim();
    debugLog(`Qwen-VL Analysis: ${desc}`);
    return desc;
  } catch (e) {
    debugLog(`Qwen-VL Error: ${e.message}`);
    return "the subject from the reference image";
  }
}

// ── Helper: call Wan AI ───────────────────────────────────────
async function callWanAI(promptText) {
  if (!ALIBABA_API_KEY) {
    console.warn('Wan AI: ALIBABA_API_KEY is missing.');
    return null;
  }

  const safePrompt = promptText && promptText.trim().length > 10
    ? promptText.trim()
    : 'A cinematic scene with dramatic lighting, professional film quality, 4k resolution';

  console.log(`Wan AI Request[${safePrompt.substring(0, 60)}...]`);

  try {
    const res = await axios.post(
      DASHSCOPE_WAN,
      {
        model: WAN_MODEL,
        input: { prompt: safePrompt },
        parameters: { size: '1280*720', duration: 5 },
      },
      {
        headers: {
          Authorization: `Bearer ${ALIBABA_API_KEY}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        timeout: 60000,
      }
    );

    if (res.data.output?.task_id) {
      console.log(`Wan AI Success: TaskID = ${res.data.output.task_id} `);
      return res.data.output.task_id;
    } else {
      console.warn('Wan AI Weird Response:', JSON.stringify(res.data));
      return null;
    }
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;
    console.error(`Wan AI Error[${status}]: `, data ? JSON.stringify(data) : e.message);
    return null;
  }
}

// ── Helper: Qwen Image Generation (100% Alibaba, qwen-image-plus) ────
async function callQwenImage(prompt, orientation = 'horizontal') {

  const size = orientation === 'vertical' ? '928*1664' : '1664*928';

  const safePrompt = prompt.substring(0, 1000).trim();
  console.log(`Qwen Image: submitting[${size}]"${safePrompt.substring(0, 60)}..."`);

  try {
    const submitRes = await axios.post(
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
      {
        model: 'qwen-image-plus',
        input: { prompt: safePrompt },
        parameters: { size, n: 1, prompt_extend: true, watermark: false },
      },
      {
        headers: {
          Authorization: `Bearer ${ALIBABA_API_KEY}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        timeout: 60000,
      }
    );

    const taskId = submitRes.data.output?.task_id;
    if (!taskId) throw new Error('No task_id in response: ' + JSON.stringify(submitRes.data));
    console.log(`Qwen Image task submitted: ${taskId} `);

    const pollUrl = `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`;
    let imageUrl = null;

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, i < 10 ? 3000 : 5000));
      const pollRes = await axios.get(pollUrl, {
        headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` },
        timeout: 20000,
      });
      const status = pollRes.data.output?.task_status;
      console.log(`Qwen Image poll[${i + 1}]: ${status}`);

      if (status === 'SUCCEEDED') {
        imageUrl = pollRes.data.output?.results?.[0]?.url;
        break;
      }
      if (status === 'FAILED') throw new Error('Qwen Image task FAILED: ' + JSON.stringify(pollRes.data));
    }

    if (!imageUrl) throw new Error('Timeout waiting for Qwen Image');
    console.log(`Qwen Image URL received: ${imageUrl.substring(0, 80)}...`);

    const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
    const uploadDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `lukisan_${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(imgRes.data));
    console.log(`Qwen Image saved: /public/uploads/${filename}`);
    return { localUrl: `/public/uploads/${filename}`, svgInline: null };

  } catch (e) {
    console.error('Qwen Image failed:', e.message);
    return { localUrl: null, svgInline: null };
  }
}

// ── Helper: Wan Video (wan2.6-t2v, text-to-video, async) ─────
async function callWanVideo(prompt, duration = 5, imageUrl = null, videoType = 'sinematik', lockedProfiles = {}) {
  if (!ALIBABA_API_KEY) return null;

  const model = imageUrl ? 'wan2.6-i2v-flash' : (process.env.WAN_MODEL || 'wan2.1-t2v-plus');

  const safePrompt = prompt && prompt.trim().length > 10
    ? prompt.trim().substring(0, 800)
    : 'A beautiful cinematic scene, high quality, professional lighting';

  const logPref = `Wan Video [${model}]:`;
  debugLog(`${logPref} submitting dur=${duration}s ${imageUrl ? '(I2V)' : '(T2V)'} "${safePrompt.substring(0, 60)}..."`);

  try {
    let styleSuffix = ", cinematic cinematic film, nostalgic high-quality footage, 4k master, consistent aesthetic";
    if (videoType === 'anime') {
      styleSuffix = ", anime style, high-quality 2d animation, cel-shaded, vibrant";
    } else if (videoType === 'drama_jalanan') {
      styleSuffix = ", 2D flat vector cartoon style, Tekotok animation style, minimalist simple background, vibrant solid colors, clean thick line art, high quality 2D animation";
    }

    const lockedChars = Object.entries(lockedProfiles)
      .filter(([name, desc]) => desc && desc.trim())
      .map(([name, desc]) => {
        const keyTraits = desc.split(',').slice(0, 3).join(',').trim();
        return `${name}: ${keyTraits}`;
      });
    const characterSuffix = lockedChars.length > 0
      ? `, consistent character appearance throughout: ${lockedChars.join('; ')}`
      : '';

    const finalPrompt = (safePrompt + styleSuffix + characterSuffix).substring(0, 800);

    const res = await axios.post(
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      {
        model: model,
        input: { prompt: finalPrompt, img_url: imageUrl },
        parameters: {
          resolution: '720P',
          duration: duration,
          shot_type: imageUrl ? 'multi' : undefined,
          prompt_extend: !imageUrl,
          watermark: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${ALIBABA_API_KEY}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        timeout: 60000,
      }
    );

    const taskId = res.data.output?.task_id;
    if (taskId) {
      debugLog(`${logPref} task submitted: ${taskId}`);
      return taskId;
    } else {
      debugLog(`${logPref} NO TASK_ID: ${JSON.stringify(res.data)}`);
      return null;
    }
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;
    debugLog(`${logPref} ERROR [${status}]: ${data ? JSON.stringify(data) : e.message}`);
    return null;
  }
}

// ── Helper: call TTS via WebSocket (CosyVoice v3) ────────────
async function callTTS(text, voice = 'longanyang', language = 'id', retryCount = 0) {
  if (!ALIBABA_API_KEY || !text) return null;

  await new Promise(r => setTimeout(r, 1500));

  const WebSocket = require('ws');
  const WS_URL = 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference';
  const taskId = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };

    const timeoutId = setTimeout(() => {
      debugLog(`TTS timeout (60s) for text: ${text.substring(0, 20)}...`);
      try { if (ws) ws.close(); } catch (_) { }
      if (retryCount < 2) {
        const nextDelay = (retryCount + 1) * 2000;
        debugLog(`Retrying TTS (timeout) in ${nextDelay}ms...`);
        safeResolve(new Promise(r => setTimeout(() => r(callTTS(text, voice, language, retryCount + 1)), nextDelay)));
      } else {
        safeResolve(null);
      }
    }, 60000);

    let ws;
    try {
      ws = new WebSocket(WS_URL, {
        headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` },
      });
    } catch (e) {
      debugLog(`TTS WS create error: ${e.message}`);
      clearTimeout(timeoutId);
      if (retryCount < 2) safeResolve(callTTS(text, voice, language, retryCount + 1));
      else safeResolve(null);
      return;
    }

    const audioChunks = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({
        header: {
          action: 'run-task',
          task_id: taskId,
          streaming: 'out',
        },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model: TTS_MODEL,
          parameters: {
            voice: voice,
            format: 'mp3',
            sample_rate: 22050,
            language: language
          },
          input: { text: text.substring(0, 500) },
        },
      }));
    });

    ws.on('message', (data, isBinary) => {
      try {
        const msg = JSON.parse(data.toString());
        const event = msg.header?.event;
        if (event === 'task-finished') {
          clearTimeout(timeoutId);
          ws.close();
          if (audioChunks.length > 0) {
            console.log(`TTS OK: ${Buffer.concat(audioChunks).length} bytes, ${audioChunks.length} chunks`);
            safeResolve(Buffer.concat(audioChunks));
          } else {
            safeResolve(null);
          }
        } else if (event === 'task-failed') {
          const errMsg = msg.header?.error_message || '';
          const isRateLimit = errMsg.toLowerCase().includes('limit');

          if (!errMsg.includes('418')) console.warn('TTS failed:', errMsg);
          clearTimeout(timeoutId);
          ws.close();

          if (retryCount < 3) {
            const nextDelay = isRateLimit ? 8000 : 1000;
            debugLog(`Retrying TTS due to ${isRateLimit ? 'rate limit' : 'failure'} in ${nextDelay}ms...`);
            safeResolve(new Promise(r => setTimeout(() => r(callTTS(text, voice, language, retryCount + 1)), nextDelay)));
          } else {
            safeResolve(null);
          }
        }
      } catch (_) {
        audioChunks.push(Buffer.from(data));
      }
    });

    ws.on('error', (err) => {
      console.warn('TTS WS error:', err.message);
      clearTimeout(timeoutId);
      if (ws) try { ws.close(); } catch (_) { }
      if (retryCount < 2) safeResolve(callTTS(text, voice, language, retryCount + 1));
      else safeResolve(null);
    });

    ws.on('close', () => {
      clearTimeout(timeoutId);
      if (audioChunks.length > 0) {
        safeResolve(Buffer.concat(audioChunks));
      } else {
        safeResolve(null);
      }
    });
  });
}

// ── FIX 2: Build character visual profile dari scene pertama mereka muncul ──
function buildCharacterProfiles(charactersPresent) {
  // { "Raka": null, "Dira": null } — diisi saat pertama kali Qwen describe mereka
  const profiles = {};
  (charactersPresent || []).forEach(name => {
    profiles[name] = null;
  });
  return profiles;
}

function updateCharacterProfiles(profiles, people_in_frame, charactersPresent) {
  if (!people_in_frame || people_in_frame.toLowerCase().startsWith('no people')) return;
  (charactersPresent || []).forEach(name => {
    if (!profiles[name] && people_in_frame.toLowerCase().includes(name.toLowerCase())) {
      profiles[name] = people_in_frame;
      debugLog(`[CHARACTER PROFILE] Locked profile for ${name}: ${people_in_frame.substring(0, 80)}`);
    }
  });
}

function buildCharacterConsistencyPrompt(profiles) {
  const locked = Object.entries(profiles).filter(([, v]) => v);
  if (locked.length === 0) return '';
  return `
════════════════════════════════════
KARAKTER — LOCKED VISUAL PROFILE (ABSOLUTE — TIDAK BOLEH BERUBAH):
════════════════════════════════════
${locked.map(([name, desc]) => `• ${name}: ${desc}`).join('\n')}

ATURAN KERAS:
- Salin deskripsi fisik ini KATA PER KATA ke setiap scene
- Kemeja biru = biru sampai scene terakhir
- Rambut pendek = pendek sampai scene terakhir
- Tidak ada pengecualian. Tidak ada variasi warna baju.
- Kalau kamu tulis deskripsi berbeda → output SALAH`;
}

// ── FIX 4: Build established location prompt ──────────────────
function buildLocationConsistencyPrompt(previousResults) {
  if (previousResults.length === 0) return '';
  const firstLocation = previousResults.find(r => r.location && r.location.trim())?.location;
  if (!firstLocation) return '';
  return `
LOKASI YANG SUDAH DITETAPKAN: "${firstLocation}"
ATURAN LOKASI KONSISTEN:
- Kalau scene ini masih di lokasi yang sama → JANGAN ganti lokasi, cukup ganti ANGLE atau FOCUS
- Contoh: dari wide shot kafe → medium shot dua orang di kafe yang sama → closeup meja kafe yang sama
- Lokasi BARU hanya boleh kalau narasi secara eksplisit menyebut perpindahan tempat
- JANGAN describe kafe yang berbeda kalau scene sebelumnya sudah di kafe tertentu`;
}

async function qwenRewriteToCinematic(userStory, sceneNarasi, sceneIndex, videoType, allScenes, previousResults, scenePeople, charactersPresent, characterProfiles) {
  const systemPrompt = `
You are a world-class cinematographer and visual storyteller
who specializes in emotional short films.

Your core philosophy: SHOW DON'T TELL.
Never describe emotion directly in the video.
Instead, choose visual elements that MAKE the viewer FEEL it
without being told what to feel.

════════════════════════════════════
PROSES WAJIB SEBELUM MENULIS PROMPT
════════════════════════════════════

LANGKAH 1 — BACA NARASI INI SECARA LITERAL:
Tanyakan diri sendiri:
A. Siapa yang ada dalam momen ini?
B. Di mana persisnya? (nama tempat, deskripsi spesifik)
C. Apa yang sedang terjadi secara fisik?
D. Ada objek spesifik apa yang disebutkan?
E. Apa aksi atau gestur yang terjadi?

Jawaban dari A-E adalah BAHAN UTAMA prompt kamu.
Jangan tambahkan elemen yang tidak ada dalam narasi atau cerita.

LANGKAH 2 — CEK KONTEKS SCENE SEBELUMNYA:
Lihat "VISUAL YANG SUDAH DIBUAT" di bawah.
Pastikan:
- Lokasi konsisten (jangan lompat tanpa alasan)
- Orang yang sama (jangan ganti karakter)
- Color grade konsisten
- KEY OBJECT tidak boleh diulang kecuali ada perubahan emosional

LANGKAH 3 — PILIH SHOT TYPE berdasarkan konten narasi:
- Ada banyak orang / lokasi baru → WIDE
- Ada aksi atau gestur spesifik → MEDIUM
- Ada satu objek atau detail kecil yang bermakna → CLOSEUP
- JANGAN pilih shot type berdasarkan pola — pilih berdasarkan isi

════════════════════════════════════
RULE TERPENTING — WAJIB DIIKUTI SEBELUM MENULIS APAPUN:
════════════════════════════════════
Baca narasi. Apakah ada kata aktivitas manusia?
Contoh kata aktivitas: ngobrol, ketawa, makan, duduk, jalan,
nyanyi, nangis, peluk, lihat, diem, senyum, cerita, dengerin.

Kalau ADA kata aktivitas manusia:
→ people_in_frame WAJIB berisi deskripsi orang yang melakukan aktivitas itu
→ people_in_frame TIDAK BOLEH "no people" atau "focus on object"
→ shot_type WAJIB "medium" atau "wide"
→ shot_type TIDAK BOLEH "closeup"
→ Prompt WAJIB mendeskripsikan orang tersebut secara visual:
   posisi tubuh, ekspresi, gestur, pakaian, apa yang sedang dilakukan

Kalau TIDAK ADA kata aktivitas (narasi tentang objek/tempat/waktu):
→ Boleh no people
→ Boleh closeup
→ Fokus ke objek atau atmosfer

CONTOH BENAR:
Narasi: "Dalam obrolan ringan, hati kembali berdetak"
→ Ada aktivitas: "obrolan" → WAJIB ada orang
→ shot_type: "medium"
→ people_in_frame: "Two people sitting across each other at a small warung table, 
   leaning slightly forward, one laughing softly while the other smiles, 
   both relaxed and engaged in conversation"
→ Prompt: scene dua orang ngobrol, ekspresi hangat, gesture natural

Narasi: "Hingga malam menjelang, kata-kata tak pernah habis"
→ Ada aktivitas: "kata-kata tak pernah habis" = masih ngobrol → WAJIB ada orang
→ shot_type: "wide" atau "medium"
→ people_in_frame: "Two people still sitting at the warung as night falls,
   the lamp above them glowing warmer now, both leaning in closer,
   gesturing occasionally, laughing at something"
→ Prompt: suasana malam di warung, dua orang masih ngobrol, lampu kuning hangat

CONTOH SALAH:
Narasi: "Dalam obrolan ringan, hati kembali berdetak"
→ shot_type: "closeup" ← SALAH
→ people_in_frame: "no people, focus on iced tea glass" ← SALAH

LANGKAH 4 — TULIS PROMPT minimum 80 kata.
Prompt harus menjawab:
- Siapa ada di frame, posisi mereka, apa yang mereka lakukan
- Lokasi spesifik dengan detail atmosferik
- Cahaya dari mana, jam berapa, cuaca
- Gerakan kamera yang bermakna
- Objek spesifik yang featured

OUTPUT — VALID JSON ONLY:
{
  "prompt": "Full cinematic English prompt (min 80 words)",
  "shot_type": "WIDE/MEDIUM/CLOSEUP",
  "location": "Nama lokasi spesifik",
  "detected_mood": "Emosi spesifik",
  "color_grade": "Style warna spesifik",
  "people_in_frame": "Deskripsi siapa saja yang ada di frame",
  "key_object": "Objek utama yang jadi fokus"
}
`;

  const allScenesContext = allScenes
    .map((s, i) => `Scene ${i}: "${s}"`)
    .join('\n');

  const previousContext = previousResults.length > 0
    ? previousResults
      .map((r, i) => `Scene ${i} → shot: ${r.shot_type}, location: ${r.location}, mood: ${r.detected_mood}, color: ${r.color_grade}, key_object: ${r.key_object || 'none'}`)
      .join('\n')
    : 'Ini adalah scene pertama.';

  const usedKeyObjects = previousResults
    .map(r => r.key_object)
    .filter(obj => obj && obj.trim().length > 0 && obj !== 'none');

  const usedObjectsWarning = usedKeyObjects.length > 0
    ? `\nOBJEK YANG SUDAH DIPAKAI DI SCENE SEBELUMNYA (JANGAN DIULANG):\n${usedKeyObjects.map((o, i) => `- Scene ${i}: ${o}`).join('\n')}\nPilih objek atau detail visual yang BERBEDA untuk scene ini.`
    : '';

  const charactersContext = charactersPresent && charactersPresent.length > 0
    ? `Karakter dalam cerita ini: ${charactersPresent.join(', ')}`
    : 'Tidak ada karakter spesifik yang disebutkan.';

  const peopleContext = scenePeople && scenePeople !== 'no people'
    ? `Phase 1 mendeteksi orang dalam scene ini: ${scenePeople}`
    : 'Scene ini tidak memerlukan orang dalam frame.';

  // FIX 2: Inject character visual profiles yang sudah terkunci
  const characterConsistencyBlock = buildCharacterConsistencyPrompt(characterProfiles);

  // FIX 4: Inject established location
  const locationConsistencyBlock = buildLocationConsistencyPrompt(previousResults);

  const userMessage = `
FULL USER STORY (baca untuk konteks emosi dan detail spesifik):
"${userStory}"

════════════════════════════════════
SEMUA SCENE DALAM VIDEO INI (${allScenes.length} scene total):
${allScenesContext}

Scene yang sedang kamu kerjakan sekarang: Scene ${sceneIndex}
Narasi scene ini: "${sceneNarasi}"
════════════════════════════════════

VISUAL YANG SUDAH DIBUAT DI SCENE SEBELUMNYA:
${previousContext}

${locationConsistencyBlock}

════════════════════════════════════
KARAKTER DALAM CERITA INI:
${charactersContext}

ORANG YANG HARUS ADA DI SCENE INI (dari analisis Phase 1):
${peopleContext}

${characterConsistencyBlock}

WAJIB CEK SEBELUM SUBMIT:
Apakah deskripsi fisik karakter di prompt kamu PERSIS SAMA dengan profile di atas?
Kalau tidak → tulis ulang sampai sama.

════════════════════════════════════
TUGASMU — VISUALISASI SCENE ${sceneIndex + 1} dari ${allScenes.length}
════════════════════════════════════

NARASI YANG HARUS DIVISUALISASI:
"${sceneNarasi}"

PERTANYAAN YANG HARUS KAMU JAWAB DULU:
1. Narasi ini literally tentang apa? Siapa? Di mana? Melakukan apa?
2. Ada kata konkret apa? (nama tempat, benda, aksi)
3. Apakah ada orang dalam momen ini?
   - Kalau narasi bilang "dia masih inget" → ada DUA orang
   - Kalau narasi bilang "aku sendiri" → ada SATU orang
   - Kalau narasi tentang objek → boleh no people TAPI harus ada alasan kuat
4. Apa yang JANGAN dilakukan:
   - JANGAN buat scene kaset/mobil kalau narasi tidak menyebut kaset/mobil
   - JANGAN buat scene warung kalau narasi tidak di warung
   - JANGAN gunakan metafora visual yang tidak ada dalam narasi
   - JANGAN ulangi key_object dari scene sebelumnya

${usedObjectsWarning}

Sekarang tulis prompt berdasarkan jawaban pertanyaan di atas.
Shot type, camera, lighting — kamu yang tentukan sesuai konten.
`;

  try {
    const parsed = await callQwen(systemPrompt, userMessage, 'qwen-max');

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Response bukan object valid');
    }

    if (!parsed.prompt || typeof parsed.prompt !== 'string' || parsed.prompt.length < 20) {
      throw new Error('Field prompt kosong atau terlalu pendek');
    }

    console.log(`\n[PHASE 1.5] Scene ${sceneIndex} Rewrite SUCCESS:`);
    console.log(`  Story context : ${userStory.substring(0, 60)}...`);
    console.log(`  Narasi asli   : ${sceneNarasi}`);
    console.log(`  Shot type     : ${parsed.shot_type}`);
    console.log(`  People        : ${parsed.people_in_frame}`);
    console.log(`  Location      : ${parsed.location}`);
    console.log(`  Key object    : ${parsed.key_object}`);
    console.log(`  Key detail    : ${parsed.key_detail}`);
    console.log(`  Mood          : ${parsed.detected_mood}`);
    console.log(`  Emotional truth: ${parsed.emotional_truth}`);
    console.log(`  Camera        : ${parsed.camera_movement}`);
    console.log(`  Color grade   : ${parsed.color_grade}`);
    console.log(`  Prompt (80w+) : ${parsed.prompt}\n`);

    return parsed;

  } catch (e) {
    console.error(`[PHASE 1.5] Scene ${sceneIndex} rewrite FAILED:`, e.message);
    console.log(`[PHASE 1.5] Using fallback for scene ${sceneIndex}`);

    const shotType = sceneIndex === 0 ? 'wide' :
      sceneIndex === 1 ? 'medium' : 'closeup';

    const storyKeywords = userStory
      .split(/[.,!?\n]/)
      .filter(s => s.trim().length > 10)
      .slice(0, 2)
      .join(', ');

    return {
      prompt: `Cinematic ${shotType} shot, ${storyKeywords}, 
               ${sceneNarasi}, 
               ${sceneIndex === 0
          ? 'wide establishing shot, subject small in environment, negative space intentional'
          : sceneIndex === 1
            ? 'medium shot, specific quiet human action, background tells story'
            : 'extreme close-up, one meaningful object or detail, unexpected but perfect'
        },
               back of subject never facing camera directly,
               atmospheric specific location,
               slow deliberate camera movement,
               film grain texture, cinematic color grade,
               anamorphic lens, no text, no subtitles,
               photorealistic, high production value`,
      shot_type: shotType,
      people_in_frame: 'subject from behind',
      camera_movement: 'slow deliberate',
      lighting: 'natural atmospheric',
      location: 'atmospheric location from story',
      key_object: '',
      key_detail: sceneNarasi,
      detected_mood: 'nostalgic',
      color_grade: 'warm teal and orange cinematic',
      emotional_truth: sceneNarasi
    };
  }
}

// ── PHASE 1.6: Inner Voice Generation ─────────────────────────
async function qwenGenerateInnerVoice(userStory, allScenes, cinematicResults, charactersPresent) {
  const systemPrompt = `
Kamu adalah penulis skenario yang ahli dalam "inner monologue" — 
suara hati karakter yang terdengar saat adegan berlangsung, 
mulut tidak bergerak, tapi penonton mendengar pikiran terdalam mereka.

ATURAN SUARA HATI:
- Bukan dialog (bukan "dia bilang ke orang lain")
- Bukan narasi cerita (bukan "dan kemudian...")
- Adalah pikiran yang belum diucapkan, perasaan yang tersimpan
- Bahasa Indonesia sehari-hari, terasa natural dan manusiawi
- Max 10 kata per scene
- Boleh berupa pertanyaan dalam hati, kalimat menggantung, atau satu kata kuat

CONTOH BENAR (dari cerita Raka-Dira di kafe):
Scene: Raka dateng duluan, pesan dua americano
→ Suara hati: "Dia masih suka americano kan?"

Scene: Dira masuk dengan rambut pendek baru  
→ Suara hati: "Dia potong rambutnya. Tanpa kasih tau aku."

Scene: Raka dorong americano ke arah Dira
→ Suara hati: "Semoga dia masih mau nerima ini."

Scene: Dira nanya 'waktu itu kamu pergi kenapa'
→ Suara hati Dira: "Ini pertanyaan yang udah aku simpan setahun."

Scene: Raka pegang cangkir lama banget
→ Suara hati: "Aku ga tau harus mulai dari mana."

CONTOH SALAH:
✗ "Perasaan itu hadir kembali seperti ombak" — terlalu puitis/narasi
✗ "Aku menyukaimu sejak dulu" — terlalu eksplisit/dialog
✗ "Kenangan masa lalu mengalir" — generik, tidak spesifik

OUTPUT JSON:
{
  "inner_voices": [
    { "scene_index": 0, "character": "nama karakter", "voice": "suara hati max 10 kata" },
    { "scene_index": 1, "character": "nama karakter", "voice": "suara hati max 10 kata" },
    ...
  ]
}
`;

  const userMessage = `
CERITA USER:
"${userStory}"

KARAKTER DALAM CERITA: ${charactersPresent.join(', ')}

SEMUA SCENE (${allScenes.length} scene):
${allScenes.map((narasi, i) => `Scene ${i}: "${narasi}"`).join('\n')}

VISUAL YANG SUDAH DIBUAT:
${cinematicResults.map((r, i) => r ? `Scene ${i}: shot=${r.shot_type}, people=${r.people_in_frame}` : `Scene ${i}: skipped`).join('\n')}

Tulis suara hati untuk setiap scene.
Pilih karakter yang paling relevan dengan momen scene tersebut.
Suara hati harus terasa seperti pikiran yang belum diucapkan, 
bukan komentar tentang adegan.
`;

  try {
    const result = await callQwen(systemPrompt, userMessage, 'qwen-max', 0.8);
    const voices = result.inner_voices || [];

    // Return object { scene_index: "voice text" }
    const voiceMap = {};
    voices.forEach(iv => {
      voiceMap[iv.scene_index] = iv.voice;
      console.log(`[PHASE 1.6] Scene ${iv.scene_index} (${iv.character}): "${iv.voice}"`);
    });
    return voiceMap;
  } catch (e) {
    debugLog(`[PHASE 1.6] Inner voice generation failed: ${e.message}`);
    return {};
  }
}

// ── PHASE 1.7: Poetic Subtitles ──────────────────────────────
async function qwenPoeticSubtitle(userStory, allNarasi, detectedMood) {
  const systemPrompt = `
Kamu adalah penyair Indonesia dan penulis sastra kontemporer.
Tugasmu: Ubah narasi literal menjadi subtitle puitis yang indah,
tapi TETAP terhubung dengan momen spesifik dalam cerita.

FILOSOFI:
Subtitle bukan menjelaskan adegan — subtitle adalah perasaan yang 
muncul saat adegan berlangsung. Seperti puisi yang muncul sekilas 
lalu hilang.

ATURAN SASTRA:
- Max 12 kata per subtitle
- Boleh tidak berupa kalimat lengkap — penggalan lebih kuat
- Gunakan kata konkret yang puitis (bukan kata abstrak generik)
- Hindari: "perasaan", "kenangan", "waktu", "hati", "cinta" langsung
  → Ganti dengan benda/aksi yang merepresentasikannya
- Boleh pakai majas: personifikasi, sinekdok, metafora benda konkret

TEKNIK SASTRA YANG BOLEH DIPAKAI:
1. Sinekdok (bagian mewakili keseluruhan)
   "dua americano" → "dua cangkir yang tidak pernah cukup satu"
2. Personifikasi objek
   "kursi itu masih ingat cara mereka duduk"
3. Kontras diam-ribut
   "ribut di kepala, diam di meja"  
4. Kalimat tergantung yang menggantung
   "kalau saja waktu itu..."
5. Repetisi bermakna
   "masih di sini. masih."

CONTOH TRANSFORMASI (mood: melankolis, kerinduan):

Narasi literal → Subtitle sastra:

"Raka dateng ke kafe itu duluan"
→ "ia tiba lebih dulu — seperti biasanya"

"Dia pesen dua americano — satu buat Dira"  
→ "dua cangkir. satu untuk seseorang yang belum tentu datang."

"Dira masuk dengan rambut pendek yang baru"
→ "ada yang berubah. lebih dari sekadar rambut."

"Dira naruh tasnya di kursi sebelah, bukan di pangkuan"
→ "tasnya di kursi sebelah — bukan di pangkuan. jarak itu ada namanya."

"Raka dorong americano ke arah Dira"
→ "ia dorong pelan. seperti mengajukan pertanyaan tanpa suara."

"Dira langsung minum tanpa nanya"
→ "dia minum. tanpa bertanya. berarti masih ingat."

"Dira nanya 'waktu itu kamu pergi kenapa'"
→ "pertanyaan yang sudah menunggu setahun."

"Raka pegang cangkirnya lama banget"
→ "cangkir itu lebih mudah dipegang daripada jawaban."

"Raka jawab 'karena aku tau kamu bakal minta'"
→ "karena aku tahu. dan aku takut."

"Dira ga ngomong apa-apa, tapi ga pergi"
→ "diam yang memilih untuk tinggal."

OUTPUT JSON:
{
  "poetic_subtitles": [
    { "scene_index": 0, "original": "narasi asli", "poetic": "subtitle sastra" },
    { "scene_index": 1, "original": "narasi asli", "poetic": "subtitle sastra" },
    ...
  ]
}
`;

  const userMessage = `
CERITA USER (untuk konteks emosi):
"${userStory}"

MOOD TERDETEKSI: ${detectedMood}

NARASI YANG HARUS DIUBAH JADI SASTRA:
${allNarasi.map((n, i) => `Scene ${i}: "${n}"`).join('\n')}

Ubah setiap narasi jadi subtitle puitis.
Jaga koneksi dengan momen spesifik — jangan terlalu abstrak sampai kehilangan konteks scene.
Gunakan mood "${detectedMood}" sebagai warna emosi.
`;

  try {
    const result = await callQwen(systemPrompt, userMessage, 'qwen-max', 0.85);
    const subtitles = result.poetic_subtitles || [];

    // Map ke object { scene_index: poetic_text }
    const poeticMap = {};
    subtitles.forEach(s => {
      poeticMap[s.scene_index] = s.poetic;
      console.log(`[PHASE 1.7] Scene ${s.scene_index}: "${s.original}" → "${s.poetic}"`);
    });

    return poeticMap;
  } catch (e) {
    debugLog(`[PHASE 1.7] Poetic subtitle failed: ${e.message}`);
    return {}; // fallback ke narasi original
  }
}

// ── ADEGAN Controller ────────────────────────────────────────
exports.adegan = async (req, res) => {
  const { text, videoType = 'sinematik', images = [] } = req.body;
  debugLog(`ADEGAN REQUEST: text="${text?.substring(0, 30)}..." type=${videoType} images=${images.length}`);
  if (!text) return res.status(400).json({ error: 'Teks kosong.' });

  const videoTypeConfig = {
    sinematik: {
      tagline: "Rasamu jadi film",
      style: "Hyper-realistic cinematic 4K footage, dramatic professional lighting, shallow depth of field, film grain texture, anamorphic lens flares, movie quality",
      audio_gen: (mood) => `cinematic ${mood} orchestra, professional sound design`,
      mood_guide: "dramatic, emotional, cinematic",
      max_scenes: 10,
      has_vo: true,
      // FIX 3: voice sinematik = Indonesia
      voice: 'longanyang',
      tts_lang: 'id'
    },
    anime: {
      tagline: "Ceritamu jadi anime",
      style: "High-quality modern anime animation, cel-shaded characters, vibrant emotional colors, cinematic anime composition, expressive art style",
      audio_gen: (mood) => {
        const moodMap = {
          happy: "Upbeat J-Pop high-energy anime opening theme, bright synthesizers and electric guitar, catchy",
          sad: "Emotional piano and violin anime OST, Studio Ghibli style, melancholic and beautiful symphony",
          thoughtful: "Lo-fi anime aesthetic beat, chill japanese instrumental, nostalgic lofi hip-hop",
          angry: "Intense orchestral battle anime OST, heavy percussion and dramatic strings, heroic cinematic",
          romantic: "Soft orchestral romance anime theme, magical strings and delicate bells, sparkling"
        };
        return (moodMap[mood] || `Iconic anime OST ${mood}, japanese instrumental style`) + ", high quality music";
      },
      mood_guide: "expressive, dramatic, anime-style emotional",
      max_scenes: 8,
      has_vo: true,
      voice: 'loongstella',
      tts_lang: 'ja'
    }
  };

  const config = videoTypeConfig[videoType] || videoTypeConfig.sinematik;
  const isAnime = videoType === 'anime';

  const modeDirectives = {
    sinematik: "Mode 'RASAMU JADI FILM'. Interpretasi visual bebas & sinematik. Fokus pada depth of field dan cinematic lighting.",
    anime: "Mode 'CERITAMU JADI ANIME'. Visual anime modern, cel-shaded. Karakter harus mewakili emosi user."
  };

  const systemPrompt = `Kamu adalah Sutradara Film yang mengubah cerita personal menjadi naskah video sinematik.

DIREKTIF MODE: ${modeDirectives[videoType] || ""}
${isAnime ? `
ATURAN KHUSUS ANIME:
- Field "narasi" WAJIB bahasa Indonesia
- Field "narasi_jp" WAJIB bahasa Jepang (untuk voice over)
- Dialog ekspresif seperti anime` : ''}

════════════════════════════════════
LANGKAH 1 — BACA CERITA USER DULU
════════════════════════════════════
Sebelum menulis apapun, baca cerita user dan catat:
- Berapa jumlah kalimat? (kalimat = diakhiri . ? !)
- Siapa saja orangnya?
- Di mana lokasinya?
- Benda apa saja yang disebutkan secara eksplisit?
- Aksi apa saja yang terjadi secara fisik?

════════════════════════════════════
LANGKAH 2 — TENTUKAN JUMLAH SCENE
════════════════════════════════════
HITUNG kalimat dulu, BARU tentukan scene:

1-2 kalimat  → TEPAT 4 scene
3-5 kalimat  → TEPAT 6 scene
6-9 kalimat  → TEPAT 9 scene
10+ kalimat  → TEPAT 12 scene

WAJIB tepat. Tidak boleh kurang, tidak boleh lebih.
PENTING: Jumlah object di array "scenes" HARUS SAMA PERSIS dengan nilai "total_scene".
Jangan deklarasi total_scene: 12 tapi hanya tulis 9 scenes.
Setiap scene WAJIB punya field "narasi" yang terisi — tidak boleh null atau kosong.
Tulis jumlah kalimat yang kamu hitung di field "sentence_count".

════════════════════════════════════
LANGKAH 3 — CARA MEMBUAT NARASI
════════════════════════════════════
Narasi = subtitle yang muncul di layar. Max 12 kata.

PROSES WAJIB untuk setiap narasi:
1. Ambil satu kalimat dari cerita user
2. Ekstrak SATU FAKTA LITERAL dari kalimat itu
   (nama orang, nama tempat, nama benda, atau aksi fisik yang disebutkan)
3. Tulis sebagai narasi max 12 kata
4. CEK WAJIB: Bisakah narasi ini ditulis oleh orang yang BELUM membaca cerita user?
   → Kalau BISA ditulis tanpa baca cerita = narasi SALAH, terlalu generik
   → Kalau TIDAK BISA ditulis tanpa baca cerita = narasi BENAR

CONTOH CEK (dari cerita warung kopi):

NARASI SALAH — bisa ditulis tanpa baca cerita:
✗ "Kenangan mengalir seperti waktu"
✗ "Dalam keheningan, hati bicara"
✗ "Es teh tawar, ingatan yang tak pudar"
✗ "Saat malam turun, kata-kata terakhir mengisi keheningan"
✗ "Tempat yang sama, kenangan hidup kembali"

NARASI BENAR — tidak bisa ditulis tanpa baca cerita:
✓ "Dia dateng duluan, udah pesan es teh dua"
✓ "Es tehnya tawar — dia masih inget aku ga suka manis"
✓ "Kursi rotan yang goyang kalau didudukkin"
✓ "Lagu Sheila on 7 yang entah kenapa selalu muter"
✓ "Dia bilang hati-hati dengan cara yang sama persis kayak dulu"
✓ "Aku noleh sekali di ujung gang — dia masih berdiri"

POLA YANG HARUS DIIKUTI:
- Narasi mengandung nama/benda/tempat/aksi SPESIFIK dari cerita
- Boleh pakai bahasa percakapan seperti aslinya
- Boleh kutip langsung kata-kata user kalau memang kuat
- JANGAN parafrase jadi metafora
- JANGAN tambahkan makna yang tidak ada di kalimat aslinya

════════════════════════════════════
LANGKAH 4 — DETEKSI OTOMATIS
════════════════════════════════════
DETEKSI MUSIK:
Apakah ada nama lagu atau artis dalam cerita?
→ Ada: catat di "music_reference" (contoh: "Sheila on 7")
→ Tidak ada: isi null

DETEKSI KARAKTER:
Catat semua orang yang disebutkan di "characters_present".
Untuk setiap scene, tulis di field "people":
→ Ada orang: "siapa, berapa, sedang apa"
→ Tidak ada: "no people — [alasan sinematik konkret]"

GAYA VISUAL: ${config.style}

════════════════════════════════════
FORMAT JSON OUTPUT — WAJIB PERSIS INI
════════════════════════════════════
{
  "sentence_count": <integer — jumlah kalimat yang kamu hitung>,
  "detected_mood": "sad/angry/happy/thoughtful/romantic",
  "characters_present": ["daftar karakter"],
  "music_reference": "nama artis/lagu atau null",
  "music_vibe": "deskripsi vibe musik dalam bahasa Inggris, max 10 kata",
  "total_scene": <integer — HARUS sesuai tabel di Langkah 2>,
  "total_durasi": <integer detik>,
  "scenes": [
    {
      "visual": "deskripsi visual konkret dari cerita",
      "narasi": "WAJIB bahasa Indonesia — dilarang pakai bahasa Inggris (max 12 kata), mengandung detail spesifik dari cerita",
      "narasi_jp": "narasi bahasa Jepang untuk anime mode",
      "prompt_wan": "English prompt untuk Wan AI",
      "people": "siapa yang ada di scene ini atau 'no people — [alasan]'",
      "durasi": <integer 10-15>
    }
  ]
}

════════════════════════════════════
LARANGAN KERAS SEBELUM SUBMIT:
════════════════════════════════════
- DILARANG menulis total_scene: 12 tapi hanya mengisi 6 elemen di array scenes.
- DILARANG meninggalkan field narasi kosong, null, atau string "undefined".
- WAJIB: hitung dulu berapa scene yang akan ditulis → tulis angka itu di total_scene → baru isi array scenes dengan jumlah PERSIS SAMA.
- CEK WAJIB sebelum submit: apakah panjang array scenes == nilai total_scene? Kalau tidak sama, perbaiki dulu.
`;
  if (!ALIBABA_API_KEY) return res.json(getMockAdegan(text, videoType, 'auto', '30'));

  const jobIds = [];
  const voiceAudios = [];
  let innerVoiceMap = {};
  let poeticSubtitleMap = {};

  try {
    const script = await callQwen(systemPrompt, text, QWEN_MODEL, 0.3);

    // FIX 1: Filter scenes dengan narasi undefined/kosong
    if (script.scenes) {
      const beforeFilter = script.scenes.length;
      script.scenes = script.scenes.filter(s => s.narasi && s.narasi !== 'undefined' && s.narasi.trim().length > 0);
      const afterFilter = script.scenes.length;
      if (beforeFilter !== afterFilter) {
        console.log(`[PHASE 1] Filtered ${beforeFilter - afterFilter} scene(s) dengan narasi undefined`);
      }
    }

    debugLog(`Script OK, detected mood: ${script.detected_mood || 'unknown'}`);

    // BUG 2 & 3 Fix: Paksa sinkronisasi total_scene
    const validSceneCount = script.scenes?.length || 0;
    if (script.total_scene !== validSceneCount) {
      console.log(`[PHASE 1] Syncing total_scene: ${script.total_scene} -> ${validSceneCount}`);
      script.total_scene = validSceneCount;
    }

    console.log(`[PHASE 1] sentence_count: ${script.sentence_count}`);
    debugLog(`Total scene: ${script.total_scene || script.scenes?.length || 0}`);
    debugLog(`Total durasi: ${script.total_durasi || 0} detik`);
    debugLog(`Characters: ${(script.characters_present || []).join(', ') || 'none'}`);
    console.log(`\n[SCRIPT] ${script.scenes?.length} scene, ${script.total_durasi}s total`);
    console.log(`[SCRIPT] Characters: ${(script.characters_present || []).join(', ') || 'tidak ada'}\n`);

    if (script.scenes) {
      const allNarasi = script.scenes.map(s => s.narasi);
      const charactersPresent = script.characters_present || [];
      const cinematicResults = [];

      // FIX 2: Init character profiles
      const characterProfiles = buildCharacterProfiles(charactersPresent);

      debugLog(`[PHASE 1.5] Total scene: ${script.scenes.length}, Characters: ${charactersPresent.join(', ') || 'none'}`);

      for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];

        // BUG 2 Fix: Guard narasi undefined
        if (!scene.narasi || scene.narasi === 'undefined' || scene.narasi.trim().length === 0) {
          debugLog(`[PHASE 1.5] Skipping scene ${i + 1} — narasi empty/undefined`);
          cinematicResults.push(null);
          continue;
        }

        debugLog(`[PHASE 1.5] Processing scene ${i + 1}/${script.scenes.length}: "${scene.narasi?.substring(0, 40)}..."`);
        debugLog(`[PHASE 1.5] People in this scene: ${scene.people || 'not specified'}`);

        const result = await qwenRewriteToCinematic(
          text,
          scene.narasi,
          i,
          videoType,
          allNarasi,
          cinematicResults,
          scene.people || '',
          charactersPresent,
          characterProfiles  // FIX 2: pass profiles
        );
        cinematicResults.push(result);

        // FIX 2: Update profiles dari hasil scene ini
        updateCharacterProfiles(characterProfiles, result.people_in_frame, charactersPresent);

        console.log(`[PHASE 1.5] Scene ${i + 1}/${script.scenes.length} done. Shot: ${result.shot_type}, People: ${result.people_in_frame}`);
      }
      // ── PHASE 2: Sequential TTS & Sequential Wan Video Submission ──────────────────
      debugLog(`[PHASE 2] Starting sequential TTS and Wan submission...`);

      // PHASE 1.6 — Generate suara hati
      console.log('[PHASE 1.6] Generating inner voices...');
      innerVoiceMap = await qwenGenerateInnerVoice(
        text,
        allNarasi,
        cinematicResults,
        charactersPresent
      );

      console.log(`[PHASE 1.6] Generated ${Object.keys(innerVoiceMap).length} inner voices`);

      // PHASE 1.7 — Generate subtitle sastra
      console.log('[PHASE 1.7] Generating poetic subtitles...');
      poeticSubtitleMap = await qwenPoeticSubtitle(
        text,
        allNarasi,
        script.detected_mood || 'melancholic'
      );

      // Update narasi di setiap scene dengan versi sastra
      script.scenes.forEach((scene, i) => {
        if (poeticSubtitleMap[i]) {
          scene.narasi_original = scene.narasi;     // simpan asli
          scene.narasi = poeticSubtitleMap[i];       // ganti ke sastra
        }
      });

      console.log('[PHASE 1.7] Poetic subtitles applied');

      // 1. Sequential TTS with delay to avoid rate limits
      for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const ttsVoice = config.voice || 'longanyang';
        const ttsLanguage = config.tts_lang || 'id';

        if (scene.narasi && config.has_vo) {
          try {
            // FITUR BARU 1: Pakai suara hati kalau ada, fallback ke narasi
            const innerVoiceText = innerVoiceMap[i];
            const ttsText = innerVoiceText
              ? innerVoiceText
              : (videoType === 'anime' && scene.narasi_jp)
                ? scene.narasi_jp
                : scene.narasi;

            console.log(`[TTS] Scene ${i}: "${ttsText}" (${innerVoiceText ? 'inner voice' : 'narasi'})`);
            let audioBuffer = await callTTS(ttsText, ttsVoice, ttsLanguage);

            if (!audioBuffer && videoType === 'anime') {
              audioBuffer = await callTTS(ttsText, 'loongstella', 'ja');
            }

            if (audioBuffer && audioBuffer.length > 0) {
              voiceAudios.push(Buffer.from(audioBuffer).toString('base64'));
              debugLog(`TTS scene ${i + 1} OK (${audioBuffer.length} bytes)`);
            } else {
              voiceAudios.push(null);
            }
          } catch (ttsErr) {
            debugLog(`TTS scene ${i} failed: ${ttsErr.message}`);
            voiceAudios.push(null);
          }
        } else {
          voiceAudios.push(null);
        }

        // Delay antar TTS request untuk hindari rate limit (2.0s ultra safe)
        if (i < script.scenes.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 2. Submit Wan Video jobs sequentially (to avoid overwhelming API/rate limits)
      for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const cinematicData = cinematicResults[i];

        // BUG 2 Fix: Guard missing cinematicData
        if (!cinematicData) {
          debugLog(`[PHASE 2] Skipping scene ${i + 1} — missing cinematic data`);
          jobIds.push(`skip_${Date.now()}_${i}`);
          continue;
        }

        const sceneImg = null;
        const sceneDuration = scene.durasi || 10;
        const clampedDuration = Math.min(15, Math.max(10, sceneDuration));
        const wanPrompt = cinematicData.prompt || scene.prompt_wan || scene.narasi;

        debugLog(`Wan Video [${i + 1}]: submitting dur=${clampedDuration}s...`);
        let jobId = await callWanVideo(wanPrompt, clampedDuration, sceneImg, videoType, characterProfiles);

        if (jobId) {
          jobIds.push(jobId);
          debugLog(`Wan Video job ${i + 1} submitted: ${jobId}`);
        } else {
          jobIds.push(`fail_` + Date.now());
          debugLog(`Wan Video job ${i + 1} FAILED`);
        }

        // Small delay between submissions to be polite to the API
        if (i < script.scenes.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // 3. Collect all TTS results - This line is no longer needed as voiceAudios is populated sequentially
      debugLog(`[PHASE 2] All tasks completed.`);
    }

    res.json({
      ...script,
      videoType,
      audioPrompt: config.audio_gen ? config.audio_gen(script.detected_mood || 'thoughtful') : config.audio,
      music_reference: script.music_reference || null,
      music_vibe: script.music_vibe || null,
      jobIds,
      voiceAudios,
      innerVoices: innerVoiceMap || {},
      status: 'processing',
    });
  } catch (err) {
    debugLog(`ADEGAN CATCH FULL: ${err.stack}`);
    console.error('Adegan Controller Error FULL STACK:\n', err.stack);
    res.status(500).json({ error: err.message });
  }
};

// ── Helper: Character Database Logic ────────────────────────
function assignCharactersFromDB(characters) {
  try {
    const dbPath = path.join(__dirname, '../database/characters.json');
    if (!fs.existsSync(dbPath)) {
      debugLog('Character DB not found, skipping enrichment.');
      return characters;
    }

    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const malePool = [...db.colors.male_pool];
    const femalePool = [...db.colors.female_pool];

    let maleIdx = 0;
    let femaleIdx = 0;

    return characters.map(char => {
      const gender = char.gender?.toLowerCase() === 'female' ? 'female' : 'male';
      const base = db.characters.find(c => c.gender === gender);

      char.base_image = base ? base.base_image : (gender === 'female' ? '/public/avatars/blob_female.png' : '/public/avatars/blob_male.png');

      if (gender === 'female') {
        char.color_hex = femalePool[femaleIdx % femalePool.length];
        char.hue = (femaleIdx * 137) % 360;
        femaleIdx++;
      } else {
        char.color_hex = malePool[maleIdx % malePool.length];
        char.hue = (maleIdx * 137) % 360;
        maleIdx++;
      }

      if (!Array.isArray(char.accessories)) char.accessories = [];
      const vibeKeyStr = char.vibe || '';
      const vibeKeys = vibeKeyStr.toLowerCase().split(',').map(k => k.trim());

      const name = char.name?.toLowerCase() || '';
      const parentKeywords = ['ayah', 'bapak', 'papa', 'dad', 'ibu', 'mama', 'mom', 'nenek', 'kakek'];
      const foundParent = parentKeywords.find(k => name.includes(k));

      if (foundParent) {
        if (['ayah', 'bapak', 'papa', 'dad', 'kakek'].includes(foundParent)) {
          if (db.accessories.ayah && !char.accessories.find(a => a.id === 'ayah')) char.accessories.push(db.accessories.ayah);
        } else {
          if (db.accessories.ibu && !char.accessories.find(a => a.id === 'ibu')) char.accessories.push(db.accessories.ibu);
        }
      }

      for (const key of vibeKeys) {
        if (db.accessories[key] && char.accessories.length < 3) {
          if (!char.accessories.find(a => a.id === db.accessories[key].id)) {
            char.accessories.push(db.accessories[key]);
          }
        }
      }

      return char;
    });
  } catch (err) {
    debugLog(`Error in assignCharactersFromDB: ${err.message}`);
    return characters;
  }
}

// ── GHIBAH Controller ────────────────────────────────────────
exports.ghibah = async (req, res) => {
  const { text, avType, format, tone, userPhotos = [] } = req.body;
  debugLog(`GHIBAH REQUEST: format=${format} tone=${tone} avType=${avType} photos=${userPhotos.length}`);

  if (!text) return res.status(400).json({ error: 'Teks kosong.' });

  try {
    if (!ALIBABA_API_KEY) {
      debugLog("ALIBABA_API_KEY missing - returning mock data");
      return res.json(getMockGhibah(text, format));
    }
    const isDrama = format === 'drama';

    const scriptPrompt = `You are an expert Content Producer for "Studio Ghibah".
Task: Turn the user's story into a viral ${format.toUpperCase()} script.
JSON ONLY output with fields: "judul_konten", "hashtags", "characters", "scenes", "dialogs".

[STYLE DIRECTIVES]:
- 100% Literal Story: Stick strictly to the user's provided story topic, names, and specific details. If they mention "Si Udin", use "Si Udin". If they mention "TikTok", incorporate it.
- NO GENERIC NAMES: Do not use default names like Alex/Jamie unless the user provided them.
- Format: ${isDrama ? 'Drama Jalanan (Tekotok style animated blobs)' : 'Podcast/Roasting'}.
- Language: ALWAYS use Indonesian for the "text" field in dialogs. The user wants the content in Indonesian.
- Characters: 2-3 characters. Use "blob" characters.
- Scenes: 3-5 scenes. "location", "background_prompt" (MUST specify an EMPTY scene with NO PEOPLE).
- Dialogs: 15-20 lines. Emotional, engaging, and funny. 
  * "charId", "text" (MUST BE IN INDONESIAN), "emotion" (Happy, Sad, Angry, Shocked, Flat, Teasing).
  * "sceneIndex": integer.
  * "camera_shot": MUST be one of [wide_shot, close_up, reaction_shot, two_shot]. Use strategically for drama.
  * "prop": If the dialog mentions an object (phone, coffee, money, etc.), specify it here (e.g., "smartphone", "coffee_cup"). Otherwise empty string.

JSON ONLY:
{
  "judul_konten": "...",
  "characters": [ { "id": "char1", "name": "...", "gender": "male", "vibe": "...", "voice_id": "longanyang", "color_hex": "#..." } ],
  "scenes": [ { "location": "...", "background_prompt": "EMPTY [location] background, minimalist flat cartoon vector, NO PEOPLE, NO CHARACTERS", "charIds": ["char1", "char2"] } ],
  "dialogs": [ { "charId": "char1", "text": "...", "emotion": "Angry", "camera_shot": "close_up", "prop": "...", "sceneIndex": 0 } ]
}

[AUDIO GUIDANCE]:
- YOU MUST use Indonesian-compatible Voice IDs: longanyang (male), longwan (male), loongstella (female/anime), loongma (female).
- Indonesian is MANDATORY for the "text" field.`;

    const script = await callQwen(scriptPrompt, text);

    let finalScript = script;
    if (!script.characters && script.script) finalScript = script.script;
    else if (!script.characters && script.data) finalScript = script.data;

    if (!finalScript || !finalScript.characters || !finalScript.dialogs) {
      debugLog("CRITICAL: Qwen script structure invalid. Falling back to mock.");
      console.log("Invalid AI Structure:", JSON.stringify(script).substring(0, 300));
      return res.json(getMockGhibah(text, format));
    }
    const script_to_use = finalScript;

    debugLog(`Script generated: ${script_to_use.characters.length} characters, ${script_to_use.dialogs.length} lines.`);

    const enrichedCharacters = assignCharactersFromDB(script_to_use.characters);
    script_to_use.characters = enrichedCharacters;
    const characters = script_to_use.characters;
    const jobIds = [];

    if (isDrama && script_to_use.scenes) {
      debugLog(`Generating visuals for ${script_to_use.scenes.length} scenes (staggered parallel)...`);
      const scenePromises = script_to_use.scenes.map(async (s, sIdx) => {
        await new Promise(r => setTimeout(r, sIdx * 2500));

        const bgResult = await callQwenImage(s.background_prompt + ", flat minimalist cartoon style, vibrant, simple, solid colors", 'horizontal');
        s.background_url = bgResult.localUrl || null;

        const sceneChars = characters.filter(c => s.charIds.includes(c.id));
        const primaryChar = sceneChars[0];

        let seedImg = null;
        if (primaryChar) {
          if (primaryChar.avatar_url?.startsWith('data:image')) {
            seedImg = primaryChar.avatar_url;
          } else if (primaryChar.avatar_url?.startsWith('http')) {
            seedImg = primaryChar.avatar_url;
          } else if (primaryChar.base_image) {
            try {
              const fs = require('fs');
              const path = require('path');
              const targetPath = path.join(__dirname, '..', '..', primaryChar.base_image);
              if (fs.existsSync(targetPath)) {
                const buff = fs.readFileSync(targetPath);
                seedImg = 'data:image/png;base64,' + buff.toString('base64');
              }
            } catch (e) { }
          }
        }

        const videoPrompt = `EMPTY background scene of ${s.location}. STYLE: flat simple 2D vector illustration, vibrant colors, clean thick line art, Tekotok style. ABSOLUTELY NO PEOPLE, NO CHARACTERS, NO BLOBS, NO HUMANS, NO ANIMALS. Only the static environment. ABSOLUTELY NO TEXT, NO SUBTITLES, NO CAPTIONS, NO LOGOS.`;

        const useI2V = sceneChars.length === 1 && seedImg;
        const sceneDialogs = script_to_use.dialogs.filter(d => d.sceneIndex === sIdx);
        const estimatedDuration = Math.round(Math.min(15, Math.max(5, sceneDialogs.length * 2.5)));

        debugLog(`Submitting scene video: ${s.location} (Chars: ${sceneChars.length}, Dur: ${estimatedDuration}s)... Mode: ${useI2V ? 'I2V' : 'T2V'}`);
        const vjobId = await callWanVideo(videoPrompt, estimatedDuration, useI2V ? seedImg : null, 'drama_jalanan');
        if (vjobId) {
          s.video_job_id = vjobId;
          return vjobId;
        }
        return null;
      });

      const results = await Promise.all(scenePromises);
      results.filter(id => id).forEach(id => jobIds.push(id));
    }

    const characterVideos = {};
    if (isDrama) {
      debugLog("Phase 2.1: Generating character emotion videos (Wan I2V)...");
      const emotionPairs = [];
      const seenPairs = new Set();

      script_to_use.dialogs.forEach(d => {
        const emo = d.emotion || 'Flat';
        const key = `${d.charId}_${emo}`;
        if (!seenPairs.has(key)) {
          emotionPairs.push({ charId: d.charId, emotion: emo });
          seenPairs.add(key);
        }
      });

      debugLog(`Found ${emotionPairs.length} unique character-emotion pairs to animate.`);

      const emoJobs = [];
      for (let i = 0; i < emotionPairs.length; i++) {
        const { charId, emotion } = emotionPairs[i];
        const char = characters.find(c => c.id === charId);
        if (!char) continue;

        const baseImgPath = char.base_image || (char.gender === 'female' ? '/public/avatars/blob_female.png' : '/public/avatars/blob_male.png');
        let seedImg = null;
        try {
          const fs = require('fs');
          const path = require('path');
          const fullPath = path.join(__dirname, '..', '..', baseImgPath);
          if (fs.existsSync(fullPath)) {
            const buff = fs.readFileSync(fullPath);
            seedImg = 'data:image/png;base64,' + buff.toString('base64');
          }
        } catch (e) { }

        const prompts = {
          'Happy': 'cute blob character, happy expression, bouncing and waving, cartoon animation, smooth movement, expressive',
          'Angry': 'cute blob character, angry expression, shaking and pointing, cartoon animation, expressive gestures',
          'Shocked': 'cute blob character, shocked expression, jumping back surprised, cartoon animation, big eyes, expressive',
          'Sad': 'cute blob character, sad expression, drooping and sighing, cartoon animation, slow movement',
          'Flat': 'cute blob character, neutral expression, subtle idle bobbing, cartoon animation, natural movement'
        };
        const emoPrompt = prompts[emotion] || prompts['Flat'];

        debugLog(`Submitting I2V for ${char.name} (${emotion})...`);
        const vjobId = await callWanVideo(emoPrompt, 5, seedImg, 'drama_jalanan');
        if (vjobId) {
          emoJobs.push({ charId, emotion, jobId: vjobId, url: null });
          jobIds.push(vjobId);
        } else {
          debugLog(`Failed to submit I2V for ${char.name} (${emotion}), will use fallback.`);
        }

        if (i < emotionPairs.length - 1) await new Promise(r => setTimeout(r, 1500));
      }

      characterVideos.emoJobs = emoJobs;
    }

    const dialogs = script_to_use.dialogs;
    const processedDialogs = [];
    for (let i = 0; i < dialogs.length; i++) {
      const d = dialogs[i];
      const char = characters.find(c => c.id === d.charId);
      if (!char) { processedDialogs.push({ ...d, audio_base64: null }); continue; }
      try {
        const rawVoice = char.voice_id?.toLowerCase() || 'longanyang';
        const mappedVoice = VOICE_MAP[rawVoice] || (char.gender === 'female' ? 'loongma' : 'longanyang');
        debugLog(`TTS for ${char.name}: text="${d.text.substring(0, 20)}..." voice=${mappedVoice} (mapped from ${rawVoice})`);
        const audioBuffer = await callTTS(d.text, mappedVoice, 'id');
        processedDialogs.push({
          ...d,
          audio_base64: audioBuffer ? Buffer.from(audioBuffer).toString('base64') : null
        });
      } catch (e) { processedDialogs.push({ ...d, audio_base64: null }); }
      await new Promise(r => setTimeout(r, 1000));
    }

    res.json({
      ...script_to_use,
      dialogs: processedDialogs,
      characterVideos,
      format,
      jobIds,
      status: 'processing'
    });

  } catch (err) {
    debugLog(`GHIBAH CATCH ERROR: ${err.stack || err.message}`);
    console.error('Ghibah Controller Error:', err);
    res.status(500).json({ error: 'Gagal memproses AI: ' + err.message });
  }
};

// ── IMAGE PROXY Controller ────────────────────────────────────
exports.imageProxy = async (req, res) => {
  try {
    const searchPart = 'url=';
    const rawUrl = req.originalUrl.includes(searchPart)
      ? req.originalUrl.substring(req.originalUrl.indexOf(searchPart) + searchPart.length)
      : (req.query.url || '');

    if (!rawUrl) return res.status(400).send('Missing url param');

    const decoded = decodeURIComponent(rawUrl);

    if (decoded.startsWith('/public') || decoded.startsWith('/uploads')) {
      const fs = require('fs');
      const path = require('path');
      const fullPath = path.join(__dirname, '..', '..', decoded);

      if (fs.existsSync(fullPath)) {
        console.log(`Image proxy local: ${fullPath}`);
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = ext === '.png' ? 'image/png' : (ext === '.mp4' ? 'video/mp4' : 'image/jpeg');
        res.set('Content-Type', contentType);
        return fs.createReadStream(fullPath).pipe(res);
      } else {
        console.warn(`Local file missing for proxy: ${fullPath}`);
        return res.status(404).send('Local file not found');
      }
    }

    if (!decoded.startsWith('http')) {
      return res.status(400).send('Invalid URL format');
    }

    console.log(`Image proxy fetch: ${decoded.substring(0, 80)}...`);
    const proxyHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };

    if (decoded.includes('aliyuncs.com')) {
      delete proxyHeaders['Referer'];
    }

    if (decoded.includes('pollinations.ai')) {
      proxyHeaders['Referer'] = 'https://pollinations.ai/';
      proxyHeaders['Accept'] = 'image/webp,image/*,*/*';
    }

    const response = await axios.get(decoded, {
      responseType: 'stream',
      timeout: 300000,
      headers: proxyHeaders
    });

    const contentType = response.headers['content-type'] || (decoded.includes('.mp4') ? 'video/mp4' : 'image/jpeg');
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  } catch (e) {
    console.error('Image proxy error:', e.response?.status, e.message);
    res.status(502).send('Image fetch failed');
  }
};

// ── VOICE Controller ─────────────────────────────────────────
exports.voice = async (req, res) => {
  const { text, voice = 'alloy' } = req.body;

  try {
    if (!ALIBABA_API_KEY) throw new Error('No API Key');
    const audioBuffer = await callTTS(text, voice);

    if (!audioBuffer) {
      return res.status(204).send();
    }

    res.set({ 'Content-Type': 'audio/mpeg' });
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('Voice Route Error:', err.message);
    res.status(204).send();
  }
};

// ── LUKISAN Controller ───────────────────────────────────────
exports.lukisan = async (req, res) => {
  const { text, artStyle = 'ekspresionisme', orientation = 'horizontal' } = req.body;

  if (!text) return res.status(400).json({ error: 'Teks kosong.' });

  const artStyleMap = {
    ekspresionisme: {
      en: 'expressive oil painting with strong visible brushstrokes, vibrant high-contrast colors, swirling light movement, deep emotional energy, textured impasto',
      id: 'Ekspresif (Warna kuat, sapuan kuas hidup)'
    },
    realistis: {
      en: 'realistic fine art painting, natural soft lighting, delicate details, smooth textures, balanced composition, handcrafted traditional painting aesthetic',
      id: 'Realistis (Detail halus, pencahayaan natural)'
    },
    kubisme: {
      en: 'modern geometric art, fragmented forms and shapes, unique multi-perspective composition, bold artistic outlines, abstract structural beauty',
      id: 'Geometris (Bentuk dipecah, perspektif unik)'
    },
    renaisans: {
      en: 'classical grand masterpiece, dramatic lighting and shadows, majestic composition, deep rich colors, historical museum quality, powerful human presence',
      id: 'Klasik (Megah, dramatis, penuh keagungan)'
    },
    abstrak: {
      en: 'pure abstract expressionism, non-representational flowing colors and organic shapes, freedom of form, raw emotional color fields, modern art mystery',
      id: 'Abstrak (Bebas, murni ekspresi warna & perasaan)'
    },
    anime: {
      en: 'stunning anime-style illustration, clean line art, vibrant colorful aesthetics, cinematic lighting, modern Japanese art style, expressive characters',
      id: 'Anime Art (Bersih, colorful)'
    },
    pixel: {
      en: 'retro 16-bit pixel art, nostalgic classic gaming aesthetic, sharp square pixels, vibrant limited color palette, detailed digital craftsmanship',
      id: 'Pixel Art (Retro, nostalgik)'
    },
    flat: {
      en: 'modern flat illustration, clean minimalist vector art, bold solid color fields, professional graphic design style, contemporary poster aesthetic',
      id: 'Ilustrasi Flat (Minimalis, modern)'
    }
  };

  const selectedStyle = artStyleMap[artStyle] || artStyleMap.ekspresionisme;
  const size = orientation === 'vertical' ? '768*1024' : '1024*768';

  if (!ALIBABA_API_KEY) return res.json(getMockLukisan(text, artStyle, orientation));

  try {
    const qwenSys = `Kamu adalah seniman AI dan kurator lukisan kelas dunia.
    Tugas: Buat konsep lukisan yang menangkap ESENSI EMOSI dari cerita user.
    
    ATURAN KRUSIAL:
    1. Cerita dan perasaan user adalah KONTEN UTAMA lukisan.
    2. Gaya seni (${selectedStyle.id}) hanyalah MEDIUM visual, bukan tema utama.
    3. Hindari meniru pelukis spesifik secara kaku. Fokus pada VIBE visual: ${selectedStyle.en}.
    4. Pastikan hasil lukisan terasa personal dan relevan dengan curhatan user.

    JSON ONLY:
    {
      "judul": "Judul puitis lukisan (Bhs Indonesia, max 6 kata)",
      "deskripsi": "Deskripsi singkat visual lukisan ini (Bhs Indonesia, 2 kalimat)",
      "prompt_image": "Ultra-detailed English prompt for ${selectedStyle.en}. Integrate the user's story content into this style's characteristics. Focus on mood, lighting, and composition.",
      "interpretasi": "Narasi puitis dan kontemplatif (Bhs Indonesia, 2-3 kalimat). Mulai dengan sesuatu seperti 'Sekilas lukisan ini terasa...', lalu ungkap makna emosional terdalam dari lukisan ini."
    }`;

    const artConcept = await callQwen(qwenSys, text);
    console.log('Art concept OK:', artConcept.judul);

    const artPrompt = `${artConcept.prompt_image}, ${selectedStyle.en}, masterpiece, museum quality fine art`;
    const imageResult = await callQwenImage(artPrompt, orientation);

    res.json({
      judul: artConcept.judul,
      deskripsi: artConcept.deskripsi,
      interpretasi: artConcept.interpretasi,
      artStyle: selectedStyle.id,
      orientation,
      taskId: null,
      image_url: imageResult.localUrl,
      status: imageResult.localUrl ? 'ready' : 'failed',
    });
  } catch (err) {
    debugLog(`LUKISAN CATCH: ${err.message}`);
    console.error('Lukisan Catch:', err);
    res.json(getMockLukisan(text, artStyle, orientation));
  }
};

// ── STATUS Check ─────────────────────────────────────────────
exports.status = async (req, res) => {
  const { id } = req.params;

  if (!ALIBABA_API_KEY || id.startsWith('demo_') || id.startsWith('fail_')) {
    return res.json({ status: 'FAILED', progress: 0, video_url: null, image_url: null });
  }

  try {
    let r;
    try {
      r = await axios.get(
        `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${id}`,
        { headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` }, timeout: 10000 }
      );
    } catch (e) {
      if (e.message.includes('socket') || e.message.includes('hang up')) {
        debugLog(`Retrying status check for ${id} after hang up...`);
        r = await axios.get(
          `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${id}`,
          { headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` }, timeout: 15000 }
        );
      } else { throw e; }
    }
    const output = r.data.output;
    if (output.task_status === 'FAILED') {
      debugLog(`Task FAILED [${id}]: ${JSON.stringify(output)}`);
    } else {
      debugLog(`Task status [${id}]: ${output.task_status}`);
    }
    res.json({
      status: output.task_status,
      progress: output.task_status === 'SUCCEEDED' ? 100 : 50,
      video_url: output.video_url || null,
      image_url: output.results?.[0]?.url || null,
      error_code: output.code || null,
      message: output.message || null
    });
  } catch (err) {
    debugLog(`Status check failed for ${id}: ${err.message}`);
    console.error(`Status check failed for ${id}:`, err.message);
    res.status(500).json({ error: 'Status check failed' });
  }
};

// ── MERGE Controller ──────────────────────────────────────────
exports.merge = async (req, res) => {
  const { videoUrls } = req.body;

  if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
    return res.status(400).json({ error: 'Video URLs are required.' });
  }

  try {
    debugLog(`MERGE REQUEST: ${videoUrls.length} videos`);
    const mergedUrl = await mergeVideos(videoUrls);
    res.json({ status: 'SUCCEEDED', video_url: mergedUrl });
  } catch (err) {
    debugLog(`MERGE ERROR: ${err.message}`);
    console.error('Merge Controller Error:', err);
    res.status(500).json({ error: 'Failed to merge videos.' });
  }
};

// ── MOCK DATA ─────────────────────────────────────────────────
function getMockAdegan(text, style, mood, duration) {
  const scenes = [
    {
      visual: 'Siluet dua sosok di bawah lampu jalan malam, rintik hujan mulai turun, cahaya oranye menciptakan bayangan panjang di aspal basah.',
      narasi: 'Ada perasaan yang terlalu lama disimpan sendirian...',
      prompt_wan: `cinematic silhouette two people under street lamp, rain, orange light, wet asphalt, ${style}, ${mood}`,
      durasi: 5,
    },
    {
      visual: 'Close-up tangan yang hampir menyentuh tangan lain — jarak satu sentimeter yang terasa satu kilometer. Waktu seolah berhenti.',
      narasi: 'Dan ketika akhirnya berani terucap...',
      prompt_wan: `close-up hands almost touching, dramatic lighting, cinematic, emotional, ${style}`,
      durasi: 5,
    },
    {
      visual: 'Satu sosok berjalan menjauh perlahan, tidak menoleh. Hujan semakin deras. Layar perlahan gelap.',
      narasi: 'Ternyata keberanian itu datang terlambat.',
      prompt_wan: `person walking away in rain, slow motion, cinematic fade to black, ${mood}, ${style}`,
      durasi: 5,
    },
  ];
  return { scenes, judul: 'Terlambat', mood_detected: mood, status: 'demo_mode', jobIds: [] };
}

function getMockLukisan(text, artStyle, orientation) {
  return {
    judul: 'Bisikan Waktu yang Hilang',
    deskripsi: 'Sebuah sosok berdiri di persimpangan kenangan dan harapan, diterangi cahaya emas yang pudar.',
    interpretasi: 'Sekilas lukisan ini terasa asing, hampir tidak bisa dimengerti. Tapi coba perhatikan bagian tengahnya — ada cahaya yang hampir padam, tapi tidak pernah benar-benar mati. Itulah yang ingin dikatakan karya ini padamu: bahwa di tengah semua yang terasa gelap, ada satu titik yang bertahan.',
    artStyle: artStyle,
    orientation,
    taskId: 'demo_mock',
    image_url: null,
    status: 'demo_mode',
  };
}

function getMockGhibah(text, format = 'drama') {
  const mockCharacters = [
    {
      id: "char1",
      name: "Budi (Ayah)",
      gender: "male",
      vibe: "ayah",
      color_hex: "#3498db",
      voice_id: "sam",
      emotion_default: "Flat",
      base_image: "/public/avatars/blob_male.png",
      accessories: [{ id: "mustache", name: "Kumis dan Peci" }]
    },
    {
      id: "char2",
      name: "Siti",
      gender: "female",
      vibe: "gaul",
      color_hex: "#f1c40f",
      voice_id: "mia",
      emotion_default: "Flat",
      base_image: "/public/avatars/blob_female.png",
      accessories: [{ id: "glasses", name: "Kacamata Tebal" }]
    }
  ];
  return {
    characters: mockCharacters,
    format: format,
    judul_konten: 'Drama Mendoan Anget vs Krupuk',
    scenes: [
      { location: "Warung", background_prompt: "Simple warung background illustration", charIds: ["char1", "char2"], background_url: null }
    ],
    dialogs: [
      { charId: 'char1', text: 'Mendoan anget itu kasta tertinggi gorengan, Sit.', emotion: 'Happy', sceneIndex: 0 },
      { charId: 'char2', text: 'Tapi krupuk kaleng itu kesetiaan yang hakiki.', emotion: 'Flat', sceneIndex: 0 },
      { charId: 'char1', text: 'Setia tapi kalau melempem ditinggalin juga kan?', emotion: 'Angry', sceneIndex: 0 },
      { charId: 'char2', text: 'Dih, dalem banget ya...', emotion: 'Shocked', sceneIndex: 0 }
    ],
    status: 'demo_mode',
    jobIds: []
  };
}