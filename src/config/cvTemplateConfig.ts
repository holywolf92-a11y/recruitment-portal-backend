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
  version: 'v2.2.0',
  description: 'Compact professional design: smaller name, photo support, footer contact notice, 2-page capable',
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
 * v2.1.0 (2026-01-27): Professional PDF-optimized layout
 *   - A4 page sizing (210mm x 297mm)
 *   - Proper font sizes (8pt-20pt range)
 *   - PDF-friendly spacing (pt/mm units)
 *   - Removed emojis (better PDF rendering)
 *   - Removed large avatar (space optimization)
 *   - Page break controls
 *   - Print-optimized colors
 *   - Professional section titles
 *   - Clean, hireable appearance
 * 
 * v2.0.0 (2026-01-27): Colorful infographic redesign (Web-focused)
 *   - Gradient circular avatar with checkmark badge
 *   - Color-coded info badges
 *   - Emoji section icons
 *   - Large fonts (oversized for PDF)
 *   - [DEPRECATED - Not suitable for PDF output]
 * 
 * v1.0.0 (2026-01-XX): Initial simple template
 *   - Basic gradient header
 *   - Simple sections with left border
 *   - Plain text layout
 */
