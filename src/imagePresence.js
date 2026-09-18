import cv from "@pkboom/opencv-nodejs";

export const opencv = cv;

function grayscale(image) {
  if (image.channels === 1) return image;
  if (image.channels === 4) return image.cvtColor(cv.COLOR_BGRA2GRAY);
  return image.bgrToGray();
}

function load(path) {
  const image = cv.imread(path);
  if (!image || image.empty || image.rows < 2 || image.cols < 2) {
    throw new Error(`Unreadable image: ${path}`);
  }
  return grayscale(image);
}

function scaled(template, scale) {
  const rows = Math.max(2, Math.round(template.rows * scale));
  const cols = Math.max(2, Math.round(template.cols * scale));
  return template.resize(rows, cols);
}

function boundedPair(template, search, options) {
  const maxWidth = options.maxSearchWidth ?? 512;
  const maxHeight = options.maxSearchHeight ?? 12_000;
  const factor = Math.min(1, maxWidth / search.cols, maxHeight / search.rows);
  if (factor === 1) return { template, search, factor };
  return {
    template: template.resize(Math.max(2, Math.round(template.rows * factor)), Math.max(2, Math.round(template.cols * factor))),
    search: search.resize(Math.max(2, Math.round(search.rows * factor)), Math.max(2, Math.round(search.cols * factor))),
    factor,
  };
}

function scoreAtScale(template, search, scale) {
  const candidate = scaled(template, scale);
  if (candidate.rows > search.rows || candidate.cols > search.cols) return null;
  const result = search.matchTemplate(candidate, cv.TM_CCOEFF_NORMED);
  const extrema = result.minMaxLoc();
  if (!Number.isFinite(extrema.maxVal)) return null;
  return {
    score: extrema.maxVal,
    location: { x: extrema.maxLoc.x, y: extrema.maxLoc.y },
    scale,
    size: { width: candidate.cols, height: candidate.rows },
  };
}

function bestOf(template, search, scales) {
  let best = null;
  for (const scale of scales) {
    const result = scoreAtScale(template, search, scale);
    if (result && (!best || result.score > best.score)) best = result;
  }
  return best;
}

export function imageContainment(templatePath, searchPath, options = {}) {
  const coarseScales = options.coarseScales ?? [0.75, 0.85, 0.95, 1, 1.05, 1.15, 1.25];
  try {
    const originalTemplate = load(templatePath);
    const originalSearch = load(searchPath);
    const bounded = boundedPair(originalTemplate, originalSearch, options);
    const { template, search, factor } = bounded;
    if (template.rows > search.rows * 1.5 || template.cols > search.cols * 1.5) {
      return { established: false, reason: "template_is_larger_than_search" };
    }
    const extrema = template.minMaxLoc();
    if (extrema.maxVal - extrema.minVal < 2) {
      return { established: false, reason: "template_has_no_visual_detail" };
    }
    const coarse = bestOf(template, search, coarseScales);
    if (!coarse) return { established: false, reason: "no_compatible_scale" };
    const fineScales = Array.from({ length: 13 }, (_, index) => coarse.scale * (0.92 + index * (0.16 / 12)));
    const fine = bestOf(template, search, fineScales) ?? coarse;
    return {
      established: true,
      ...fine,
      location: { x: fine.location.x / factor, y: fine.location.y / factor },
      size: { width: fine.size.width / factor, height: fine.size.height / factor },
      analysisScale: factor,
    };
  } catch (error) {
    return {
      established: false,
      reason: "image_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function imagePresence(templatePath, searchPath, options = {}) {
  const threshold = options.threshold ?? 0.88;
  const result = imageContainment(templatePath, searchPath, options);
  if (!result.established) return { status: "unestablished", threshold, ...result };
  return {
    status: result.score >= threshold ? "present" : "absent",
    threshold,
    ...result,
  };
}
