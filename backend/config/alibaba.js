module.exports = {
  endpoint: process.env.ALIBABA_ENDPOINT || 'https://dashscope.aliyuncs.com/api/v1',
  apiKey:   process.env.ALIBABA_API_KEY,
  models: {
    qwen: process.env.QWEN_MODEL || 'qwen-plus',
    wan:  process.env.WAN_MODEL  || 'wanx-v1'
  },
  headers: () => ({
    'Authorization': `Bearer ${process.env.ALIBABA_API_KEY}`,
    'Content-Type':  'application/json',
    'X-DashScope-Async': 'enable'
  })
};
