const router = require('express').Router();

// ── Health check ──────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Vividly API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ── Generate video stub (Qwen + Wan integration point) ──
// This is where you'll connect the Alibaba Cloud Model Studio API
router.post('/generate', async (req, res) => {
  const { mode, style, prompt, imageUrl } = req.body;

  if (!mode || !style) {
    return res.status(400).json({ error: 'mode and style are required' });
  }

  // TODO: Integrate Qwen for prompt optimization
  // const optimizedPrompt = await qwenOptimizePrompt({ mode, style, prompt, imageUrl });

  // TODO: Integrate Wan for video generation
  // const videoUrl = await wanGenerateVideo({ prompt: optimizedPrompt, imageUrl });

  // Stub response for development
  res.json({
    success: true,
    jobId: `job_${Date.now()}`,
    status: 'processing',
    estimatedSeconds: 30,
    message: `Generating ${mode} video with ${style} style...`,
    // videoUrl will be filled once Wan API is connected
  });
});

// ── Check job status ──────────────────────────
router.get('/status/:jobId', (req, res) => {
  // TODO: poll actual job status from Wan API
  res.json({
    jobId: req.params.jobId,
    status: 'processing',
    progress: 65
  });
});

module.exports = router;
