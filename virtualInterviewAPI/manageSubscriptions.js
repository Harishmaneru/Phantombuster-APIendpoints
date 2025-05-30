const express = require('express');
const router = express.Router();

// In-memory storage for free trials (as requested, no MongoDB)
const freeTrials = new Map();

// Helper function to calculate trial end date
const calculateTrialEndDate = (startDate, daysCount = 14) => {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + daysCount);
    return endDate;
};

// Helper function to check if trial is still active
const isTrialActive = (trialData) => {
    const now = new Date();
    return now <= new Date(trialData.endDate);
};

// Helper function to increment interview creation count
const incrementInterviewCount = (userId) => {
    console.log('Incrementing interview count for userId:', userId);
    
    const trialData = freeTrials.get(userId);
    if (trialData) {
        trialData.interviewPageCreationCount = (trialData.interviewPageCreationCount || 0) + 1;
        trialData.lastInterviewCreated = new Date().toISOString();
        freeTrials.set(userId, trialData);
        
        console.log(`Interview count updated to ${trialData.interviewPageCreationCount} for user ${userId}`);
        return trialData.interviewPageCreationCount;
    }
    
    console.log(`No trial found for user ${userId}`);
    return 0;
};

// Helper function to check if user can create more interviews
const canCreateInterview = (userId) => {
    const trialData = freeTrials.get(userId);
    if (!trialData) return false;
    
    const isActive = isTrialActive(trialData);
    const currentCount = trialData.interviewPageCreationCount || 0;
    const maxInterviews = 5; // Free trial limit
    
    return isActive && currentCount < maxInterviews;
};

// Main function to activate free trial
const activateFreeTrial = async (userId) => {
    console.log('Input parameters:', { userId });

    if (!userId) {
        console.log('Error: Missing userId');
        return {
            success: false,
            message: "userId is required",
            error: "MISSING_USER_ID"
        };
    }

    try {
        const now = new Date();
        const existingTrial = freeTrials.get(userId);

        // Check if user already has an active trial
        if (existingTrial) {
            const isActive = isTrialActive(existingTrial);
            
            if (isActive) {
                // Trial still active
                const remainingDays = Math.ceil((new Date(existingTrial.endDate) - now) / (1000 * 60 * 60 * 24));
                const interviewCount = existingTrial.interviewPageCreationCount || 0;
                
                return {
                    success: true,
                    message: "Free trial is already active",
                    data: {
                        userId: existingTrial.userId,
                        planType: "free_trial",
                        status: "active",
                        startDate: existingTrial.startDate,
                        endDate: existingTrial.endDate,
                        remainingDays: remainingDays,
                        trialDuration: 14,
                        interviewPageCreationCount: interviewCount,
                        features: {
                            accessLevel: "basic",
                            maxInterviews: 5,
                            analytics: false,
                            customBranding: false
                        },
                        restrictions: {
                            upgradeRequired: false,
                            nextAction: "continue_using"
                        },
                        usage: {
                            interviewsCreated: interviewCount,
                            interviewsRemaining: Math.max(0, 5 - interviewCount),
                            canCreateMore: interviewCount < 5,
                            limitReached: interviewCount >= 5
                        }
                    }
                };
            } else {
                // Trial has expired
                return {
                    success: false,
                    message: "Free trial has expired. Please upgrade to continue using the service.",
                    error: "TRIAL_EXPIRED",
                    data: {
                        userId: userId,
                        planType: "free_trial",
                        status: "expired",
                        startDate: existingTrial.startDate,
                        endDate: existingTrial.endDate,
                        expiredDays: Math.ceil((now - new Date(existingTrial.endDate)) / (1000 * 60 * 60 * 24)),
                        availablePlans: [
                            {
                                type: "personal",
                                name: "Personal Plan",
                                features: ["Unlimited interviews", "Extended video length", "Basic analytics"]
                            },
                            {
                                type: "business", 
                                name: "Business Plan",
                                features: ["Everything in Personal", "Advanced analytics", "Custom branding", "Team management"]
                            }
                        ],
                        upgradeUrl: "/upgrade",
                        restrictions: {
                            upgradeRequired: true,
                            nextAction: "purchase_subscription"
                        }
                    }
                };
            }
        }

        // Create new free trial
        const trialEndDate = calculateTrialEndDate(now, 14);
        const trialData = {
            userId: userId,
            startDate: now.toISOString(),
            endDate: trialEndDate.toISOString(),
            activatedAt: now.toISOString(),
            status: "active",
            trialDuration: 14,
            interviewPageCreationCount: 0,
            lastInterviewCreated: null
        };

        // Store in memory
        freeTrials.set(userId, trialData);

        // Success response for new trial activation
        return {
            success: true,
            message: "Free trial activated successfully",
            data: {
                userId: trialData.userId,
                planType: "free_trial",
                status: "active",
                startDate: trialData.startDate,
                endDate: trialData.endDate,
                remainingDays: 14,
                trialDuration: 14,
                interviewPageCreationCount: trialData.interviewPageCreationCount,
                features: {
                    accessLevel: "basic",
                    maxInterviews: 5,
                    analytics: false,
                    customBranding: false
                },
                restrictions: {
                    upgradeRequired: false,
                    nextAction: "start_using"
                },
                usage: {
                    interviewsCreated: trialData.interviewPageCreationCount,
                    interviewsRemaining: 5 - trialData.interviewPageCreationCount,
                    canCreateMore: true
                },
                welcomeMessage: "Welcome to your 14-day free trial! Explore all the basic features."
            }
        };

    } catch (error) {
        console.error('[manageSubscriptions] Error activating free trial:', error);
        return {
            success: false,
            message: "Internal server error while activating free trial",
            error: "INTERNAL_SERVER_ERROR"
        };
    }
};

// Function to check trial status
const checkTrialStatus = (userId) => {
    console.log('Input parameters:', { userId });

    if (!userId) {
        console.log('Error: Missing userId');
        return {
            success: false,
            message: "userId is required",
            error: "MISSING_USER_ID"
        };
    }

    const trialData = freeTrials.get(userId);
    
    if (!trialData) {
        return {
            success: false,
            message: "No trial found for this user",
            error: "TRIAL_NOT_FOUND",
            data: {
                userId: userId,
                hasActiveTrial: false,
                suggestions: {
                    action: "activate_trial",
                    endpoint: "/activatefreetrial"
                }
            }
        };
    }

    const isActive = isTrialActive(trialData);
    const now = new Date();
    
    if (isActive) {
        const remainingDays = Math.ceil((new Date(trialData.endDate) - now) / (1000 * 60 * 60 * 24));
        
        return {
            success: true,
            message: "Trial status retrieved successfully",
            data: {
                userId: trialData.userId,
                planType: "free_trial",
                status: "active",
                startDate: trialData.startDate,
                endDate: trialData.endDate,
                remainingDays: remainingDays,
                hasActiveTrial: true
            }
        };
    } else {
        const expiredDays = Math.ceil((now - new Date(trialData.endDate)) / (1000 * 60 * 60 * 24));
        
        return {
            success: true,
            message: "Trial status retrieved successfully",
            data: {
                userId: trialData.userId,
                planType: "free_trial",
                status: "expired",
                startDate: trialData.startDate,
                endDate: trialData.endDate,
                expiredDays: expiredDays,
                hasActiveTrial: false,
                upgradeRequired: true
            }
        };
    }
};

/**
 * POST /activatefreetrial
 * Activates a 14-day free trial for a user
 */
router.post('/activatefreetrial', async (req, res) => {
    console.log('Received POST request to /activatefreetrial');
    console.log('Request body:', req.body);

    const { userId } = req.body;

    if (!userId) {
        console.log('Bad Request: Missing userId');
        return res.status(400).json({
            success: false,
            message: "userId is required",
            error: "MISSING_USER_ID"
        });
    }

    try {
        console.log('Processing request for userId:', userId);
        const response = await activateFreeTrial(userId);

        console.log('Sending response:', {
            success: response.success,
            message: response.message,
            dataPresent: !!response.data
        });

        const statusCode = response.success ? (response.data?.status === 'active' && response.message.includes('already') ? 200 : 201) : 
                          (response.error === 'TRIAL_EXPIRED' ? 403 : 400);

        res.status(statusCode).json(response);
    } catch (error) {
        console.error('Route Handler Error:', {
            message: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: error.message || "An error occurred while activating free trial.",
            error: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * GET /checktrialstatus (with query parameter)
 * Alternative endpoint that accepts userId as query parameter
 */
router.get('/checktrialstatus', (req, res) => {
    console.log('Received GET request to /checktrialstatus (query)');
    console.log('Request query:', req.query);

    const { userId } = req.query;
    
    try {
        console.log('Processing request for userId:', userId);
        const response = checkTrialStatus(userId);

        console.log('Sending response:', {
            success: response.success,
            message: response.message,
            dataPresent: !!response.data
        });

        const statusCode = response.success ? 200 : (response.error === 'TRIAL_NOT_FOUND' ? 404 : 400);
        res.status(statusCode).json(response);

    } catch (error) {
        console.error('Route Handler Error:', {
            message: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: error.message || "An error occurred while checking trial status.",
            error: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * POST /incrementinterviewcount
 * Increment interview creation count for a user
 */
router.post('/incrementinterviewcount', (req, res) => {
    console.log('Received POST request to /incrementinterviewcount');
    console.log('Request body:', req.body);

    const { userId } = req.body;

    if (!userId) {
        console.log('Bad Request: Missing userId');
        return res.status(400).json({
            success: false,
            message: "userId is required",
            error: "MISSING_USER_ID"
        });
    }

    try {
        console.log('Processing request for userId:', userId);
        
        // Check if user can create more interviews
        if (!canCreateInterview(userId)) {
            const trialData = freeTrials.get(userId);
            const currentCount = trialData ? (trialData.interviewPageCreationCount || 0) : 0;
            
            return res.status(403).json({
                success: false,
                message: "Interview creation limit reached or trial expired",
                error: "LIMIT_EXCEEDED",
                data: {
                    userId: userId,
                    currentCount: currentCount,
                    maxAllowed: 5,
                    suggestions: {
                        action: "upgrade_subscription",
                        message: "Upgrade to Personal or Business plan for unlimited interviews"
                    }
                }
            });
        }

        // Increment the count
        const newCount = incrementInterviewCount(userId);
        const trialData = freeTrials.get(userId);

        console.log('Sending response:', {
            success: true,
            newCount: newCount
        });

        res.status(200).json({
            success: true,
            message: "Interview count updated successfully",
            data: {
                userId: userId,
                interviewPageCreationCount: newCount,
                interviewsRemaining: Math.max(0, 5 - newCount),
                canCreateMore: newCount < 5,
                limitReached: newCount >= 5,
                lastInterviewCreated: trialData.lastInterviewCreated
            }
        });

    } catch (error) {
        console.error('Route Handler Error:', {
            message: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: error.message || "An error occurred while updating interview count.",
            error: "INTERNAL_SERVER_ERROR"
        });
    }
});

module.exports = {
    router,
    activateFreeTrial,
    checkTrialStatus,
    incrementInterviewCount,
    canCreateInterview
};
