/**
 * DeviceToggle — top-left desktop/mobile toggle.
 *
 * Two buttons: "Desktop" (600px) and "Mobile" (320px). The actual viewport
 * width clamp lives in the iframe wrapper (Lane F's Canvas.tsx wires the
 * mode → CSS width); this component only owns the segmented-control UI.
 */
interface DeviceToggleProps {
  value: "desktop" | "mobile";
  onChange: (mode: "desktop" | "mobile") => void;
}

export default function DeviceToggle({ value, onChange }: DeviceToggleProps) {
  return (
    <div className="device-toggle" role="group" aria-label="Viewport mode">
      <button
        type="button"
        className={`device-toggle-btn ${value === "desktop" ? "active" : ""}`}
        aria-pressed={value === "desktop"}
        onClick={() => onChange("desktop")}
      >
        Desktop
      </button>
      <button
        type="button"
        className={`device-toggle-btn ${value === "mobile" ? "active" : ""}`}
        aria-pressed={value === "mobile"}
        onClick={() => onChange("mobile")}
      >
        Mobile
      </button>
    </div>
  );
}
