const express = require("express");
const axios = require("axios");
const router = express.Router();

const { getLinkedInAccountStatus } = require("../uniplieApi/linkedinAccountService");

const getBaseUrl = () => {
  return `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}/api/v1`;
};

const getHeaders = (contentType = "application/json") => ({
  "X-API-KEY": process.env.UNIPILE_API_KEY,
  Accept: "application/json",
  ...(contentType && { "Content-Type": contentType }),
});

router.post("/api/sales-leads/fetch/saved-leads", async (req, res) => {
  try {
    const { userId, salesNavUrl, limit = 25 } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    if (!salesNavUrl) {
      return res.status(400).json({
        success: false,
        error: "salesNavUrl is required",
      });
    }

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: "limit must be a number between 1 and 100",
      });
    }

    const accountResult = await getLinkedInAccountStatus(userId);
    if (!accountResult.success || !accountResult.account_id) {
      console.log(`[sales-leads] User ${userId}: No LinkedIn account found`);
      return res.status(404).json({
        success: false,
        error: accountResult.message || "No LinkedIn account found for this user",
      });
    }

    const accountId = accountResult.account_id;
    console.log(`[sales-leads] User ${userId} -> accountId=${accountId}`);

    console.log(`[sales-leads] User ${userId}: Fetching /users/me to check SN status...`);
    const meResponse = await axios.get(
      `${getBaseUrl()}/users/me?account_id=${accountId}`,
      { headers: getHeaders(), timeout: 5000 },
    );

    console.log(`[sales-leads] User ${userId}: /users/me raw response keys:`, Object.keys(meResponse.data || {}));
    console.log(`[sales-leads] User ${userId}: me.sales_navigator =`, JSON.stringify(meResponse.data?.sales_navigator));
    console.log(`[sales-leads] User ${userId}: me.premium_features =`, JSON.stringify(meResponse.data?.premium_features));
    console.log(`[sales-leads] User ${userId}: me.premium =`, meResponse.data?.premium);
    console.log(`[sales-leads] User ${userId}: me.recruiter =`, JSON.stringify(meResponse.data?.recruiter));

    const salesNav = meResponse.data?.sales_navigator || meResponse.data?.premium_features?.sales_navigator;
    console.log(`[sales-leads] User ${userId}: resolved salesNav =`, JSON.stringify(salesNav));
    console.log(`[sales-leads] User ${userId}: salesNav is null/undefined?`, salesNav == null);
    console.log(`[sales-leads] User ${userId}: salesNav type =`, typeof salesNav);
    console.log(`[sales-leads] User ${userId}: salesNav.error =`, salesNav?.error);

    if (salesNav == null) {
      console.log(`[sales-leads] User ${userId}: NO Sales Navigator at all (null/undefined) — blocking request`);
      return res.status(403).json({
        success: false,
        account_id: accountId,
        error: "This LinkedIn account does not have a Sales Navigator subscription",
        sales_navigator: meResponse.data?.sales_navigator || null,
        detail: `User ${userId}: standard LinkedIn account — upgrade to Sales Navigator to access saved leads`
      });
    }

    if (salesNav && (salesNav.error || salesNav === false)) {
      let reconnect_url = null;
      try {
        const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const authResponse = await axios.post(
          `${getBaseUrl()}/hosted/accounts/link`,
          {
            type: "reconnect",
            reconnect_account: accountId,
            providers: ["LINKEDIN"],
            expiresOn,
            api_url: `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}`,
          },
          { headers: getHeaders(), timeout: 5000 },
        );
        reconnect_url = authResponse.data?.url || null;
      } catch (authError) {
        console.error("Failed to generate reconnect link:", authError.message);
      }

      console.log(`[sales-leads] User ${userId}: SN DISCONNECTED — salesNav=`, JSON.stringify(salesNav));
      console.log(`[sales-leads] User ${userId}: Generated reconnect_url=`, reconnect_url || "FAILED");

      return res.status(403).json({
        success: false,
        account_id: accountId,
        error: "Sales Navigator is not connected or has expired for this account",
        sales_navigator: salesNav,
        ...(reconnect_url && { reconnect_url }),
        detail: reconnect_url
          ? "Open reconnect_url in your browser and log into your LinkedIn Sales Navigator account"
          : "Please reconnect Sales Navigator via /api/unipile/auth/link",
      });
    }

    console.log(`[sales-leads] User ${userId}: SN status OK — proceeding with search`);

    const params = new URLSearchParams();
    params.append("account_id", accountId);
    params.append("limit", limit);

    console.log(`[sales-leads] User ${userId}: Search URL: ${salesNavUrl}, limit: ${limit}`);

    const searchResponse = await axios.post(
      `${getBaseUrl()}/linkedin/search?${params}`,
      { url: salesNavUrl },
      { headers: getHeaders() },
    );

    console.log(`[sales-leads] User ${userId}: Search SUCCESS — results_count=${searchResponse.data?.items?.length || 0}`);
    console.log(`[sales-leads] User ${userId}: Search cursor=`, searchResponse.data?.cursor || null);

    return res.json({
      success: true,
      account_id: accountId,
      results_count: searchResponse.data?.items?.length || 0,
      leads: searchResponse.data?.items || [],
      cursor: searchResponse.data?.cursor || null,
    });
  } catch (error) {
    console.error(`[sales-leads] CAUGHT ERROR:`, {
      userId: error.config?.data ? JSON.parse(error.config.data).userId : null,
      message: error.message,
      status: error.response?.status,
      type: error.response?.data?.type,
      title: error.response?.data?.title,
      detail: error.response?.data?.detail,
      fullData: error.response?.data,
      configUrl: error.config?.url,
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message || "Failed to search sales leads",
    });
  }
});

module.exports = router;
