/** Original code-drawn collector graphics. No product or card artwork is implied. */
export function BallMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`pp-ball-mark ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="28" fill="#fff9e9" />
      <path d="M4 32a28 28 0 0 1 56 0Z" fill="#df302d" />
      <circle
        cx="32"
        cy="32"
        r="28"
        fill="none"
        stroke="#202327"
        strokeWidth="5"
      />
      <path d="M5 32h54" stroke="#202327" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r="10"
        fill="#fff9e9"
        stroke="#202327"
        strokeWidth="5"
      />
      <circle cx="32" cy="32" r="3" fill="#202327" />
    </svg>
  );
}

export function CollectorGraphic({
  format = "pack",
}: {
  format?: "pack" | "box";
}) {
  return (
    <div className="pp-product-art" data-format={format} aria-hidden="true">
      <span className="pp-art-index">PP / FIELD RECORD</span>
      <div className="pp-pack-illustration">
        <span className="pp-pack-wordmark">POKÉPULSE</span>
        <BallMark />
        <span className="pp-pack-format">
          {format === "box" ? "SEALED BOX" : "BOOSTER FILE"}
        </span>
      </div>
      <span className="pp-art-caption">Original catalog graphic</span>
    </div>
  );
}

export function FieldKitGraphic() {
  return (
    <div className="pp-field-kit" aria-hidden="true">
      <span className="pp-kit-registration">TRAINER’S FIELD KIT / 001</span>
      <div className="pp-kit-card pp-kit-card-back">
        <span>THE NEXT FIND</span>
      </div>
      <div className="pp-kit-card pp-kit-card-front">
        <div className="pp-kit-lights">
          <i />
          <i />
          <i />
          <span>COLLECTOR’S EDITION</span>
        </div>
        <div className="pp-kit-screen">
          <span>POKÉMON TCG</span>
          <BallMark />
          <strong>
            STAY ON
            <br />
            THE HUNT.
          </strong>
        </div>
        <div className="pp-kit-controls">
          <span className="pp-kit-cross" />
          <span className="pp-kit-button" />
          <span className="pp-kit-button" />
        </div>
        <span className="pp-kit-bottom">SCOUT. TRACK. COLLECT.</span>
      </div>
      <span className="pp-kit-stamp">
        FOR THE
        <br />
        <strong>COLLECTORS.</strong>
      </span>
    </div>
  );
}
