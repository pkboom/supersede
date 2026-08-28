/**
 * Web-side barrel: re-exports the canonical parser/serializer/types/registry
 * from src/shared/blocks/. Strategy A — single source of truth, web imports
 * via the alias configured in web/vite.config.ts and web/tsconfig.json.
 */
export * from "@shared/blocks/index.js";
