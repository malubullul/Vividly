const axios = require('axios');
require('dotenv').config();

const ALIBABA_API_KEY = process.env.ALIBABA_API_KEY;
const taskId = 'd173ed93-5a3c-46d3-97ba-8c4dae346085';

async function check() {
    try {
        const r = await axios.get(
            `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`,
            { headers: { Authorization: `Bearer ${ALIBABA_API_KEY}` } }
        );
        console.log(JSON.stringify(r.data, null, 2));
    } catch (e) {
        console.error(e.message);
    }
}
check();
