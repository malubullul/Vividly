const axios = require('axios');
require('dotenv').config();

const ALIBABA_API_KEY = process.env.ALIBABA_API_KEY;
const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function testFinal() {
    console.log('Testing Wan 2.6 I2V with Documentation Parameters...');

    // Based on user docs: wan2.6-i2v-flash is recommended
    const model = 'wan2.6-i2v-flash';
    const endpoint = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

    try {
        const res = await axios.post(
            endpoint,
            {
                model: model,
                input: {
                    prompt: 'A cinematic zoom into a red dot',
                    img_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
                },
                parameters: {
                    resolution: '720P',
                    duration: 15, // Test 15s
                    shot_type: 'multi',
                    prompt_extend: true
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${ALIBABA_API_KEY}`,
                    'Content-Type': 'application/json',
                    'X-DashScope-Async': 'enable'
                }
            }
        );
        const taskId = res.data.output?.task_id;
        console.log('SUCCESS! Task ID:', taskId);

        if (taskId) {
            console.log('Polling status...');
            for (let i = 0; i < 5; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const statusRes = await axios.get(
                    `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
                    { headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` } }
                );
                const output = statusRes.data.output;
                console.log(`Status [${i + 1}]: ${output.task_status}`);
                if (output.task_status === 'FAILED') {
                    console.error('Task FAILED:', JSON.stringify(output));
                    break;
                }
                if (output.task_status === 'SUCCEEDED') {
                    console.log('Task SUCCEEDED!');
                    break;
                }
            }
        }
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

testFinal();
