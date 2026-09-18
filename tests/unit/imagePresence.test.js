import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageContainment, imagePresence, opencv as cv } from "../../src/imagePresence.js";

let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "image-presence-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const search = new cv.Mat(180, 220, cv.CV_8UC3, [255, 255, 255]);
  search.drawRectangle(new cv.Point2(60, 70), new cv.Point2(159, 109), new cv.Vec3(20, 20, 20), -1);
  search.putText("CTA", new cv.Point2(88, 98), cv.FONT_HERSHEY_SIMPLEX, 0.7, new cv.Vec3(255, 255, 255), 2);
  const template = new cv.Mat(50, 110, cv.CV_8UC3, [255, 255, 255]);
  template.drawRectangle(new cv.Point2(5, 5), new cv.Point2(104, 44), new cv.Vec3(20, 20, 20), -1);
  template.putText("CTA", new cv.Point2(33, 33), cv.FONT_HERSHEY_SIMPLEX, 0.7, new cv.Vec3(255, 255, 255), 2);
  const searchPath = join(directory, "search.png");
  const templatePath = join(directory, "template.png");
  cv.imwrite(searchPath, search);
  cv.imwrite(templatePath, template);
  return { searchPath, templatePath };
}

describe("OpenCV image containment", () => {
  it("finds a cropped target inside a larger email capture with coordinates", () => {
    const { searchPath, templatePath } = fixture();
    const result = imageContainment(templatePath, searchPath);

    expect(result.established).toBe(true);
    expect(result.score).toBeGreaterThan(0.98);
    expect(result.location.x).toBeCloseTo(55, -1);
    expect(result.location.y).toBeCloseTo(65, -1);
  });

  it("returns tri-state evidence instead of treating unreadable input as absence", () => {
    const { searchPath } = fixture();

    expect(imagePresence(join(directory, "missing.png"), searchPath).status).toBe("unestablished");
  });

  it("reports an established absence for a distinct unrelated target", () => {
    const { searchPath } = fixture();
    const unrelated = new cv.Mat(45, 80, cv.CV_8UC3, [255, 255, 255]);
    unrelated.drawCircle(new cv.Point2(40, 22), 15, new cv.Vec3(0, 0, 255), -1);
    const unrelatedPath = join(directory, "unrelated.png");
    cv.imwrite(unrelatedPath, unrelated);

    const result = imagePresence(unrelatedPath, searchPath, { threshold: 0.9 });
    expect(result.established).toBe(true);
    expect(result.status).toBe("absent");
  });
});
