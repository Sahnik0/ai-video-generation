const axios = require("axios");

const PHOTO_API_BASE = "https://photoscrapper.genifyapp.com";
const PHOTO_API_URL = `${PHOTO_API_BASE}/search/bulk`;

const buildKeyword = (text) => {
  return String(text || "").trim();
};

/**
 * Render free-tier services spin down after inactivity and return 503 while waking.
 * This pings the root endpoint and waits up to 90s for it to come alive before
 * the actual bulk search request is made.
 */
const wakeUpService = async () => {
  const maxWaitMs = 90000;
  const pollMs = 8000;
  const start = Date.now();
  console.log("[photo-api] pinging service to wake it up (Render free tier)...");

  while (Date.now() - start < maxWaitMs) {
    try {
      await axios.get(PHOTO_API_BASE, { timeout: 10000 });
      console.log(`[photo-api] service is awake (${Math.round((Date.now() - start) / 1000)}s)`);
      return true;
    } catch (err) {
      const status = err.response?.status;
      // 200/404/any non-503 means the server is up (404 is fine — root may not exist)
      if (status && status !== 503 && status !== 502) {
        console.log(`[photo-api] service awake (status ${status})`);
        return true;
      }
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`[photo-api] still waking up... ${elapsed}s elapsed (status ${status || err.code})`);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  console.warn("[photo-api] service did not wake within 90s — proceeding anyway");
  return false;
};

let serviceWoken = false; // only ping once per process lifetime

const searchImagesForKeywords = async (keywords, maxResults = 1) => {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return { total_keywords: 0, successful: 0, failed: 0, results: [] };
  }

  const validKeywords = keywords.map((k) => String(k).trim()).filter(Boolean);

  console.log(`[photo-api] searching ${validKeywords.length} keywords via bulk endpoint`);

  // Wake the Render service if we haven't yet this session
  if (!serviceWoken) {
    await wakeUpService();
    serviceWoken = true;
  }

  // Retry with progressively longer waits to survive remaining cold-start lag
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      console.log(`[photo-api] attempt ${attempt}/4...`);
      const response = await axios.post(
        PHOTO_API_URL,
        { keywords: validKeywords, max_results: maxResults, concurrency: 5 },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 120000
        }
      );

      const data = response.data;
      console.log(`[photo-api] bulk response: ${data.successful}/${data.total_keywords} succeeded`);
      return data;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const isTimeout = error.code === "ECONNABORTED" || error.message.includes("timeout");
      const reason = isTimeout ? "timeout" : `${error.message}${status ? ` (${status})` : ""}`;
      console.warn(`[photo-api] attempt ${attempt} failed: ${reason}`);

      if (attempt < 4) {
        // On 503 wait longer — service may still be booting
        const waitMs = status === 503 ? 20000 * attempt : 8000 * attempt;
        console.log(`[photo-api] retrying in ${waitMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  console.error("[photo-api] all 4 attempts failed:", lastError.message);
  return {
    total_keywords: validKeywords.length,
    successful: 0,
    failed: validKeywords.length,
    results: validKeywords.map((keyword) => ({
      keyword,
      success: false,
      result: null
    }))
  };
};

const searchImages = async (keyword, maxResults = 1) => {
  const keywords = [buildKeyword(keyword)];
  const response = await searchImagesForKeywords(keywords, maxResults);

  if (response.results && response.results.length > 0 && response.results[0].success) {
    return response.results[0].result.images || null;
  }
  return null;
};

module.exports = { searchImages, searchImagesForKeywords };

