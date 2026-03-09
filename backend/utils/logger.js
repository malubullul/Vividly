const fs = require('fs');
const path = require('path');

/**
 * Appends a message with a timestamp to the persistent debug log file.
 * @param {string} msg - The message to log.
 */
function debugLog(msg) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}\n`;
    try {
        fs.appendFileSync(path.join(__dirname, '../debug-log.txt'), logMsg);
    } catch (err) {
        console.error('Failed to write to debug-log.txt:', err.message);
    }
}

module.exports = { debugLog };
