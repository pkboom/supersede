export const EXACT_ADDRESS = "123 Example Street, Springfield, IL 62704";
export const SPLIT_ADDRESS = ["123 Example Street", "Springfield, IL 62704"];
export const NEW_ADDRESS = "1030 Delta Boulevard, Atlanta, GA 30354";
export const BUTTON_LABEL = "TRACK YOUR ORDER";
export const BUTTON_COLOUR = "#E51937";
export const NEW_BUTTON_COLOUR = "#00529B";

function shell(heading, { body = "", footer }) {
  return `<!DOCTYPE html>
<html>
  <body>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0">
      <tr>
        <td class="wrap">
          <h1>${heading}</h1>
          <p>Your order is on its way.</p>
${body}
        </td>
      </tr>
      <tr>
        <td id="Footer" class="darkmode">${footer}</td>
      </tr>
    </table>
  </body>
</html>
`;
}

function plainEmail(heading) {
  return shell(heading, { footer: "Unsubscribe at any time." });
}

function exactAddressEmail(heading) {
  return shell(heading, { footer: EXACT_ADDRESS });
}

function splitAddressEmail(heading) {
  return shell(heading, { footer: `${SPLIT_ADDRESS[0]}<br>${SPLIT_ADDRESS[1]}` });
}

function buttonEmail(heading) {
  return shell(heading, {
    body: `          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td class="innertd buttonblock" bgcolor="${BUTTON_COLOUR}">
                <a class="buttonstyles" href="https://example.com/track">${BUTTON_LABEL}</a>
              </td>
            </tr>
          </table>`,
    footer: "Unsubscribe at any time.",
  });
}

export const GROUPS = {
  "exact text": {
    instruction: `find the postal address "${EXACT_ADDRESS}" in the footer and replace it with "${NEW_ADDRESS}"`,
    find: `the postal address "${EXACT_ADDRESS}" in the footer`,
    replacement: NEW_ADDRESS,
    splitFindCarries: EXACT_ADDRESS,
    splitReplacementCarries: NEW_ADDRESS,
    present: exactAddressEmail,
    absent: plainEmail,
    elementCarries: [EXACT_ADDRESS],
    spanCarries: EXACT_ADDRESS,
  },
  "similar text": {
    instruction: `find the postal address "${SPLIT_ADDRESS.join(" ")}" in the footer and replace it with "${NEW_ADDRESS}"`,
    find: `the postal address "${SPLIT_ADDRESS.join(" ")}" in the footer`,
    replacement: NEW_ADDRESS,
    splitFindCarries: SPLIT_ADDRESS[0],
    splitReplacementCarries: NEW_ADDRESS,
    present: splitAddressEmail,
    absent: plainEmail,
    elementCarries: SPLIT_ADDRESS,
    spanCarries: SPLIT_ADDRESS.join(" "),
  },
  button: {
    instruction: `find the "${BUTTON_LABEL}" button and replace its background colour with ${NEW_BUTTON_COLOUR}`,
    find: `the background colour of the "${BUTTON_LABEL}" button`,
    replacement: NEW_BUTTON_COLOUR,
    splitFindCarries: BUTTON_LABEL,
    splitReplacementCarries: NEW_BUTTON_COLOUR,
    present: buttonEmail,
    absent: plainEmail,
    elementCarries: [BUTTON_LABEL, BUTTON_COLOUR],
    spanCarries: BUTTON_COLOUR,
  },
  "button background by instruction": {
    instruction: `find the "${BUTTON_LABEL}" button and update its background to sky blue`,
    find: `button: ${BUTTON_LABEL}`,
    replacement: "update the background to sky blue",
    splitFindCarries: BUTTON_LABEL,
    splitReplacementCarries: "sky blue",
    present: buttonEmail,
    absent: plainEmail,
    elementCarries: [BUTTON_LABEL, BUTTON_COLOUR],
    spanCarries: BUTTON_COLOUR,
    propertyChange: true,
    survives: BUTTON_LABEL,
    retires: BUTTON_COLOUR,
  },
};

export const SHAPES = [
  { name: "1 file, found in first file", present: [true] },
  { name: "1 file, not found in first file", present: [false] },
  { name: "2 files, found in first file and second file", present: [true, true] },
  { name: "2 files, found in first file, not found in second file", present: [true, false] },
  { name: "2 files, not found in first file, found in second file", present: [false, true] },
  {
    name: "3 files, found in first file, not found in second file, and found in third file",
    present: [true, false, true],
  },
  {
    name: "3 files, found in first file, found in second file, and not found in third file",
    present: [true, true, false],
  },
];

export function fileName(index) {
  return `${String(index + 1).padStart(2, "0")}-mail.html`;
}

export function buildEmails(group, present) {
  return present.map((carries, index) => ({
    id: fileName(index),
    source: (carries ? group.present : group.absent)(`Email ${index + 1}`),
  }));
}
