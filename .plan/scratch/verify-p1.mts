import { parseMjml, serializeMjml } from "../../src/shared/blocks/index.js";
let s = `<mjml><mj-body><mj-section><mj-column><mj-button href="https://x.test/?a=1&amp;b=2">Buy &amp; save</mj-button></mj-column></mj-section></mj-body></mjml>`;
for (let i = 1; i <= 4; i++) { s = serializeMjml(parseMjml(s)); console.log(`cycle ${i}:`, s.match(/<mj-button[^\n]*/)![0]); }
console.log("idempotent?", serializeMjml(parseMjml(s)) === s);
