// @vitest-environment jsdom
/**
 * web.DeviceToggle.test — assert clicking the Mobile button fires onChange
 * with "mobile" and that aria-pressed reflects the current value.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import DeviceToggle from "../../web/src/canvas/DeviceToggle.js";

afterEach(() => {
  cleanup();
});

function ParentHarness({ onChange }: { onChange: (mode: "desktop" | "mobile") => void }) {
  const [value, setValue] = useState<"desktop" | "mobile">("desktop");
  return (
    <DeviceToggle
      value={value}
      onChange={(m) => {
        setValue(m);
        onChange(m);
      }}
    />
  );
}

describe("<DeviceToggle />", () => {
  it("clicking Mobile fires onChange('mobile') and updates aria-pressed", () => {
    const onChange = vi.fn();
    render(<ParentHarness onChange={onChange} />);

    const desktopBtn = screen.getByRole("button", { name: /desktop/i });
    const mobileBtn = screen.getByRole("button", { name: /mobile/i });

    expect(desktopBtn.getAttribute("aria-pressed")).toBe("true");
    expect(mobileBtn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(mobileBtn);

    expect(onChange).toHaveBeenCalledWith("mobile");
    expect(mobileBtn.getAttribute("aria-pressed")).toBe("true");
    expect(desktopBtn.getAttribute("aria-pressed")).toBe("false");
  });
});
