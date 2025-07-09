const mongoose = require('mongoose');

// Payment Log Schema
const paymentLogSchema = new mongoose.Schema({
    // User identification
    userId: {
        type: String,
        required: true,
        index: true
    },
    userEmail: {
        type: String,
        required: true,
        index: true
    },
    
    // Payment details
    paymentType: {
        type: String,
        enum: ['domain_purchase', 'email_creation', 'subscription', 'one_time_payment', 'refund', 'failed_payment'],
        required: true
    },
    
    // Stripe payment information
    stripeData: {
        sessionId: String,
        paymentIntentId: String,
        customerId: String,
        invoiceId: String,
        hostedInvoiceUrl: String,
        invoicePdf: String,
        amount: Number,
        currency: String,
        paymentStatus: String,
        paymentMethod: String,
        receiptUrl: String
    },
    
    // Domain-specific data (for domain purchases)
    domainData: {
        domainName: String,
        registrationYears: Number,
        enablePrivacy: Boolean,
        registrationPrice: Number,
        renewalPrice: Number,
        transferPrice: Number,
        icannFee: Number,
        domainId: String,
        orderId: String,
        transactionId: String,
        expirationDate: Date,
        registrar: String
    },
    
    // Email-specific data (for email creation)
    emailData: {
        emailAddress: String,
        username: String,
        domain: String,
        quota: Number,
        storageUsed: Number,
        suspended: Boolean
    },
    
    // Contact information
    contactInfo: {
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        address1: String,
        address2: String,
        city: String,
        stateProvince: String,
        country: String,
        postalCode: String
    },
    
    // System information
    systemInfo: {
        ipAddress: String,
        userAgent: String,
        apiEndpoint: String,
        requestMethod: String
    },
    
    // Status and timestamps
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'],
        default: 'pending'
    },
    
    errorDetails: {
        errorMessage: String,
        errorCode: String,
        errorStack: String
    },
    
    // Metadata
    metadata: {
        type: Map,
        of: String
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date,
    failedAt: Date
}, {
    collection: 'payment_logs',
    timestamps: true
});

// Indexes for efficient querying
paymentLogSchema.index({ userId: 1, createdAt: -1 });
paymentLogSchema.index({ userEmail: 1, createdAt: -1 });
paymentLogSchema.index({ paymentType: 1, createdAt: -1 });
paymentLogSchema.index({ status: 1, createdAt: -1 });
paymentLogSchema.index({ 'stripeData.sessionId': 1 });
paymentLogSchema.index({ 'stripeData.paymentIntentId': 1 });
paymentLogSchema.index({ 'domainData.domainName': 1 });
paymentLogSchema.index({ 'emailData.emailAddress': 1 });

const PaymentLog = mongoose.model('PaymentLog', paymentLogSchema);

// Logging functions
class PaymentLogger {
    static async logDomainPurchase(data) {
        try {
            const logData = {
                userId: data.userId,
                userEmail: data.userEmail,
                paymentType: 'domain_purchase',
                stripeData: {
                    sessionId: data.stripeData?.sessionId,
                    paymentIntentId: data.stripeData?.paymentIntentId,
                    customerId: data.stripeData?.customerId,
                    invoiceId: data.stripeData?.invoiceId,
                    hostedInvoiceUrl: data.stripeData?.hostedInvoiceUrl,
                    invoicePdf: data.stripeData?.invoicePdf,
                    amount: data.stripeData?.amount,
                    currency: data.stripeData?.currency,
                    paymentStatus: data.stripeData?.paymentStatus,
                    paymentMethod: data.stripeData?.paymentMethod,
                    receiptUrl: data.stripeData?.receiptUrl
                },
                domainData: {
                    domainName: data.domainName,
                    registrationYears: data.registrationYears,
                    enablePrivacy: data.enablePrivacy,
                    registrationPrice: data.registrationPrice,
                    renewalPrice: data.renewalPrice,
                    transferPrice: data.transferPrice,
                    icannFee: data.icannFee,
                    domainId: data.domainId,
                    orderId: data.orderId,
                    transactionId: data.transactionId,
                    expirationDate: data.expirationDate,
                    registrar: data.registrar || 'Namecheap'
                },
                contactInfo: data.contactInfo,
                systemInfo: data.systemInfo,
                status: data.status || 'pending',
                metadata: data.metadata
            };

            if (data.errorDetails) {
                logData.errorDetails = data.errorDetails;
                logData.status = 'failed';
                logData.failedAt = new Date();
            } else if (data.status === 'completed') {
                logData.completedAt = new Date();
            }

            const log = new PaymentLog(logData);
            await log.save();

            console.log(`[PaymentLogger] Domain purchase logged: ${data.domainName} for user ${data.userId}`);
            return log;
        } catch (error) {
            console.error('[PaymentLogger] Error logging domain purchase:', error);
            throw error;
        }
    }

    static async logEmailCreation(data) {
        try {
            const logData = {
                userId: data.userId,
                userEmail: data.userEmail,
                paymentType: 'email_creation',
                emailData: {
                    emailAddress: data.emailAddress,
                    username: data.username,
                    domain: data.domain,
                    quota: data.quota,
                    storageUsed: data.storageUsed || 0,
                    suspended: data.suspended || false
                },
                systemInfo: data.systemInfo,
                status: data.status || 'completed',
                metadata: data.metadata
            };

            if (data.errorDetails) {
                logData.errorDetails = data.errorDetails;
                logData.status = 'failed';
                logData.failedAt = new Date();
            } else {
                logData.completedAt = new Date();
            }

            const log = new PaymentLog(logData);
            await log.save();

            console.log(`[PaymentLogger] Email creation logged: ${data.emailAddress} for user ${data.userId}`);
            return log;
        } catch (error) {
            console.error('[PaymentLogger] Error logging email creation:', error);
            throw error;
        }
    }

    static async logSubscriptionPayment(data) {
        try {
            const logData = {
                userId: data.userId,
                userEmail: data.userEmail,
                paymentType: 'subscription',
                stripeData: {
                    sessionId: data.stripeData?.sessionId,
                    paymentIntentId: data.stripeData?.paymentIntentId,
                    customerId: data.stripeData?.customerId,
                    invoiceId: data.stripeData?.invoiceId,
                    hostedInvoiceUrl: data.stripeData?.hostedInvoiceUrl,
                    invoicePdf: data.stripeData?.invoicePdf,
                    amount: data.stripeData?.amount,
                    currency: data.stripeData?.currency,
                    paymentStatus: data.stripeData?.paymentStatus,
                    paymentMethod: data.stripeData?.paymentMethod,
                    receiptUrl: data.stripeData?.receiptUrl
                },
                systemInfo: data.systemInfo,
                status: data.status || 'pending',
                metadata: data.metadata
            };

            if (data.errorDetails) {
                logData.errorDetails = data.errorDetails;
                logData.status = 'failed';
                logData.failedAt = new Date();
            } else if (data.status === 'completed') {
                logData.completedAt = new Date();
            }

            const log = new PaymentLog(logData);
            await log.save();

            console.log(`[PaymentLogger] Subscription payment logged for user ${data.userId}`);
            return log;
        } catch (error) {
            console.error('[PaymentLogger] Error logging subscription payment:', error);
            throw error;
        }
    }

    static async logFailedPayment(data) {
        try {
            const logData = {
                userId: data.userId,
                userEmail: data.userEmail,
                paymentType: data.paymentType || 'failed_payment',
                stripeData: {
                    sessionId: data.stripeData?.sessionId,
                    paymentIntentId: data.stripeData?.paymentIntentId,
                    customerId: data.stripeData?.customerId,
                    amount: data.stripeData?.amount,
                    currency: data.stripeData?.currency,
                    paymentStatus: data.stripeData?.paymentStatus
                },
                systemInfo: data.systemInfo,
                status: 'failed',
                errorDetails: {
                    errorMessage: data.errorMessage,
                    errorCode: data.errorCode,
                    errorStack: data.errorStack
                },
                failedAt: new Date(),
                metadata: data.metadata
            };

            const log = new PaymentLog(logData);
            await log.save();

            console.log(`[PaymentLogger] Failed payment logged for user ${data.userId}`);
            return log;
        } catch (error) {
            console.error('[PaymentLogger] Error logging failed payment:', error);
            throw error;
        }
    }

    static async logRefund(data) {
        try {
            const logData = {
                userId: data.userId,
                userEmail: data.userEmail,
                paymentType: 'refund',
                stripeData: {
                    sessionId: data.stripeData?.sessionId,
                    paymentIntentId: data.stripeData?.paymentIntentId,
                    customerId: data.stripeData?.customerId,
                    invoiceId: data.stripeData?.invoiceId,
                    amount: data.stripeData?.amount,
                    currency: data.stripeData?.currency,
                    refundId: data.stripeData?.refundId,
                    refundReason: data.stripeData?.refundReason
                },
                systemInfo: data.systemInfo,
                status: 'refunded',
                completedAt: new Date(),
                metadata: data.metadata
            };

            const log = new PaymentLog(logData);
            await log.save();

            console.log(`[PaymentLogger] Refund logged for user ${data.userId}`);
            return log;
        } catch (error) {
            console.error('[PaymentLogger] Error logging refund:', error);
            throw error;
        }
    }

    // Query functions
    static async getUserPaymentHistory(userId, options = {}) {
        try {
            const { limit = 50, skip = 0, paymentType, status, startDate, endDate } = options;
            
            let query = { userId };
            
            if (paymentType) query.paymentType = paymentType;
            if (status) query.status = status;
            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) query.createdAt.$gte = new Date(startDate);
                if (endDate) query.createdAt.$lte = new Date(endDate);
            }

            const logs = await PaymentLog.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip);

            const total = await PaymentLog.countDocuments(query);

            return {
                logs,
                total,
                hasMore: total > skip + logs.length
            };
        } catch (error) {
            console.error('[PaymentLogger] Error getting user payment history:', error);
            throw error;
        }
    }

    static async getDomainPurchaseLogs(domainName) {
        try {
            const logs = await PaymentLog.find({
                paymentType: 'domain_purchase',
                'domainData.domainName': domainName
            }).sort({ createdAt: -1 });

            return logs;
        } catch (error) {
            console.error('[PaymentLogger] Error getting domain purchase logs:', error);
            throw error;
        }
    }

    static async getEmailCreationLogs(emailAddress) {
        try {
            const logs = await PaymentLog.find({
                paymentType: 'email_creation',
                'emailData.emailAddress': emailAddress
            }).sort({ createdAt: -1 });

            return logs;
        } catch (error) {
            console.error('[PaymentLogger] Error getting email creation logs:', error);
            throw error;
        }
    }

    static async getPaymentStats(userId, startDate, endDate) {
        try {
            const query = { userId };
            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) query.createdAt.$gte = new Date(startDate);
                if (endDate) query.createdAt.$lte = new Date(endDate);
            }

            const stats = await PaymentLog.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: '$paymentType',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$stripeData.amount' },
                        completedCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                        },
                        failedCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                        }
                    }
                }
            ]);

            return stats;
        } catch (error) {
            console.error('[PaymentLogger] Error getting payment stats:', error);
            throw error;
        }
    }

    // Update log status
    static async updateLogStatus(logId, status, additionalData = {}) {
        try {
            const updateData = {
                status,
                updatedAt: new Date()
            };

            if (status === 'completed') {
                updateData.completedAt = new Date();
            } else if (status === 'failed') {
                updateData.failedAt = new Date();
            }

            if (additionalData.errorDetails) {
                updateData.errorDetails = additionalData.errorDetails;
            }

            const log = await PaymentLog.findByIdAndUpdate(
                logId,
                updateData,
                { new: true }
            );

            console.log(`[PaymentLogger] Log status updated: ${logId} -> ${status}`);
            return log;
        } catch (error) {
            console.error('[PaymentLogger] Error updating log status:', error);
            throw error;
        }
    }
}

module.exports = {
    PaymentLog,
    PaymentLogger
}; 