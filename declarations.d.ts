/** mjml v4 ships no types and has no `@types` package. */
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
