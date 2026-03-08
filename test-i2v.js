const axios = require('axios');
require('dotenv').config();

const ALIBABA_API_KEY = process.env.ALIBABA_API_KEY;

// Tiny 1x1 black pixel base64 for testing
const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function testI2V() {
    console.log('Testing Wan I2V with Key:', ALIBABA_API_KEY ? 'FOUND' : 'MISSING');

    const models = ['wan2.1-i2v-720p', 'wan2.1-i2v-plus', 'wan2.6-i2v-720p', 'wan2.1-kf2v-plus'];
    const endpoints = [
        'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
        'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis'
    ];

    for (const model of models) {
        for (const endpoint of endpoints) {
            console.log(`\n--- Testing Model: ${model} | Endpoint: ${endpoint} ---`);
            try {
                const res = await axios.post(
                    endpoint,
                    {
                        model: model,
                        input: {
                            prompt: 'A beautiful cinematic landscape, slow camera movement',
                            img_url: testBase64
                        },
                        parameters: {
                            size: '1280*720',
                            duration: 15,
                            prompt_extend: true
                        }
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${ALIBABA_API_KEY}`,
                            'Content-Type': 'application/json',
                            'X-DashScope-Async': 'enable'
                        },
                        timeout: 10000
                    }
                );
                console.log('SUCCESS! Task ID:', res.data.output?.task_id);
            } catch (e) {
                console.error('FAILED!');
                if (e.response) {
                    console.error('Status:', e.response.status);
                    console.error('Data:', JSON.stringify(e.response.data));
                } else {
                    console.error(e.message);
                }
            }
        }
    }
}

testI2V();
