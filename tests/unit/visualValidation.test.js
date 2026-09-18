import { describe, expect, it } from "vitest";
import { validateCaptureWithLuna } from "../../src/visualValidation.js";

describe("visual verdict validation", () => {
  it("fails closed when Luna returns an unknown status", async () => {
    await expect(validateCaptureWithLuna({
      file: "mail.html",
      instruction: "Change address",
      beforeImage: "before.png",
      afterImage: "after.png",
      edits: [],
      runLuna: async () => ({ status: "looks_good", summary: "maybe", concerns: [] }),
    })).rejects.toThrow(/invalid visual verdict/i);
  });
});
