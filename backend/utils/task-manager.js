const fs = require('fs');
const path = require('path');
const { debugLog } = require('./logger');

const tempDir = path.join(__dirname, '../../temp');
const TASKS_FILE = path.join(tempDir, 'tasks.json');

/**
 * Persistently manages background tasks (like video merging).
 * Ensures state survives server restarts.
 */
class TaskManager {
    constructor() {
        this.tasks = {};
        debugLog('[TASK-MGR] Initializing Task Manager...');
        this._loadTasks();
        this._cleanupOrphanedTasks();
        // Ensure file exists even if empty
        if (!fs.existsSync(TASKS_FILE)) {
            this._saveTasks();
        }
    }

    _loadTasks() {
        try {
            const dir = path.dirname(TASKS_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(TASKS_FILE)) {
                const data = fs.readFileSync(TASKS_FILE, 'utf8');
                this.tasks = JSON.parse(data);
                debugLog(`[TASK-MGR] Loaded ${Object.keys(this.tasks).length} tasks from disk.`);
            }
        } catch (err) {
            debugLog(`[TASK-MGR] Error loading tasks: ${err.message}`);
            this.tasks = {};
        }
    }

    _saveTasks() {
        try {
            // Atomic-ish write: write to temp then rename if possible, 
            // but for simplicity in local dev, direct write is fine.
            fs.writeFileSync(TASKS_FILE, JSON.stringify(this.tasks, null, 2));
        } catch (err) {
            debugLog(`[TASK-MGR] Error saving tasks: ${err.message}`);
        }
    }

    /**
     * Mark tasks that were 'RUNNING' when the server stopped as 'FAILED'.
     */
    _cleanupOrphanedTasks() {
        let changed = false;
        for (const id in this.tasks) {
            if (this.tasks[id].status === 'RUNNING') {
                this.tasks[id].status = 'FAILED';
                this.tasks[id].error = 'Server restarted during processing. Please try again.';
                this.tasks[id].doneTime = Date.now();
                changed = true;
            }
        }
        if (changed) {
            debugLog(`[TASK-MGR] Cleaned up orphaned RUNNING tasks.`);
            this._saveTasks();
        }
    }

    getTask(id) {
        return this.tasks[id] || null;
    }

    updateTask(id, data) {
        this.tasks[id] = {
            ...(this.tasks[id] || {}),
            ...data,
            lastUpdated: Date.now()
        };
        this._saveTasks();
        return this.tasks[id];
    }

    deleteTask(id) {
        if (this.tasks[id]) {
            delete this.tasks[id];
            this._saveTasks();
        }
    }

    getAllTasks() {
        return this.tasks;
    }
}

// Singleton instance
module.exports = new TaskManager();
