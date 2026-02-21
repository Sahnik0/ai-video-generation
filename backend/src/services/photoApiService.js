const axios = require("axios");

const PHOTO_API_URL = "https://photo-api-1-ydcq.onrender.com/search/bulk";

const buildKeyword = (text) => {
  return String(text || "").trim();
};

const searchImagesForKeywords = async (keywords, maxResults = 1) => {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return { total_keywords: 0, successful: 0, failed: 0, results: [] };
  }

  const validKeywords = keywords.map((k) => String(k).trim()).filter(Boolean);

  console.log(`[photo-api] searching ${validKeywords.length} keywords via bulk endpoint`);

  try {
    const response = await axios.post(
      PHOTO_API_URL,
      {
        keywords: validKeywords,
        max_results: maxResults
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    const data = response.data;
    console.log(`[photo-api] bulk response: ${data.successful}/${data.total_keywords} succeeded`);

    return data;
  } catch (error) {
    console.error(`[photo-api] bulk request failed:`, error.message);
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
  }
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

