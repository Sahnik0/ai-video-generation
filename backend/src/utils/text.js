const normalizeTopic = (topic) => topic.trim().toLowerCase().replace(/\s+/g, " ");

const countWords = (text) =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

const trimTextToWords = (text, maxWords) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return words.slice(0, maxWords).join(" ");
};

const trimSectionsToWordLimit = (sections, maxWords) => {
  const totalWords = sections.reduce((sum, section) => sum + countWords(section.script), 0);
  if (totalWords <= maxWords) {
    return sections;
  }
  const ratio = maxWords / totalWords;
  return sections.map((section) => {
    const targetWords = Math.max(10, Math.floor(countWords(section.script) * ratio));
    return {
      ...section,
      script: trimTextToWords(section.script, targetWords)
    };
  });
};

module.exports = {
  normalizeTopic,
  countWords,
  trimTextToWords,
  trimSectionsToWordLimit
};
