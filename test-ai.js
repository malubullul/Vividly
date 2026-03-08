const axios = require('axios');
require('dotenv').config();

const ALIBABA_API_KEY = process.env.ALIBABA_API_KEY;
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-max';
const WAN_MODEL = process.env.WAN_MODEL || 'wan2.1-t2v-turbo';

async function test() {
    console.log('Testing AI with Key:', ALIBABA_API_KEY ? 'FOUND' : 'MISSING');
    console.log('Qwen Model:', QWEN_MODEL);
    console.log('Wan Model:', WAN_MODEL);

    try {
        // Test Qwen
        const qwenResp = await axios.post(
            'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
            {
                model: QWEN_MODEL,
                messages: [{ role: 'user', content: 'hello' }]
            },
            { headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` } }
        );
        console.log('Qwen Test: SUCCESS', qwenResp.data.choices[0].message.content);

        // Test Wan AI
        // Test TTS
        const ttsResp = await axios.post(
            'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-to-speech/synthesis',
            {
                model: 'cosyvoice-v1',
                input: { text: 'Halo selamat datang di Vividly.' },
                parameters: { voice: 'longxiaochun' }
            },
            { headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` }, responseType: 'arraybuffer' }
        );
        console.log('TTS Test: SUCCESS', ttsResp.data.length, 'bytes received');

        const wanResp = await axios.post(
            'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
            {
                model: WAN_MODEL,
                input: { text: 'a dog' }
            },
            { headers: { Authorization: `Bearer ${ALIBABA_API_KEY}`, 'X-DashScope-Async': 'enable' } }
        );
        console.log('Wan AI Test: SUCCESS', wanResp.data);

    } catch (e) {
        console.error('Test Failed!');
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', JSON.stringify(e.response.data));
        } else {
            console.error(e.message);
        }
    }
}

test();
