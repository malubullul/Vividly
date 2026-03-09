const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');
const ffprobeInstaller = require('ffprobe-static');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { debugLog } = require('./logger');

// Set ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(ffmpegInstaller);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/**
 * Downloads a video from a URL to a temporary local file.
 * @param {string} url - The URL of the video to download.
 * @param {string} tempDir - The directory where the video will be saved.
 * @returns {Promise<string>} - The path to the downloaded video file.
 */
async function downloadVideo(url, tempDir) {
    const fileName = `${uuidv4()}.mp4`;
    const filePath = path.join(tempDir, fileName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filePath));
        writer.on('error', reject);
    });
}

/**
 * Merges multiple video files into a single video file.
 * @param {string[]} videoUrls - An array of video URLs to merge.
 * @returns {Promise<string>} - The relative path to the merged video file.
 */
async function mergeVideos(videoUrls, jobId = null) {
    if (!videoUrls || videoUrls.length === 0) {
        throw new Error('No video URLs provided for merging.');
    }

    const taskManager = require('./task-manager');
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const uploadDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const localPaths = [];
    const listFilePath = path.join(tempDir, `list_${Date.now()}.txt`);

    try {
        // Step 1: Download all videos locally in parallel
        debugLog(`[MERGE] Downloading ${videoUrls.length} videos in parallel...`);
        const downloadPromises = videoUrls.map(url => downloadVideo(url, tempDir));
        const downloadedPaths = await Promise.all(downloadPromises);
        localPaths.push(...downloadedPaths);

        // Step 2: Create list file for concat demuxer
        debugLog(`[MERGE] Local paths: ${localPaths.length} files downloaded.`);
        const listContent = localPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listFilePath, listContent);

        // Step 3: Merge videos
        const outputFileName = `merged_${Date.now()}.mp4`;
        const outputPath = path.join(uploadDir, outputFileName);

        debugLog(`[MERGE] Attempting concat with synchronization (24fps, 720p)...`);

        const runMerge = (withReencode) => {
            return new Promise((resolve, reject) => {
                let timer = setTimeout(() => {
                    debugLog(`[MERGE] TIMEOUT: FFmpeg process took too long (>10 mins).`);
                    reject(new Error('FFmpeg merge timed out'));
                }, 600000);

                let command = ffmpeg()
                    .input(listFilePath)
                    .inputOptions(['-f', 'concat', '-safe', '0']);

                if (withReencode) {
                    command
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .fps(24)
                        .size('1280x720')
                        .outputOptions([
                            '-preset fast',
                            '-crf 23',
                            '-pix_fmt yuv420p',
                            '-movflags +faststart'
                        ]);
                } else {
                    command.outputOptions(['-c copy']);
                }

                command
                    .on('progress', (progress) => {
                        if (jobId && progress.percent) {
                            const pct = Math.round(progress.percent);
                            taskManager.updateTask(jobId, { progress: pct });
                            if (pct % 20 === 0) debugLog(`[MERGE] ${jobId} Progress: ${pct}%`);
                        }
                    })
                    .on('error', (err) => {
                        clearTimeout(timer);
                        debugLog(`[MERGE] FFmpeg Error: ${err.message}`);
                        reject(err);
                    })
                    .on('end', () => {
                        clearTimeout(timer);
                        debugLog(`[MERGE] Finished successfully!`);
                        resolve(`/uploads/${outputFileName}`);
                    });

                command.save(outputPath);
            });
        };

        try {
            return await runMerge(true);
        } catch (err) {
            debugLog(`[MERGE] Optimized merge failed, trying fast copy...`);
            const fallbackFileName = `merged_fallback_${Date.now()}.mp4`;
            const fallbackPath = path.join(uploadDir, fallbackFileName);

            return new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listFilePath)
                    .inputOptions(['-f', 'concat', '-safe', '0'])
                    .outputOptions(['-c copy'])
                    .on('error', (e) => reject(e))
                    .on('end', () => resolve(`/uploads/${fallbackFileName}`))
                    .save(fallbackPath);
            });
        }

    } finally {
        // Cleanup
        if (fs.existsSync(listFilePath)) try { fs.unlinkSync(listFilePath); } catch (e) { }
        localPaths.forEach(p => {
            if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch (e) { }
        });
    }
}

module.exports = { mergeVideos };
