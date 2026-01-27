/**
 * CV Template Configuration
 * 
 * This module provides a centralized configuration for CV template versioning.
 * Incrementing the template version will invalidate all cached CVs and force
 * regeneration with the new template design.
 * 
 * Usage:
 * - Update TEMPLATE_VERSION when CV design changes
 * - Use semantic versioning (e.g., v2.1.0, v2.2.0)
 * - Include a brief description of changes
 */

export interface CVTemplateConfig {
  version: string;
  description: string;
  lastUpdated: string;
}

/**
 * Current CV Template Configuration
 * 
 * IMPORTANT: Increment this version whenever the CV HTML template or styling changes.
 * This ensures all users get the updated design without manual cache clearing.
 */
export const CV_TEMPLATE_CONFIG: CVTemplateConfig = {
  version: 'v2.1.0',
  description: 'Professional PDF-optimized design with proper sizing, clean layout, and A4 formatting',
  lastUpdated: '2026-01-27',
};

/**
 * Get the current template version string for cache key generation
 */
export function getTemplateVersion(): string {
  return CV_TEMPLATE_CONFIG.version;
}

/**
 * Get the full template version with metadata
 */
export function getTemplateConfig(): CVTemplateConfig {
  return CV_TEMPLATE_CONFIG;
}

/**
 * Version History (for reference)
 * 
 * v2.0.0 (2026-01-27): Colorful infographic redesign
 *   - Gradient circular avatar with checkmark badge
 *   - Blue/purple/green color-coded info badges
 *   - Yellow contact protection notice box
 *   - Stat cards for experience and AI score
 *   - Gradient skill badges
 *   - Emoji section icons
 *   - Gradient footer notice
 * 
 * v1.0.0 (2026-01-XX): Initial simple template
 *   - Basic gradient header
 *   - Simple sections with left border
 *   - Plain text layout
 */
