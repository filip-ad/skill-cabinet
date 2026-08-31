export default function Logo({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="5.75"
        y="4"
        width="17"
        height="24"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.55"
      />
      <rect
        x="8"
        y="17.35"
        width="12.5"
        height="8.15"
        rx="1.35"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle className="knob" cx="14.25" cy="21.42" r="1.2" />
      <g className="pull">
        <rect
          x="8"
          y="6.6"
          width="12.5"
          height="8.15"
          rx="1.35"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <circle className="knob" cx="14.25" cy="10.68" r="1.2" />
        <g className="slip">
          <rect
            className="card"
            x="17.6"
            y="7.85"
            width="9"
            height="5.6"
            rx="0.9"
            stroke="currentColor"
            strokeWidth="1.05"
          />
          <circle
            cx="20"
            cy="10.65"
            r="0.95"
            stroke="currentColor"
            strokeWidth="0.9"
          />
        </g>
      </g>
    </svg>
  );
}
