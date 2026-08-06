/**
 * Baked in by tsup's `define` at build time — see tsup.config.ts.
 *
 * Not read from package.json at runtime: the bundle is a single file that gets
 * linked and copied around, and resolving a package.json relative to it would
 * find whatever happens to sit beside it, or nothing at all.
 */
declare const __AIRSHIP_VERSION__: string;

export const VERSION: string = __AIRSHIP_VERSION__;
