/**
 * `mjml` ships no type declarations and `@types/mjml` does not exist for v4.
 * Declared here rather than suppressed at each call site, so the compile
 * result is at least shaped rather than `any` at every import.
 */
declare module "mjml" {
  interface MjmlError {
    line?: number;
    message?: string;
    formattedMessage?: string;
    tagName?: string;
  }
  interface MjmlResult {
    html: string;
    errors?: MjmlError[];
  }
  interface MjmlOptions {
    validationLevel?: "strict" | "soft" | "skip";
    filePath?: string;
    keepComments?: boolean;
  }
  export default function mjml2html(mjml: string, options?: MjmlOptions): MjmlResult;
}
