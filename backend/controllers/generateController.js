const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { mergeVideos } = require('../utils/merge-util');
const { debugLog } = require('../utils/logger');
const taskManager = require('../utils/task-manager');

const { ALIBABA_API_KEY: ENV_ALIBABA_API_KEY, QWEN_MODEL: ENV_QWEN_MODEL, WAN_MODEL: ENV_WAN_MODEL, TTS_MODEL: ENV_TTS_MODEL } = process.env;

debugLog('Server controller loaded');

const COSMY_VOICE_ID = process.env.COSMY_VOICE_ID || 'cosyvoice-v1';

// DASH SCOPE VOICE MAPPING (Indonesian-compatible)
const VOICE_MAP = {
  // Male
  'sam': 'longanyang',
  'ray': 'longwan',
  'george': 'longwan',
  'tom': 'longanyang',
  'kevin': 'longwan',
  'bapak': 'longanyang',
  'bapa': 'longanyang',
  'ayah': 'longwan',
  'male': 'longanyang',
  'longanyang': 'longanyang',
  'longwan': 'longwan',
  // Female
  'beth': 'loongma',
  'betty': 'loongma',
  'bella': 'loongstella',
  'anne': 'loongstella',
  'ibu': 'loongma',
  'mama': 'loongma',
  'female': 'loongma',
  'loongstella': 'loongstella',
  'loongma': 'loongma'
};

function getVoiceForCharacter(charName, charactersPresent) {
  if (!charName) return 'longanyang';

  const name = charName.toLowerCase();

  // Check if name is in VOICE_MAP directly
  if (VOICE_MAP[name]) return VOICE_MAP[name];

  // Basic gender detection based on common ID names or prefixes
  const femalePrefixes = ['ibu', 'mama', 'nenek', 'kak', 'mbak', 'nona', 'putri', 'dira', 'beth', 'bella', 'anne'];
  const malePrefixes = ['bapak', 'ayah', 'kakek', 'mas', 'bang', 'bung', 'pangeran', 'raka', 'sam', 'ray', 'george', 'tom', 'kevin'];

  if (femalePrefixes.some(p => name.includes(p))) return 'loongma';
  if (malePrefixes.some(p => name.includes(p))) return 'longanyang';

  return 'longanyang'; // Default
}

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

  const size = orientation === 'vertical' ? '720*1280' : '1280*720';

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
    const status = e.response?.status;
    const data = e.response?.data;
    console.error(`Qwen Image failed [${status}]:`, data ? JSON.stringify(data) : e.message);
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
          resolution: '1080P',
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
    { "scene_index": 0, "character_name": "nama karakter", "voice_text": "suara hati dalam bahasa Indonesia, max 10 kata" },
    { "scene_index": 1, "character_name": "nama karakter", "voice_text": "suara hati dalam bahasa Indonesia, max 10 kata" }
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

    // Return object { scene_index: { character: "name", text: "voice text" } }
    const voiceMap = {};
    voices.forEach(iv => {
      voiceMap[iv.scene_index] = {
        character: iv.character_name,
        text: iv.voice_text
      };
      console.log(`[PHASE 1.6] Scene ${iv.scene_index} (${iv.character_name}): "${iv.voice_text}"`);
    });
    return voiceMap;
  } catch (e) {
    debugLog(`[PHASE 1.6] Inner voice generation failed: ${e.message}`);
    return {};
  }
}

// ── ADEGAN Controller (V1 - STABLE) ───────────────────────────
exports.adegan = async (req, res) => {
  const { text, videoType = 'sinematik' } = req.body;
  debugLog(`ADEGAN V1 REQUEST: type=${videoType} text="${text?.substring(0, 30)}..."`);

  if (!text) return res.status(400).json({ error: 'Teks kosong.' });

  const videoTypeConfig = {
    sinematik: {
      style: "Cinematic film, high quality, 4k, hyper-realistic, dramatic lighting, shallow depth of field, professional color grading, mood: cinematic",
      audio: "Cinematic orchestral ambient, atmospheric, high quality, mood: cinematic",
      audio_gen: (mood) => `Cinematic orchestral ${mood} theme, atmospheric, professional movie score, high quality`,
      max_scenes: 12,
      has_vo: true,
      voice: 'longwan',
      tts_lang: 'id'
    },
    anime: {
      style: "High-end modern anime style, Makoto Shinkai aesthetics, vibrant colors, expressive character animation, detailed backgrounds, mood: emotional",
      audio: "Upbeat japanese lofi anime music, chill and emotional, high quality",
      audio_gen: (mood) => {
        const moodMap = {
          sad: "Emotional piano anime theme, melancholic strings, high quality",
          happy: "Upbeat j-pop instrumental, energetic anime theme, high quality",
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

  const systemPrompt = ` GAYA VISUAL: ${config.style}

════════════════════════════════════
TASK: BATCH VIDEO SCRIPTING (ALL-IN-ONE)
════════════════════════════════════
Tugasmu adalah menghasilkan seluruh kebutuhan script video dalam SATU RESPONS JSON.
Kamu harus melakukan Breakdown Cerita, Cinematic Rewriting, Inner Voice (Suara Hati), dan Poetic Subtitles secara simultan.

LANGKAH 1 — BREAKDOWN & SCENE ALLOCATION:
1-2 kalimat  → 4 scene
3-5 kalimat  → 6 scene
6-9 kalimat  → 9 scene
10+ kalimat  → 12 scene

LANGKAH 2 — CINEMATIC REWRITING (PROMPT WAN AI):
Untuk setiap scene, tulis "prompt_wan" (Bahasa Inggris, min 80 kata).
- Harus "Show Don't Tell".
- Konsistensi Karakter: Gunakan deskripsi fisik yang sama persis jika karakter muncul lagi.
- Konsistensi Lokasi: Jangan ganti lokasi tanpa alasan narasi.
- Shot Type: Gunakan WIDE untuk intro/lokasi baru, MEDIUM untuk aksi, CLOSEUP untuk detail emosional.

LANGKAH 3 — INNER VOICE (SUARA HATI karakters):
Tulis "inner_voice" untuk SETIAP scene (Bahasa Indonesia, max 10 kata).
- Ini adalah pikiran karakter yang tidak diucapkan.
- Mouth NOT moving.

LANGKAH 4 — POETIC SUBTITLES:
Tulis "subtitle" (Bahasa Indonesia, max 12 kata).
- Ubah narasi literal menjadi penggalan puitis yang indah.
- Gunakan metafora konkret.

FORMAT JSON OUTPUT:
{
  "sentence_count": <int>,
  "detected_mood": "sad/happy/etc",
  "characters_present": ["nama"],
  "total_scene": <int>,
  "scenes": [
    {
      "prompt_wan": "English prompt (80w+)...",
      "subtitle": "Subtitle puitis (Indo)...",
      "inner_voice": "Suara hati (Indo)...",
      "character_voice": "Nama karakter yang bicara di hati (atau null)",
      "shot_type": "WIDE/MEDIUM/CLOSEUP",
      "durasi": 10
    }
  ]
}
`;
  if (!ALIBABA_API_KEY) return res.json(getMockAdegan(text, videoType, 'auto', '30'));

  const jobIds = [];
  const voiceAudios = [];
  let innerVoiceMap = {};
  let poeticSubtitleMap = {};

  try {
    let script;
    if (req.body.existingScript) {
      script = req.body.existingScript;
      debugLog(`[CACHE] Skipping Qwen Phase: Using existing script to save tokens.`);
    } else {
      const selectedModel = req.body.model || QWEN_MODEL;
      debugLog(`[PHASE 1] Generating script using model: ${selectedModel}`);
      script = await callQwen(systemPrompt, text, selectedModel, 0.5);
      if (!script || !script.scenes) throw new Error('AI gagal menghasilkan naskah batch.');
      debugLog(`[PHASE 1] Batch Script OK, scenes: ${script.scenes.length}`);
    }

    if (script.scenes) {
      // 1. Sequential TTS
      for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        if (scene.inner_voice && config.has_vo) {
          try {
            const ttsVoice = scene.character_voice
              ? getVoiceForCharacter(scene.character_voice, script.characters_present)
              : (config.voice || 'longanyang');

            debugLog(`[TTS] Scene ${i}: "${scene.inner_voice}" using ${ttsVoice}`);
            const audioBuffer = await callTTS(scene.inner_voice, ttsVoice, config.tts_lang || 'id');

            if (audioBuffer && audioBuffer.length > 0) {
              voiceAudios.push(Buffer.from(audioBuffer).toString('base64'));
            } else {
              voiceAudios.push(null);
            }
          } catch (e) {
            voiceAudios.push(null);
          }
          if (i < script.scenes.length - 1) await new Promise(r => setTimeout(r, 1500));
        } else {
          voiceAudios.push(null);
        }
      }

      // 2. Submit Wan Video jobs (1080p)
      for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const wanPrompt = scene.prompt_wan || 'A cinematic scene';
        const jobId = await callWanVideo(wanPrompt, 10, null, videoType);
        jobIds.push(jobId || `fail_${Date.now()}`);
        if (i < script.scenes.length - 1) await new Promise(r => setTimeout(r, 1000));
      }
    }

    res.json({
      ...script,
      videoType,
      audioPrompt: config.audio_gen ? config.audio_gen(script.detected_mood || 'thoughtful') : config.audio,
      music_reference: script.music_reference || null,
      music_vibe: script.music_vibe || null,
      jobIds,
      voiceAudios,
      innerVoices: script.scenes?.map(s => ({ character: s.character_voice, text: s.inner_voice })) || [],
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
// ── GHIBAH Controller (V1 - STABLE) ───────────────────────────
exports.ghibah = async (req, res) => {
  const { text, avType, format, tone, userPhotos = [] } = req.body;
  debugLog(`GHIBAH V1 REQUEST: format=${format} tone=${tone} avType=${avType} photos=${userPhotos.length}`);

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
    debugLog(`GHIBAH V1 CATCH ERROR: ${err.stack || err.message}`);
    console.error('Ghibah V1 Controller Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── VIDEO CLEANUP Controller ──────────────────────────────────
exports.cleanupVideo = async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'Missing videoUrl' });

  try {
    const filename = videoUrl.split('/').pop();
    const filePath = path.join(__dirname, '../../public/uploads', filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      debugLog(`[CLEANUP] Deleted file: ${filename}`);
      res.json({ success: true, message: `Deleted ${filename}` });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (e) {
    debugLog(`[CLEANUP] Error: ${e.message}`);
    res.status(500).json({ error: e.message });
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
      en: 'Emotional Expressionism, distorted reality for emotional effect, thick impasto brushstrokes, palette knife textures, intense non-naturalistic colors, high contrast, psychological depth, masterpiece style of Edvard Munch or Vincent van Gogh',
      id: 'Ekspresionisme Jiwa (Tekstur tebal, warna emosional, distorsi bermakna)'
    },
    realistis: {
      en: 'Master Cinematic Photography, shot on Phase One XF IQ4 150MP, 85mm f/1.2 prime lens, medium format look, hyper-realistic 8K resolution, detailed skin pores and textures, realistic rim lighting, golden hour backlight, sharp focus, cinematic HDR color grading, uncompressed high-fidelity detail, professional editorial quality',
      id: 'Realisme Sinematik 8K (Detail kamera profesional & pencahayaan mahakarya)'
    },
    kubisme: {
      en: 'Analytical Synthetic Cubism, pure polygonal assembly, zero realistic textures, every object (human, sand, water) constructed from flat-shaded polygons and interlocking planes, vibrant flat color fields, bold heavy outlines, zero photographic lighting, vector-like artistic construction, total medium immersion',
      id: 'Kubisme Murni (Konstruksi poligon total, tanpa tekstur nyata, estetika vektor/kaca patri)'
    },
    renaisans: {
      en: 'A textured oil painting masterpiece, Baroque and Renaissance fine-art medium, rich visible brushstrokes, high-contrast chiaroscuro, narrative symbolism, classical academic realism, sfumato blending, no photographic elements, inspired by Rembrandt and Caravaggio',
      id: 'Klasik Mahakarya (Lukisan Minyak Maestro, Chiaroscuro & Simbolisme)'
    },
    abstrak: {
      en: 'Abstract Lyricism, fluid organic shapes, energetic splatter and drips, thick textured paint layers, symbolic color fields, non-representational emotional landscape, urban contemporary art aesthetic',
      id: 'Abstrak Jiwa (Bentuk bebas, energi murni, luapan perasaan)'
    },
    anime: {
      en: 'Professional 2D Cel-Shaded Anime Illustration, high-fidelity hand-drawn aesthetic, bold clean lineart, flat-shading with subtle gradients, Makoto Shinkai ethereal sky and lighting, Studio Ghibli atmospheric depth, zero photographic textures, no 3D rendering, vibrant cinematic 2D colors',
      id: 'Anime 2D Cel-Shaded (Gaya Shinkai & Ghibli, Lineart bersih & warna vibran)'
    },
    pixel: {
      en: 'Contemporary Pixel Noir, detailed 32-bit sprite work, atmospheric lighting effects, limited moody palette, nostalgic yet sophisticated retro aesthetic, clean professional pixel clusters',
      id: 'Pixel Art Master (Retro-modern yang atmosferik)'
    },
    flat: {
      en: 'Modern Minimalist Illustration, Bauhaus aesthetic, bold vector shapes, textured paper grain, sophisticated limited palette, conceptual visual metaphor, clean contemporary poster style',
      id: 'Flat Modern (Minimalis konseptual & estetika poster)'
    }
  };

  const selectedStyle = artStyleMap[artStyle] || artStyleMap.ekspresionisme;
  const size = orientation === 'vertical' ? '720*1280' : '1280*720';

  if (!ALIBABA_API_KEY) return res.json(getMockLukisan(text, artStyle, orientation));

  try {
    // Branching Persona and Construction Rules based on style
    let persona = 'Master Fine-Art Painter (Avant-Garde)';
    let styleSpecificRules = '';

    if (artStyle === 'realistis') {
      persona = 'World-Class Director and Master Photographer';
      styleSpecificRules = `1. FULL NARRATIVE REALIZATION: Depict the ENTIRE story (characters, environment, actions) in a single frame with 8K cinematic detail.
         2. TECHNICAL SUPREMACY: Use Phase One XF IQ4 150MP hardware specs, 85mm f/1.2 prime lens, and Medium Format aesthetic.
         3. MASTER LIGHTING: Focus on RAW uncompressed textures, sharp rim lighting, and realistic caustic reflections on water. ZERO digital smoothing.`;
    } else if (artStyle === 'kubisme') {
      persona = 'Avant-Garde Constructivist Painter';
      styleSpecificRules = `1. PURE POLYGON CONSTRUCTION: Every element (characters, sand, water, sun) MUST be rendered as interlocking geometric planes and sharp polygons.
         2. ANTI-HYBRID RULE: NO realistic textures, NO skin pores, NO photographic light. Every pixel must be a polygonal medium.`;
    } else if (artStyle === 'ekspresionisme') {
      persona = 'Haunted Soulful Expressionist Painter';
      styleSpecificRules = `1. RADICAL VISUAL METAPHORS: Forbid literal depictions. Every object must be a psychological symbol. E.g., if it's about joy, the figures' limbs must stretch into rays of light; if it's about water, the waves must be swirling eyes or emotional vortexes. REJECT REALITY.
         2. BEYOND HUMAN ANATOMY: Distort, melt, and transform the human form to represent the SOUL. Use visual metaphors like melting heads, glowing features, or bodies dissolving into the environment.
         3. MASTER IMPASTO: Use heavy, thick palette knife textures and raw, energetic brushstrokes. The canvas must feel tactile.
         4. COLOR PSYCHOLOGY: Use non-naturalistic, intense colors assigned to emotions (e.g., searing orange for energy, cold deep blue for depth).`;
    } else if (artStyle === 'anime') {
      persona = 'Anime Studio Lead Artist and Master Illustrator';
      styleSpecificRules = `1. PURE 2D MEDIUM: Every frame must be a hand-drawn 2D illustration. Absolutely FORBID all photographic textures, skin pores, and real-world lighting.
         2. MASTER LINEART: Use bold, clean, and consistent lineart for all characters and foreground objects.
         3. CEL-SHADING: Use flat-shading (cel-shading) with 2-3 levels of shadow depth. No complex 3D gradients on characters.
         4. ETHEREAL ATMOSPHERE: Use Makoto Shinkai-inspired lighting (lens flares, glowing horizons, vibrant skies) but keep the character rendering purely 2D.`;
    } else if (artStyle === 'renaisans') {
      persona = 'Renaissance & Baroque Master Painter';
      styleSpecificRules = `1. TOTAL PAINTING IMMERSION: Every pixel must be a visible oil-on-canvas texture with rich pigments and master brushwork. FORBID all photographic concepts (bokeh, focal length, ISO, 8K).
         2. CHIAROSCURO & DRAMA: Use extreme high-contrast lighting (Tenebrism) to create deep, soulful shadows and dramatic volume.
         3. ALLEGORICAL NARRATIVE: Do not just draw the story literally. Use narrative symbolism and allegorical figures (e.g., a person of joy represented as a light-bringer, or a calm sea as an infinite mirror of the soul).
         4. ACADEMIC PRECISION: Focus on perfect classical anatomy and sophisticated sfumato blending. The final output must look like a museum masterpiece from 1650.`;
    } else {
      styleSpecificRules = `1. TOTAL STYLE IMMERSION: Transform the entire scene into the medium: ${selectedStyle.en}.
         2. NO PHOTOGRAPHY: Absolutely no realistic backgrounds or depth-of-field effects.`;
    }

    const qwenSys = `You are a ${persona}. 
    Your mission: Translate the user's FULL NARRATIVE into a single, cohesive masterpiece in the style of: ${selectedStyle.en}.

    STRICT CONSTRUCTION RULES (NON-NEGOTIABLE):
    ${styleSpecificRules}
    4. NUCLEAR ZERO-TEXT RULE: Absolutely NO text, letters, characters, numbers, signatures, titles, names, "Sunset Dreams", "In the Moment", "Golden Hour", "Ephemera", "Moment of Stillness", or style labels. Typography is a CRITICAL FAILURE. Any word, letter, or watermark inside the image is a disease that MUST be killed.
    5. NO UNCANNY EXPRESSIONS: Use realistic, un-posed expressions. Forbid exaggerated grins.
    6. IMAGE PROMPT IS PURE VISUALS: 'prompt_image' must be a purely descriptive English paragraph. Describe ONLY textures, lighting, anatomy, and physical actions. 
       - FORBIDDEN: NO quotes (" "), NO titles, NO naming of themes (e.g., do not say "represents Ephemera" or use the phrase "Moment of Stillness").
       - ACTION: Convert all concepts into PURE VISUALS (e.g., instead of "peace", describe "limbs relaxed, eyes closed, soft lighting").

    JSON OUTPUT ONLY:
    {
      "judul": "A grand poetic title (Indonesian, max 5 words)",
      "deskripsi": "A powerful scene description (Indonesian, 1-2 sentences)",
      "prompt_image": "Ultra-detailed PURE VISUAL English prompt. Describe the FULL story actions using ONLY the unique logic and medium textures of: ${selectedStyle.en}. ZERO photographic or polygonal terms unless explicitly allowed for the style.",
      "interpretasi": "The psychological message and DECODING of visual metaphors used (e.g., explain the meaning of melting objects, glowing features, or symbolic colors) in Indonesian (2-3 sentences)."
    }`;

    const artConcept = await callQwen(qwenSys, text);
    console.log('Art concept OK:', artConcept.judul);

    // Final hardening: Strip all quoted phrases and thematic labels from the prompt to prevent text rendering
    let artPrompt = artConcept.prompt_image;

    // Remove anything inside quotes (e.g., "Moment of Stillness")
    artPrompt = artPrompt.replace(/"[^"]*"/g, '');

    // Remove keywords that often trigger text leakage
    const forbiddenLabels = [/Ephemera/gi, /Stillness/gi, /Moment/gi, /Sunset/gi, /Dreams/gi, /togetherness/gi];
    forbiddenLabels.forEach(pattern => {
      artPrompt = artPrompt.replace(pattern, '');
    });

    debugLog(`--- GENERATED PROMPT ---\nStyle: ${artStyle}\nPrompt: ${artPrompt}\n------------------------`);

    const imageResult = await callQwenImage(artPrompt, orientation);

    res.json({
      judul: artConcept.judul,
      deskripsi: artConcept.deskripsi,
      interpretasi: artConcept.interpretasi,
      artStyle: selectedStyle.id,
      prompt_image: artPrompt,
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
    if (id.startsWith('merge_')) {
      const task = taskManager.getTask(id);
      if (!task) return res.json({ status: 'FAILED', message: 'Merge task not found' });

      if (task.status === 'SUCCEEDED') {
        return res.json({ status: 'SUCCEEDED', progress: 100, video_url: task.video_url });
      } else if (task.status === 'FAILED') {
        return res.json({ status: 'FAILED', message: task.error || 'Merge failed' });
      } else {
        // Return real progress if available (0-100), otherwise flat 50
        return res.json({ status: 'RUNNING', progress: task.progress || 50 });
      }
    }

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
      message: output.code === 'DataInspectionFailed'
        ? 'Konten ditolak karena filter keamanan AI. Silakan coba prompt lain.'
        : (output.message || null)
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

  const jobId = `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  taskManager.updateTask(jobId, { status: 'RUNNING', startTime: Date.now() });

  // Run merge in background
  mergeVideos(videoUrls, jobId).then(mergedUrl => {
    debugLog(`MERGE SUCCESS [${jobId}]: ${mergedUrl}`);
    taskManager.updateTask(jobId, { status: 'SUCCEEDED', video_url: mergedUrl, doneTime: Date.now() });
  }).catch(err => {
    debugLog(`MERGE FAILED [${jobId}]: ${err.message}`);
    taskManager.updateTask(jobId, { status: 'FAILED', error: err.message, doneTime: Date.now() });
  });

  // Return jobId immediately to avoid timeout
  res.json({ status: 'PENDING', jobId });
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
  const seed = Math.floor(Math.random() * 1000000);
  const placeholderUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(text + ' ' + artStyle)}?width=${orientation === 'vertical' ? 720 : 1280}&height=${orientation === 'vertical' ? 1280 : 720}&seed=${seed}&nologo=true`;

  return {
    judul: 'Bisikan Waktu yang Hilang',
    deskripsi: 'Sebuah sosok berdiri di persimpangan kenangan dan harapan, diterangi cahaya emas yang pudar.',
    interpretasi: 'Sekilas lukisan ini terasa asing, hampir tidak bisa dimengerti. Tapi coba perhatikan bagian tengahnya — ada cahaya yang hampir padam, tapi tidak pernah benar-benar mati. Itulah yang ingin dikatakan karya ini padamu: bahwa di tengah semua yang terasa gelap, ada satu titik yang bertahan.',
    artStyle: artStyle,
    orientation,
    taskId: 'demo_mock',
    image_url: placeholderUrl,
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