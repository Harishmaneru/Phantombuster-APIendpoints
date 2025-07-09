const fs = require('fs');
const path = require('path');

class FileLogger {
    constructor() {
        // Create logs directory if it doesn't exist
        this.logsDir = path.join(__dirname, 'logs');
        this.paymentLogFile = path.join(this.logsDir, 'payment_logs.json');
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
            if (fs.existsSync(this.paymentLogFile)) {
                const data = fs.readFileSync(this.paymentLogFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error reading payment logs:', error);
        }
        return [];
    }

    // Write logs to file
    writeLogs(logs) {
        try {
            fs.writeFileSync(this.paymentLogFile, JSON.stringify(logs, null, 2));
        } catch (error) {
            console.error('Error writing payment logs:', error);
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
            this.writeLogs(logs);

            console.log(`[FileLogger] Payment log saved: ${logEntry.id}`);
            return logEntry;
        } catch (error) {
            console.error('Error adding payment log:', error);
            throw error;
        }
    }

    // Log domain purchase
    logDomainPurchase(data) {
        const logData = {
            type: 'domain_purchase',
            userId: data.userId,
            userEmail: data.userEmail,
            domainName: data.domainName,
            amount: data.amount,
            currency: data.currency || 'usd',
            status: data.status || 'pending',
            stripeSessionId: data.stripeSessionId,
            paymentIntentId: data.paymentIntentId,
            customerId: data.customerId,
            invoiceId: data.invoiceId,
            hostedInvoiceUrl: data.hostedInvoiceUrl,
            invoicePdf: data.invoicePdf,
            registrationYears: data.registrationYears,
            enablePrivacy: data.enablePrivacy,
            domainId: data.domainId,
            orderId: data.orderId,
            transactionId: data.transactionId,
            expirationDate: data.expirationDate,
            contactInfo: data.contactInfo,
            systemInfo: {
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                apiEndpoint: data.apiEndpoint,
                requestMethod: data.requestMethod
            },
            errorDetails: data.errorDetails,
            metadata: data.metadata
        };

        return this.addLog(logData);
    }

    // Log email creation
    logEmailCreation(data) {
        const logData = {
            type: 'email_creation',
            userId: data.userId,
            userEmail: data.userEmail,
            emailAddress: data.emailAddress,
            username: data.username,
            domain: data.domain,
            quota: data.quota,
            storageUsed: data.storageUsed || 0,
            suspended: data.suspended || false,
            status: data.status || 'completed',
            systemInfo: {
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                apiEndpoint: data.apiEndpoint,
                requestMethod: data.requestMethod
            },
            errorDetails: data.errorDetails,
            metadata: data.metadata
        };

        return this.addLog(logData);
    }

    // Log subscription payment
    logSubscriptionPayment(data) {
        const logData = {
            type: 'subscription',
            userId: data.userId,
            userEmail: data.userEmail,
            amount: data.amount,
            currency: data.currency || 'usd',
            status: data.status || 'pending',
            stripeSessionId: data.stripeSessionId,
            paymentIntentId: data.paymentIntentId,
            customerId: data.customerId,
            invoiceId: data.invoiceId,
            hostedInvoiceUrl: data.hostedInvoiceUrl,
            invoicePdf: data.invoicePdf,
            subscriptionId: data.subscriptionId,
            systemInfo: {
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                apiEndpoint: data.apiEndpoint,
                requestMethod: data.requestMethod
            },
            errorDetails: data.errorDetails,
            metadata: data.metadata
        };

        return this.addLog(logData);
    }

    // Log failed payment
    logFailedPayment(data) {
        const logData = {
            type: 'failed_payment',
            userId: data.userId,
            userEmail: data.userEmail,
            amount: data.amount,
            currency: data.currency || 'usd',
            status: 'failed',
            stripeSessionId: data.stripeSessionId,
            paymentIntentId: data.paymentIntentId,
            customerId: data.customerId,
            errorMessage: data.errorMessage,
            errorCode: data.errorCode,
            errorStack: data.errorStack,
            systemInfo: {
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                apiEndpoint: data.apiEndpoint,
                requestMethod: data.requestMethod
            },
            metadata: data.metadata
        };

        return this.addLog(logData);
    }

    // Log refund
    logRefund(data) {
        const logData = {
            type: 'refund',
            userId: data.userId,
            userEmail: data.userEmail,
            amount: data.amount,
            currency: data.currency || 'usd',
            status: 'refunded',
            stripeSessionId: data.stripeSessionId,
            paymentIntentId: data.paymentIntentId,
            customerId: data.customerId,
            invoiceId: data.invoiceId,
            refundId: data.refundId,
            refundReason: data.refundReason,
            systemInfo: {
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                apiEndpoint: data.apiEndpoint,
                requestMethod: data.requestMethod
            },
            metadata: data.metadata
        };

        return this.addLog(logData);
    }

    // Get logs with optional filtering
    getLogs(options = {}) {
        const logs = this.readLogs();
        
        let filteredLogs = logs;

        // Filter by type
        if (options.type) {
            filteredLogs = filteredLogs.filter(log => log.type === options.type);
        }

        // Filter by userId
        if (options.userId) {
            filteredLogs = filteredLogs.filter(log => log.userId === options.userId);
        }

        // Filter by userEmail
        if (options.userEmail) {
            filteredLogs = filteredLogs.filter(log => log.userEmail === options.userEmail);
        }

        // Filter by status
        if (options.status) {
            filteredLogs = filteredLogs.filter(log => log.status === options.status);
        }

        // Filter by date range
        if (options.startDate || options.endDate) {
            filteredLogs = filteredLogs.filter(log => {
                const logDate = new Date(log.timestamp);
                if (options.startDate && logDate < new Date(options.startDate)) {
                    return false;
                }
                if (options.endDate && logDate > new Date(options.endDate)) {
                    return false;
                }
                return true;
            });
        }

        // Sort by timestamp (newest first)
        filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Apply pagination
        if (options.limit) {
            const skip = options.skip || 0;
            filteredLogs = filteredLogs.slice(skip, skip + options.limit);
        }

        return {
            logs: filteredLogs,
            total: logs.length,
            filtered: filteredLogs.length
        };
    }

    // Get logs for a specific user
    getUserLogs(userId, options = {}) {
        return this.getLogs({ ...options, userId });
    }

    // Get logs for a specific domain
    getDomainLogs(domainName) {
        const logs = this.readLogs();
        return logs.filter(log => 
            log.type === 'domain_purchase' && 
            log.domainName === domainName
        );
    }

    // Get logs for a specific email
    getEmailLogs(emailAddress) {
        const logs = this.readLogs();
        return logs.filter(log => 
            log.type === 'email_creation' && 
            log.emailAddress === emailAddress
        );
    }

    // Get payment statistics
    getPaymentStats(userId, startDate, endDate) {
        const logs = this.readLogs();
        
        let filteredLogs = logs;
        
        if (userId) {
            filteredLogs = filteredLogs.filter(log => log.userId === userId);
        }
        
        if (startDate || endDate) {
            filteredLogs = filteredLogs.filter(log => {
                const logDate = new Date(log.timestamp);
                if (startDate && logDate < new Date(startDate)) {
                    return false;
                }
                if (endDate && logDate > new Date(endDate)) {
                    return false;
                }
                return true;
            });
        }

        const stats = {
            totalPayments: 0,
            totalAmount: 0,
            completedPayments: 0,
            failedPayments: 0,
            byType: {}
        };

        filteredLogs.forEach(log => {
            if (log.amount) {
                stats.totalPayments++;
                stats.totalAmount += log.amount;
            }
            
            if (log.status === 'completed') {
                stats.completedPayments++;
            } else if (log.status === 'failed') {
                stats.failedPayments++;
            }

            if (!stats.byType[log.type]) {
                stats.byType[log.type] = {
                    count: 0,
                    totalAmount: 0,
                    completedCount: 0,
                    failedCount: 0
                };
            }

            stats.byType[log.type].count++;
            if (log.amount) {
                stats.byType[log.type].totalAmount += log.amount;
            }
            if (log.status === 'completed') {
                stats.byType[log.type].completedCount++;
            } else if (log.status === 'failed') {
                stats.byType[log.type].failedCount++;
            }
        });

        return stats;
    }

    // Export logs to file
    exportLogs(format = 'json', options = {}) {
        const result = this.getLogs(options);
        
        if (format === 'csv') {
            return this.exportToCSV(result.logs);
        }
        
        return result;
    }

    // Export to CSV format
    exportToCSV(logs) {
        if (logs.length === 0) {
            return '';
        }

        const headers = [
            'ID',
            'Timestamp',
            'Type',
            'User ID',
            'User Email',
            'Status',
            'Amount',
            'Currency',
            'Domain Name',
            'Email Address',
            'Stripe Session ID',
            'Payment Intent ID',
            'Customer ID',
            'Invoice ID',
            'Error Message',
            'IP Address',
            'API Endpoint'
        ];

        const csvRows = logs.map(log => [
            log.id,
            log.timestamp,
            log.type,
            log.userId,
            log.userEmail,
            log.status,
            log.amount || '',
            log.currency || '',
            log.domainName || '',
            log.emailAddress || '',
            log.stripeSessionId || '',
            log.paymentIntentId || '',
            log.customerId || '',
            log.invoiceId || '',
            log.errorMessage || '',
            log.systemInfo?.ipAddress || '',
            log.systemInfo?.apiEndpoint || ''
        ]);

        const csvContent = [headers, ...csvRows]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');

        return csvContent;
    }

    // Get log file path
    getLogFilePath() {
        return this.paymentLogFile;
    }

    // Get log file size
    getLogFileSize() {
        try {
            if (fs.existsSync(this.paymentLogFile)) {
                const stats = fs.statSync(this.paymentLogFile);
                return stats.size;
            }
        } catch (error) {
            console.error('Error getting log file size:', error);
        }
        return 0;
    }

    // Clear old logs (keep last N days)
    clearOldLogs(daysToKeep = 30) {
        try {
            const logs = this.readLogs();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const filteredLogs = logs.filter(log => 
                new Date(log.timestamp) > cutoffDate
            );

            this.writeLogs(filteredLogs);
            console.log(`[FileLogger] Cleared old logs. Kept ${filteredLogs.length} logs from last ${daysToKeep} days.`);
            
            return {
                originalCount: logs.length,
                keptCount: filteredLogs.length,
                removedCount: logs.length - filteredLogs.length
            };
        } catch (error) {
            console.error('Error clearing old logs:', error);
            throw error;
        }
    }
}

// Create singleton instance
const fileLogger = new FileLogger();

module.exports = fileLogger; 