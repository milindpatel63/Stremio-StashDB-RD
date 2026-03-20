/**
 * In-memory cache for StashDB metadata
 * Key: type:id (e.g., "scene:uuid", "performer:uuid", "studio:uuid")
 * Value: Metadata object with scene/performer/studio details
 */

class Cache {
  constructor() {
    this.data = new Map();
  }

  /**
   * Get a scene by ID
   */
  get(id) {
    return this.data.get(id);
  }

  /**
   * Set a scene
   */
  set(id, scene) {
    this.data.set(id, scene);
  }

  /**
   * Get all scenes
   */
  getAll() {
    return Array.from(this.data.values());
  }

  /**
   * Get all scene IDs
   */
  getAllIds() {
    return Array.from(this.data.keys());
  }

  /**
   * Check if scene exists
   */
  has(id) {
    return this.data.has(id);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.data.clear();
  }

  /**
   * Get cache size
   */
  size() {
    return this.data.size;
  }
}

// Export singleton instance
module.exports = new Cache();

