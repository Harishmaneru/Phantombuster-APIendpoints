const express = require("express");
const router = express.Router();
const axios = require("axios");
const { Country, State, City } = require("country-state-city");

// Initialize searchable location index in memory
// We want to support:
// 1. Country only: "United States"
// 2. State, Country: "California, United States"
// 3. City, State, Country: "Los Angeles, California, United States"

let locationIndex = [];
let isInitialized = false;

const initializeLocations = () => {
  if (isInitialized) return;

  console.log("Creating location search index...");
  const startTime = Date.now();

  const countries = Country.getAllCountries();
  const allStates = State.getAllStates();
  const allCities = City.getAllCities();

  // Helper maps for quick lookups
  const countryMap = new Map(countries.map((c) => [c.isoCode, c.name]));
  const stateMap = new Map(); // key: countryCode_stateCode, value: stateName

  // 1. Add Countries
  countries.forEach((c) => {
    locationIndex.push({
      id: `country-${c.isoCode}`,
      title: c.name,
      type: "Country",
      searchString: c.name.toLowerCase(),
      priority: 1, // Highest priority
    });
  });

  // 2. Add States
  allStates.forEach((s) => {
    const countryName = countryMap.get(s.countryCode);
    if (!countryName) return;

    stateMap.set(`${s.countryCode}_${s.isoCode}`, s.name);

    const title = `${s.name}, ${countryName}`;
    locationIndex.push({
      id: `state-${s.countryCode}-${s.isoCode}`,
      title: title,
      type: "State",
      searchString: title.toLowerCase(),
      priority: 2,
    });
  });

  // 3. Add Cities (Only for major countries initially to save memory if needed, but let's try all first)
  // Filtering to major countries can be an optimization if memory usage is too high
  // For now, loading all.
  let cityCount = 0;
  allCities.forEach((c) => {
    const countryName = countryMap.get(c.countryCode);
    if (!countryName) return;

    const stateName = stateMap.get(`${c.countryCode}_${c.stateCode}`);

    let title;
    if (stateName) {
      title = `${c.name}, ${stateName}, ${countryName}`;
    } else {
      title = `${c.name}, ${countryName}`;
    }

    locationIndex.push({
      id: `city-${c.countryCode}-${c.stateCode}-${c.name}`,
      title: title,
      type: "City",
      searchString: title.toLowerCase(),
      priority: 3,
    });
    cityCount++;
  });

  isInitialized = true;
  console.log(
    `Location index created with ${locationIndex.length} locations (Cities: ${cityCount}) in ${
      Date.now() - startTime
    }ms`,
  );
};

// Initialize manually or lazily. Let's do it on first import or server start.
// setTimeout ensures it doesn't block initial server startup immediately
setTimeout(initializeLocations, 1000);

router.get("/api/linkedin/search-locations", (req, res) => {
  try {
    const { keywords, q } = req.query;
    const query = (keywords || q || "").toLowerCase().trim();

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        result: [],
      });
    }

    if (!isInitialized) {
      initializeLocations();
    }

    // Basic filtering logic
    // Improve with scoring if needed. For now, simple includes.
    // Prioritize startsWith, then includes.

    const maxResults = 25;
    const matches = [];

    // Performance optimization: verify if we need a more efficient search structure later
    // For ~150k items, a simple filter might take a few ms.

    for (const loc of locationIndex) {
      if (loc.searchString.includes(query)) {
        matches.push(loc);
      }
      // Break early if we have enough matches is NOT possible with simple loop if we want quality sorting
      // We need to find all matches first to sort them, OR simple-sort as we go.
    }

    // Sort results:
    // 1. Exact match (rare)
    // 2. Starts with query
    // 3. Priority (Country > State > City)
    // 4. Alphabetical

    matches.sort((a, b) => {
      const aStarts = a.searchString.startsWith(query);
      const bStarts = b.searchString.startsWith(query);

      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      if (a.priority !== b.priority) return a.priority - b.priority;

      return a.title.localeCompare(b.title);
    });

    const results = matches.slice(0, maxResults).map((m) => ({
      locationId: m.id, // Using our generated ID as a stand-in for LinkedIn's ID
      title: m.title,
    }));

    return res.json({
      success: true,
      result: results,
    });
  } catch (error) {
    console.error("Location search error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during location search",
    });
  }
});

// ==================== INDUSTRY SEARCH ENDPOINT ====================
// Uses static LinkedIn industry lists (V1 & V2) for instant, free lookups
// Merged list prioritized for Sales Navigator (V2) but includes Classic (V1)
//
// Usage:
//   GET /api/linkedin/search-industries?keywords=soft
//   GET /api/linkedin/search-industries?q=tech

const { INDUSTRY_V1, INDUSTRY_V2 } = require("./linkedinIndustries");

// Pre-compute unified industry list (deduplicated by ID)
// Priority: V2 (Sales Navigator) > V1 (Classic)
const unifiedIndustriesDetails = new Map();

// 1. Add all V2 industries (Sales Nav) - Preferred
INDUSTRY_V2.forEach((item) => unifiedIndustriesDetails.set(item.id, item));

// 2. Add V1 industries only if ID doesn't exist (Classic)
INDUSTRY_V1.forEach((item) => {
  if (!unifiedIndustriesDetails.has(item.id)) {
    unifiedIndustriesDetails.set(item.id, item);
  }
});

const UNIFIED_INDUSTRIES = Array.from(unifiedIndustriesDetails.values());

router.get("/api/linkedin/search-industries", (req, res) => {
  try {
    const { keywords, q, limit = 25 } = req.query;

    const query = (keywords || q || "").trim().toLowerCase();

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        result: [],
      });
    }

    // Filter results from the unified list
    // 1. Exact match (rare)
    // 2. Starts with query
    // 3. Contains query
    const matches = UNIFIED_INDUSTRIES.filter((item) =>
      item.title.toLowerCase().includes(query),
    )
      .sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();

        // Exact match first
        if (aTitle === query) return -1;
        if (bTitle === query) return 1;

        // Starts with second
        const aStarts = aTitle.startsWith(query);
        const bStarts = bTitle.startsWith(query);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        // Alphabetical
        return aTitle.localeCompare(bTitle);
      })
      .slice(0, Number(limit));

    return res.json({
      success: true,
      result: matches,
      cached: true,
    });
  } catch (error) {
    console.error("Industry search error:", error.message);
    res.status(500).json({
      success: false,
      error: "Internal server error during industry search",
    });
  }
});

// ==================== COMPANY SEARCH ENDPOINT ====================
// Uses Clearbit's free Autocomplete API (no API key required)
// Provides LinkedIn-style company typeahead suggestions

// Simple in-memory cache with TTL (500ms)
const cache = new Map();
const CACHE_TTL = 500; // milliseconds

// Helper: slugify company name for LinkedIn URL
function slugifyCompanyName(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // remove non-alphanumeric except spaces/hyphens
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/--+/g, "-") // collapse multiple hyphens
    .replace(/^-+|-+$/g, ""); // trim hyphens from ends
}

router.get("/api/linkedin/search-companies", async (req, res) => {
  const start = Date.now();

  try {
    const { keywords, q } = req.query;
    const query = (keywords || q || "").trim();

    // Return empty if query is too short
    if (!query || query.length < 2) {
      return res.json({
        success: true,
        result: [],
        meta: { responseTimeMs: Date.now() - start },
      });
    }

    // Check cache first
    const cacheKey = `clearbit:${query}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      console.log(`[Cache hit] ${query} (${Date.now() - start}ms)`);
      return res.json({
        success: true,
        result: cached,
        meta: { cached: true, responseTimeMs: Date.now() - start },
      });
    }

    // Call Clearbit Autocomplete API (free, no auth)
    const response = await axios.get(
      "https://autocomplete.clearbit.com/v1/companies/suggest",
      {
        params: { query },
        timeout: 5000, // 5 seconds max
      },
    );

    const results = (response.data || [])
      .map((company) => {
        const slug = slugifyCompanyName(company.name);
        return {
          name: company.name,
          domain: company.domain,
          logo: company.logo,
          linkedinUrl: slug ? `https://www.linkedin.com/company/${slug}` : null,
        };
      })
      .filter((company) => {
        // Remove companies with empty LinkedIn URLs (non-Latin names)
        if (!company.linkedinUrl) return false;
        // Remove weak matches — company name should contain the search query
        const nameLower = company.name.toLowerCase();
        const queryLower = query.toLowerCase();
        return (
          nameLower.includes(queryLower) ||
          queryLower.includes(nameLower) ||
          (company.domain && company.domain.toLowerCase().includes(queryLower))
        );
      });

    // Store in cache
    cache.set(cacheKey, results);
    setTimeout(() => cache.delete(cacheKey), CACHE_TTL);

    console.log(`[Clearbit] ${query} (${Date.now() - start}ms)`);
    return res.json({
      success: true,
      result: results,
      meta: { cached: false, responseTimeMs: Date.now() - start },
    });
  } catch (error) {
    console.error(
      `Company search error (${Date.now() - start}ms):`,
      error.message,
    );

    // If Clearbit is down or times out, return empty with warning
    if (error.code === "ECONNABORTED" || error.response?.status >= 500) {
      return res.json({
        success: true,
        result: [],
        warning: "Company search service temporarily unavailable",
        meta: { responseTimeMs: Date.now() - start },
      });
    }

    // Unexpected errors – still return 500
    res.status(500).json({
      success: false,
      error: "Internal server error during company search",
      meta: { responseTimeMs: Date.now() - start },
    });
  }
});

module.exports = router;
