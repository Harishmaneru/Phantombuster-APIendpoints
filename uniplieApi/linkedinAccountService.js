// const { MongoClient } = require("mongodb");

// // MongoDB connection using environment variable
// const url = process.env.ONEPGR_MONGO_URI;
// let client, LinkedInAccounts;

// async function connectMongoDb() {
//   try {
//     if (!process.env.ONEPGR_MONGO_URI) {
//       console.warn(
//         "⚠️ ONEPGR_MONGO_URI environment variable not set, using default localhost connection",
//       );
//     }

//     client = await MongoClient.connect(url);
//     LinkedInAccounts = client
//       .db("onepgr_apps")
//       .collection("unipile-LinkedIn-data");
//     console.log(
//       "------------------LinkedIn Accounts MongoDB Connected---------------",
//     );
//   } catch (err) {
//     console.error("MongoDB connection error:", err);
//     process.exit(1);
//   }
// }

// // Initialize connection
// connectMongoDb();

// /**
//  * Connect a LinkedIn account to a user
//  * @param {string} userId - User ID
//  * @param {string} accountId - Unipile account ID
//  * @param {string} provider - Provider (LINKEDIN)
//  * @param {string} name - Account name
//  * @param {Object} metadata - Additional metadata
//  * @returns {Promise<Object>} - Result of the operation
//  */
// async function connectLinkedInAccount(
//   userId,
//   accountId,
//   provider = "LINKEDIN",
//   name = null,
//   metadata = {},
// ) {
//   try {
//     const accountData = {
//       user_id: userId,
//       account_id: accountId,
//       provider: provider,
//       name: name,
//       connected: true,
//       connected_at: new Date(),
//       last_error: null,
//       metadata: metadata,
//       created_at: new Date(),
//       updated_at: new Date(),
//     };

//     // Check if user already has a LinkedIn account
//     const existingAccount = await LinkedInAccounts.findOne({
//       user_id: userId,
//       provider: "LINKEDIN",
//     });

//     if (existingAccount) {
//       // Update existing account
//       const result = await LinkedInAccounts.updateOne(
//         { user_id: userId, provider: "LINKEDIN" },
//         {
//           $set: {
//             account_id: accountId,
//             name: name,
//             connected: true,
//             connected_at: new Date(),
//             last_error: null,
//             metadata: metadata,
//             updated_at: new Date(),
//           },
//         },
//       );

//       console.log(
//         `✅ Updated LinkedIn account for user ${userId}: ${accountId}`,
//       );
//       return {
//         success: true,
//         message: "LinkedIn account updated successfully",
//         account_id: accountId,
//         action: "updated",
//       };
//     } else {
//       // Create new account
//       const result = await LinkedInAccounts.insertOne(accountData);
//       console.log(
//         `✅ Created new LinkedIn account for user ${userId}: ${accountId}`,
//       );
//       return {
//         success: true,
//         message: "LinkedIn account connected successfully",
//         account_id: accountId,
//         action: "created",
//       };
//     }
//   } catch (error) {
//     console.error("Error connecting LinkedIn account:", error);
//     return {
//       success: false,
//       message: "Failed to connect LinkedIn account",
//       error: error.message,
//     };
//   }
// }

// /**
//  * Disconnect a LinkedIn account
//  * @param {string} userId - User ID
//  * @param {string} reason - Reason for disconnection
//  * @returns {Promise<Object>} - Result of the operation
//  */
// async function disconnectLinkedInAccount(userId, reason = "User disconnected") {
//   try {
//     const result = await LinkedInAccounts.updateOne(
//       { user_id: userId, provider: "LINKEDIN" },
//       {
//         $set: {
//           connected: false,
//           last_error: reason,
//           disconnected_at: new Date(),
//           updated_at: new Date(),
//         },
//       },
//     );

//     if (result.matchedCount === 0) {
//       return {
//         success: false,
//         message: "No LinkedIn account found for this user",
//       };
//     }

//     console.log(
//       `❌ Disconnected LinkedIn account for user ${userId}: ${reason}`,
//     );
//     return {
//       success: true,
//       message: "LinkedIn account disconnected successfully",
//       reason: reason,
//     };
//   } catch (error) {
//     console.error("Error disconnecting LinkedIn account:", error);
//     return {
//       success: false,
//       message: "Failed to disconnect LinkedIn account",
//       error: error.message,
//     };
//   }
// }

// /**
//  * Get LinkedIn account status for a user
//  * @param {string} userId - User ID
//  * @returns {Promise<Object>} - Account status
//  */
// async function getLinkedInAccountStatus(userId) {
//   try {
//     const account = await LinkedInAccounts.findOne({
//       user_id: userId,
//       provider: "LINKEDIN",
//     });

//     if (!account) {
//       return {
//         success: true,
//         connected: false,
//         message: "No LinkedIn account found",
//       };
//     }

//     return {
//       success: true,
//       connected: account.connected,
//       account_id: account.account_id,
//       name: account.name,
//       connected_at: account.connected_at,
//       last_error: account.last_error,
//       metadata: account.metadata,
//     };
//   } catch (error) {
//     console.error("Error getting LinkedIn account status:", error);
//     return {
//       success: false,
//       message: "Failed to get LinkedIn account status",
//       error: error.message,
//     };
//   }
// }

// /**
//  * Refresh LinkedIn account (replace with new account_id)
//  * @param {string} userId - User ID
//  * @param {string} newAccountId - New Unipile account ID
//  * @param {string} name - Account name
//  * @param {Object} metadata - Additional metadata
//  * @returns {Promise<Object>} - Result of the operation
//  */
// async function refreshLinkedInAccount(
//   userId,
//   newAccountId,
//   name = null,
//   metadata = {},
// ) {
//   try {
//     const result = await LinkedInAccounts.updateOne(
//       { user_id: userId, provider: "LINKEDIN" },
//       {
//         $set: {
//           account_id: newAccountId,
//           name: name,
//           connected: true,
//           connected_at: new Date(),
//           last_error: null,
//           metadata: metadata,
//           updated_at: new Date(),
//         },
//       },
//     );

//     if (result.matchedCount === 0) {
//       // If no existing account, create a new one
//       return await connectLinkedInAccount(
//         userId,
//         newAccountId,
//         "LINKEDIN",
//         name,
//         metadata,
//       );
//     }

//     console.log(
//       `🔄 Refreshed LinkedIn account for user ${userId}: ${newAccountId}`,
//     );
//     return {
//       success: true,
//       message: "LinkedIn account refreshed successfully",
//       account_id: newAccountId,
//       action: "refreshed",
//     };
//   } catch (error) {
//     console.error("Error refreshing LinkedIn account:", error);
//     return {
//       success: false,
//       message: "Failed to refresh LinkedIn account",
//       error: error.message,
//     };
//   }
// }

// /**
//  * Handle account error from webhook
//  * @param {string} accountId - Unipile account ID
//  * @param {string} error - Error message
//  * @returns {Promise<Object>} - Result of the operation
//  */
// async function handleAccountError(accountId, error) {
//   try {
//     const result = await LinkedInAccounts.updateOne(
//       { account_id: accountId },
//       {
//         $set: {
//           connected: false,
//           last_error: error,
//           error_occurred_at: new Date(),
//           updated_at: new Date(),
//         },
//       },
//     );

//     if (result.matchedCount === 0) {
//       console.warn(`⚠️ Account ${accountId} not found in database`);
//       return {
//         success: false,
//         message: "Account not found in database",
//       };
//     }

//     console.log(
//       `⚠️ Marked LinkedIn account ${accountId} as disconnected due to error: ${error}`,
//     );
//     return {
//       success: true,
//       message: "Account error handled successfully",
//       account_id: accountId,
//       error: error,
//     };
//   } catch (error) {
//     console.error("Error handling account error:", error);
//     return {
//       success: false,
//       message: "Failed to handle account error",
//       error: error.message,
//     };
//   }
// }

// /**
//  * Update LinkedIn account status by account ID
//  * @param {string} accountId - Unipile account ID
//  * @param {string} status - New status
//  * @param {Object} webhookData - Full webhook payload
//  * @returns {Promise<Object>} - Result of the operation
//  */
// async function updateLinkedInAccountStatusByAccountId(
//   accountId,
//   status,
//   webhookData = {},
// ) {
//   try {
//     const updateFields = {
//       status: status,
//       updated_at: new Date(),
//       webhook_data: webhookData,
//     };

//     // If status is OK, mark as connected
//     if (
//       status === "OK" ||
//       status === "CREATION_SUCCESS" ||
//       status === "SYNC_SUCCESS"
//     ) {
//       updateFields.connected = true;
//       updateFields.last_error = null;
//       updateFields.connected_at = new Date(); // Update connected time only on fresh success
//     }
//     // If status indicates an issue but not full failure (e.g., STOPPED, CREDENTIALS)
//     else if (
//       status === "STOPPED" ||
//       status === "CREDENTIALS" ||
//       status === "ERROR"
//     ) {
//       updateFields.connected = false;
//       updateFields.last_error = `Account status: ${status}`;
//     }

//     const result = await LinkedInAccounts.updateOne(
//       { account_id: accountId },
//       { $set: updateFields },
//     );

//     if (result.matchedCount === 0) {
//       console.warn(
//         `⚠️ Account ${accountId} not found in database for status update: ${status}`,
//       );
//       return {
//         success: false,
//         message: "Account not found in database",
//         match_count: 0,
//       };
//     }

//     console.log(`✅ Updated account ${accountId} status to ${status}`);
//     return {
//       success: true,
//       message: "Account status updated",
//       account_id: accountId,
//       status: status,
//     };
//   } catch (error) {
//     console.error("Error updating account status by ID:", error);
//     return {
//       success: false,
//       message: "Failed to update account status",
//       error: error.message,
//     };
//   }
// }

// /**
//  * Get all LinkedIn accounts (for admin purposes)
//  * @param {Object} filters - Optional filters
//  * @returns {Promise<Object>} - List of accounts
//  */
// async function getAllLinkedInAccounts(filters = {}) {
//   try {
//     const accounts = await LinkedInAccounts.find(filters).toArray();
//     return {
//       success: true,
//       accounts: accounts,
//       count: accounts.length,
//     };
//   } catch (error) {
//     console.error("Error getting all LinkedIn accounts:", error);
//     return {
//       success: false,
//       message: "Failed to get LinkedIn accounts",
//       error: error.message,
//     };
//   }
// }

// /**
//  * Delete LinkedIn account completely
//  * @param {string} userId - User ID
//  * @returns {Promise<Object>} - Result of the operation
//  */
// async function deleteLinkedInAccount(userId) {
//   try {
//     const result = await LinkedInAccounts.deleteOne({
//       user_id: userId,
//       provider: "LINKEDIN",
//     });

//     if (result.deletedCount === 0) {
//       return {
//         success: false,
//         message: "No LinkedIn account found for this user",
//       };
//     }

//     console.log(`🗑️ Deleted LinkedIn account for user ${userId}`);
//     return {
//       success: true,
//       message: "LinkedIn account deleted successfully",
//     };
//   } catch (error) {
//     console.error("Error deleting LinkedIn account:", error);
//     return {
//       success: false,
//       message: "Failed to delete LinkedIn account",
//       error: error.message,
//     };
//   }
// }

// module.exports = {
//   connectLinkedInAccount,
//   disconnectLinkedInAccount,
//   getLinkedInAccountStatus,
//   refreshLinkedInAccount,
//   handleAccountError,
//   getAllLinkedInAccounts,
//   deleteLinkedInAccount,
//   updateLinkedInAccountStatusByAccountId,
// };

const { MongoClient } = require("mongodb");

// MongoDB connection using environment variable
const url = process.env.ONEPGR_MONGO_URI;
let client, LinkedInAccounts;
let connectionPromise = null;

/**
 * Enhanced connection logic to prevent race conditions.
 * Ensures only one connection attempt is made even if multiple functions call it simultaneously.
 */
async function connectMongoDb() {
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      if (!process.env.ONEPGR_MONGO_URI) {
        console.warn(
          "⚠️ ONEPGR_MONGO_URI environment variable not set, using default localhost connection",
        );
      }

      client = await MongoClient.connect(url || "mongodb://localhost:27017");
      LinkedInAccounts = client
        .db("onepgr_apps")
        .collection("unipile-LinkedIn-data");

      console.log(
        "------------------LinkedIn Accounts MongoDB Connected---------------",
      );
      return true;
    } catch (err) {
      console.error("MongoDB connection error:", err);
      connectionPromise = null; // Reset to allow retry on next call
      throw err;
    }
  })();

  return connectionPromise;
}

/**
 * Helper to ensure the database is connected before executing any query.
 */
async function ensureConnected() {
  if (!LinkedInAccounts) {
    await connectMongoDb();
  }
}

// Start connection attempt immediately on file load
connectMongoDb().catch(() => {});

/**
 * Connect a LinkedIn account to a user
 * @param {string} userId - User ID
 * @param {string} accountId - Unipile account ID
 * @param {string} provider - Provider (LINKEDIN)
 * @param {string} name - Account name
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} - Result of the operation
 */
async function connectLinkedInAccount(
  userId,
  accountId,
  provider = "LINKEDIN",
  name = null,
  metadata = {},
) {
  await ensureConnected();
  try {
    const updateData = {
      user_id: userId,
      account_id: accountId,
      provider: provider,
      name: name,
      connected: true,
      connected_at: new Date(),
      last_error: null,
      metadata: metadata,
      updated_at: new Date(),
    };

    // Using upsert prevents issues where the user might double-click the connect button
    const result = await LinkedInAccounts.updateOne(
      { user_id: userId, provider: "LINKEDIN" },
      {
        $set: updateData,
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true },
    );

    const action = result.upsertedCount > 0 ? "created" : "updated";
    console.log(
      `✅ ${action === "created" ? "Created new" : "Updated"} LinkedIn account for user ${userId}: ${accountId}`,
    );

    return {
      success: true,
      message: `LinkedIn account ${action} successfully`,
      account_id: accountId,
      action: action,
    };
  } catch (error) {
    console.error("Error connecting LinkedIn account:", error);
    return {
      success: false,
      message: "Failed to connect LinkedIn account",
      error: error.message,
    };
  }
}

/**
 * Disconnect a LinkedIn account
 * @param {string} userId - User ID
 * @param {string} reason - Reason for disconnection
 * @returns {Promise<Object>} - Result of the operation
 */
async function disconnectLinkedInAccount(userId, reason = "User disconnected") {
  await ensureConnected();
  try {
    const result = await LinkedInAccounts.updateOne(
      { user_id: userId, provider: "LINKEDIN" },
      {
        $set: {
          connected: false,
          last_error: reason,
          disconnected_at: new Date(),
          updated_at: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return {
        success: false,
        message: "No LinkedIn account found for this user",
      };
    }

    console.log(
      `❌ Disconnected LinkedIn account for user ${userId}: ${reason}`,
    );
    return {
      success: true,
      message: "LinkedIn account disconnected successfully",
      reason: reason,
    };
  } catch (error) {
    console.error("Error disconnecting LinkedIn account:", error);
    return {
      success: false,
      message: "Failed to disconnect LinkedIn account",
      error: error.message,
    };
  }
}

/**
 * Get LinkedIn account status for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Account status
 */
async function getLinkedInAccountStatus(userId) {
  await ensureConnected();
  try {
    const account = await LinkedInAccounts.findOne({
      user_id: userId,
      provider: "LINKEDIN",
    });

    if (!account) {
      return {
        success: true,
        connected: false,
        message: "No LinkedIn account found",
      };
    }

    return {
      success: true,
      connected: account.connected,
      account_id: account.account_id,
      name: account.name,
      connected_at: account.connected_at,
      last_error: account.last_error,
      metadata: account.metadata,
    };
  } catch (error) {
    console.error("Error getting LinkedIn account status:", error);
    return {
      success: false,
      message: "Failed to get LinkedIn account status",
      error: error.message,
    };
  }
}

/**
 * Refresh LinkedIn account (replace with new account_id)
 * @param {string} userId - User ID
 * @param {string} newAccountId - New Unipile account ID
 * @param {string} name - Account name
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} - Result of the operation
 */
async function refreshLinkedInAccount(
  userId,
  newAccountId,
  name = null,
  metadata = {},
) {
  await ensureConnected();
  try {
    const result = await LinkedInAccounts.updateOne(
      { user_id: userId, provider: "LINKEDIN" },
      {
        $set: {
          account_id: newAccountId,
          name: name,
          connected: true,
          connected_at: new Date(),
          last_error: null,
          metadata: metadata,
          updated_at: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      // If no existing account, create a new one using the connect function
      return await connectLinkedInAccount(
        userId,
        newAccountId,
        "LINKEDIN",
        name,
        metadata,
      );
    }

    console.log(
      `🔄 Refreshed LinkedIn account for user ${userId}: ${newAccountId}`,
    );
    return {
      success: true,
      message: "LinkedIn account refreshed successfully",
      account_id: newAccountId,
      action: "refreshed",
    };
  } catch (error) {
    console.error("Error refreshing LinkedIn account:", error);
    return {
      success: false,
      message: "Failed to refresh LinkedIn account",
      error: error.message,
    };
  }
}

/**
 * Handle account error from webhook
 * @param {string} accountId - Unipile account ID
 * @param {string} error - Error message
 * @returns {Promise<Object>} - Result of the operation
 */
async function handleAccountError(accountId, error) {
  await ensureConnected();
  try {
    const result = await LinkedInAccounts.updateOne(
      { account_id: accountId },
      {
        $set: {
          connected: false,
          last_error: error,
          error_occurred_at: new Date(),
          updated_at: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      console.warn(`⚠️ Account ${accountId} not found in database`);
      return {
        success: false,
        message: "Account not found in database",
      };
    }

    console.log(
      `⚠️ Marked LinkedIn account ${accountId} as disconnected due to error: ${error}`,
    );
    return {
      success: true,
      message: "Account error handled successfully",
      account_id: accountId,
      error: error,
    };
  } catch (error) {
    console.error("Error handling account error:", error);
    return {
      success: false,
      message: "Failed to handle account error",
      error: error.message,
    };
  }
}

/**
 * Update LinkedIn account status by account ID
 * @param {string} accountId - Unipile account ID
 * @param {string} status - New status
 * @param {Object} webhookData - Full webhook payload
 * @returns {Promise<Object>} - Result of the operation
 */
async function updateLinkedInAccountStatusByAccountId(
  accountId,
  status,
  webhookData = {},
) {
  await ensureConnected();
  try {
    const updateFields = {
      status: status,
      updated_at: new Date(),
      webhook_data: webhookData,
    };

    // If status is OK, mark as connected
    if (
      status === "OK" ||
      status === "CREATION_SUCCESS" ||
      status === "SYNC_SUCCESS"
    ) {
      updateFields.connected = true;
      updateFields.last_error = null;
      updateFields.connected_at = new Date(); // Update connected time only on fresh success
    }
    // If status indicates an issue but not full failure (e.g., STOPPED, CREDENTIALS)
    else if (
      status === "STOPPED" ||
      status === "CREDENTIALS" ||
      status === "ERROR"
    ) {
      updateFields.connected = false;
      updateFields.last_error = `Account status: ${status}`;
    }

    const result = await LinkedInAccounts.updateOne(
      { account_id: accountId },
      { $set: updateFields },
    );

    if (result.matchedCount === 0) {
      console.warn(
        `⚠️ Account ${accountId} not found in database for status update: ${status}`,
      );
      return {
        success: false,
        message: "Account not found in database",
        match_count: 0,
      };
    }

    console.log(`✅ Updated account ${accountId} status to ${status}`);
    return {
      success: true,
      message: "Account status updated",
      account_id: accountId,
      status: status,
    };
  } catch (error) {
    console.error("Error updating account status by ID:", error);
    return {
      success: false,
      message: "Failed to update account status",
      error: error.message,
    };
  }
}

/**
 * Get all LinkedIn accounts (for admin purposes)
 * @param {Object} filters - Optional filters
 * @returns {Promise<Object>} - List of accounts
 */
async function getAllLinkedInAccounts(filters = {}) {
  await ensureConnected();
  try {
    const accounts = await LinkedInAccounts.find(filters).toArray();
    return {
      success: true,
      accounts: accounts,
      count: accounts.length,
    };
  } catch (error) {
    console.error("Error getting all LinkedIn accounts:", error);
    return {
      success: false,
      message: "Failed to get LinkedIn accounts",
      error: error.message,
    };
  }
}

/**
 * Delete LinkedIn account completely
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Result of the operation
 */
async function deleteLinkedInAccount(userId) {
  await ensureConnected();
  try {
    const result = await LinkedInAccounts.deleteOne({
      user_id: userId,
      provider: "LINKEDIN",
    });

    if (result.deletedCount === 0) {
      return {
        success: false,
        message: "No LinkedIn account found for this user",
      };
    }

    console.log(`Deleted LinkedIn account for user ${userId}`);
    return {
      success: true,
      message: "LinkedIn account deleted successfully",
    };
  } catch (error) {
    console.error("Error deleting LinkedIn account:", error);
    return {
      success: false,
      message: "Failed to delete LinkedIn account",
      error: error.message,
    };
  }
}

module.exports = {
  connectLinkedInAccount,
  disconnectLinkedInAccount,
  getLinkedInAccountStatus,
  refreshLinkedInAccount,
  handleAccountError,
  getAllLinkedInAccounts,
  deleteLinkedInAccount,
  updateLinkedInAccountStatusByAccountId,
};
