// mjml ships no types; we don't import it from the web bundle, but a stub
// keeps tsc --noEmit clean if any file accidentally references it.
declare module "mjml";
