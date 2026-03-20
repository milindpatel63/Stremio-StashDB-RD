/**
 * Normalize titles for searching
 * Removes/replaces special characters with spaces and cleans up whitespace
 */
function normalizeTitleForSearch(title) {
  if (!title) return '';
  
  return String(title)
    // Replace special characters with spaces
    .replace(/[^\w\s-]/g, ' ')
    // Normalize whitespace (multiple spaces to single)
    .replace(/\s+/g, ' ')
    // Trim leading/trailing whitespace
    .trim();
}

module.exports = { normalizeTitleForSearch };
