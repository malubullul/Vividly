const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');
const ffprobeInstaller = require('ffprobe-static');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
async function mergeVideos(videoUrls) {
    if (!videoUrls || videoUrls.length === 0) {
        throw new Error('No video URLs provided for merging.');
    }

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const uploadDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const localPaths = [];
    try {
        // Step 1: Download all videos locally in parallel
        console.log(`[MERGE] Downloading ${videoUrls.length} videos in parallel...`);
        const downloadPromises = videoUrls.map(url => downloadVideo(url, tempDir));
        const downloadedPaths = await Promise.all(downloadPromises);
        localPaths.push(...downloadedPaths);

        // Step 2: Merge videos using fluent-ffmpeg
        const outputFileName = `merged_${Date.now()}.mp4`;
        const outputPath = path.join(uploadDir, outputFileName);

        console.log(`[MERGE] Starting ffmpeg concatenation...`);
        return new Promise((resolve, reject) => {
            const command = ffmpeg();

            localPaths.forEach(path => {
                command.input(path);
            });

            command
                .on('error', function (err) {
                    console.error('[MERGE] Error: ' + err.message);
                    cleanup();
                    reject(err);
                })
                .on('end', function () {
                    console.log('[MERGE] Merging finished!');
                    cleanup();
                    resolve(`/public/uploads/${outputFileName}`);
                })
                .mergeToFile(outputPath, tempDir);
        });

    } catch (error) {
        console.error('[MERGE] Failed:', error);
        cleanup();
        throw error;
    }

    function cleanup() {
        console.log(`[MERGE] Cleaning up ${localPaths.length} temporary files...`);
        localPaths.forEach(filePath => {
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error(`[MERGE] Cleanup failed for ${filePath}:`, e.message);
                }
            }
        });
    }
}

module.exports = { mergeVideos };
