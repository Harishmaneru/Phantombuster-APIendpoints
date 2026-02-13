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
    `✅ Location index created with ${locationIndex.length} locations (Cities: ${cityCount}) in ${
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

// ==================== COMPANY SEARCH ENDPOINT ====================
// Uses Clearbit's free Autocomplete API (no API key required)
// Provides LinkedIn-style company typeahead suggestions

router.get("/api/linkedin/search-companies", async (req, res) => {
  try {
    const { keywords, q } = req.query;
    const query = (keywords || q || "").trim();

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        result: [],
      });
    }

    // Clearbit Autocomplete API - free, no auth required
    const response = await axios.get(
      "https://autocomplete.clearbit.com/v1/companies/suggest",
      {
        params: { query },
        timeout: 5000,
      },
    );

    const results = (response.data || []).map((company) => ({
      name: company.name,
      domain: company.domain,
      logo: company.logo,
    }));

    return res.json({
      success: true,
      result: results,
    });
  } catch (error) {
    console.error("Company search error:", error.message);

    // If Clearbit is down, return empty results instead of 500
    if (error.code === "ECONNABORTED" || error.response?.status >= 500) {
      return res.json({
        success: true,
        result: [],
        warning: "Company search service temporarily unavailable",
      });
    }

    res.status(500).json({
      success: false,
      error: "Internal server error during company search",
    });
  }
});

module.exports = router;
