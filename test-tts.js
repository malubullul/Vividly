const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

const ALIBABA_API_KEY = process.env.ALIBABA_API_KEY;
const TTS_MODEL = process.env.TTS_MODEL || 'cosyvoice-v3-flash';
const WS_URL = 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference';

async function callTTS(text, voice = 'loonganimegirl') {
    if (!ALIBABA_API_KEY || !text) {
        console.error('API Key or Text missing');
        return null;
    }

    const taskId = `test_tts_${Date.now()}`;

    return new Promise((resolve) => {
        const ws = new WebSocket(WS_URL, {
            headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` },
        });

        const audioChunks = [];

        ws.on('open', () => {
            console.log(`Testing TTS with voice: ${voice} and text: ${text}`);
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
                        language: 'ja'
                    },
                    input: { text },
                },
            }));
        });

        ws.on('message', (data, isBinary) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.header?.event === 'task-finished') {
                    ws.close();
                    if (audioChunks.length > 0) {
                        resolve(Buffer.concat(audioChunks));
                    } else {
                        resolve(null);
                    }
                } else if (msg.header?.event === 'task-failed') {
                    console.error('TTS failed:', msg.header?.error_message);
                    ws.close();
                    resolve(null);
                }
            } catch (_) {
                audioChunks.push(Buffer.from(data));
            }
        });

        ws.on('error', (err) => {
            console.error('WS Error:', err.message);
            resolve(null);
        });
    });
}

(async () => {
    const japaneseText = "こんにちは、私の名前はヴィヴィです。今日はいい天気ですね。";
    const buffer = await callTTS(japaneseText, 'loongshiori');
    if (buffer) {
        fs.writeFileSync('test-jp.mp3', buffer);
        console.log('Success! Saved to test-jp.mp3');
    } else {
        console.log('Failed to generate Japanese TTS.');
    }
})();
