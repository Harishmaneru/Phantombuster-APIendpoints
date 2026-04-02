const fs = require('fs');
const path = require('path');

class SalesNavLogger {
    constructor() {
        // Create logs directory if it doesn't exist
        this.logsDir = path.join(__dirname, 'logs');
        this.logFile = path.join(this.logsDir, 'sales_nav_logs.json');
        this.ensureLogsDirectory();
    }

    ensureLogsDirectory() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    // Read existing logs
    readLogs() {
        try {
            if (fs.existsSync(this.logFile)) {
                const data = fs.readFileSync(this.logFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('[SalesNavLogger] Error reading logs:', error);
        }
        return [];
    }

    // Write logs to file
    writeLogs(logs) {
        try {
            fs.writeFileSync(this.logFile, JSON.stringify(logs, null, 2));
        } catch (error) {
            console.error('[SalesNavLogger] Error writing logs:', error);
        }
    }

    // Add a new log entry
    addLog(logData) {
        try {
            const logs = this.readLogs();
            
            const logEntry = {
                id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                timestamp: new Date().toISOString(),
                ...logData
            };

            logs.push(logEntry);
            
            // Limit logs to last 1000 entries to prevent file from becoming too large
            if (logs.length > 1000) {
                logs.shift();
            }

            this.writeLogs(logs);

            console.log(`[SalesNavLogger] Log saved: ${logEntry.step || 'general'} | Request ID: ${logEntry.requestId || 'N/A'}`);
            return logEntry;
        } catch (error) {
            console.error('[SalesNavLogger] Error adding log:', error);
        }
    }

    // Log search initiation
    logInitiation(requestId, url, limit) {
        return this.addLog({
            type: 'sales_nav_search',
            step: 'initiate',
            requestId,
            url,
            limit,
            status: 'pending'
        });
    }

    // Log status polling
    logPolling(requestId, status, requestsRemaining) {
        return this.addLog({
            type: 'sales_nav_search',
            step: 'polling',
            requestId,
            status,
            requestsRemaining
        });
    }

    // Log completion
    logCompletion(requestId, status, usage) {
        return this.addLog({
            type: 'sales_nav_search',
            step: 'complete',
            requestId,
            status,
            usage
        });
    }

    // Log error
    logError(requestId, error, context = {}) {
        return this.addLog({
            type: 'sales_nav_search',
            step: 'error',
            requestId,
            error: error.message || error,
            apiResponse: error.apiResponse || null,
            ...context
        });
    }

    // Get logs with optional filtering
    getLogs(options = {}) {
        const logs = this.readLogs();
        let filteredLogs = logs;

        if (options.requestId) {
            filteredLogs = filteredLogs.filter(log => log.requestId === options.requestId);
        }

        if (options.status) {
            filteredLogs = filteredLogs.filter(log => log.status === options.status);
        }

        // Sort by timestamp (newest first)
        filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (options.limit) {
            filteredLogs = filteredLogs.slice(0, options.limit);
        }

        return filteredLogs;
    }
}

// Create singleton instance
const salesNavLogger = new SalesNavLogger();

module.exports = salesNavLogger;
