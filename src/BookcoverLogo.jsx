export default function BookcoverLogo({ size = 150 }) {
    return (
      <svg
        width={size}
        height={size * 0.34}
        viewBox="0 0 540 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* organic waveform */}
        <path
          d="
            M20 95
            C 45 60, 70 60, 92 95
            C 118 135, 150 135, 170 95
            C 190 55, 225 55, 245 95
            C 265 135, 300 135, 320 95
            C 335 60, 355 60, 370 95
          "
          stroke="#1A4B5D"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
  
        {/* tighter oscillation cluster */}
        <path
          d="
            M370 95
            C 378 70, 392 70, 398 95
            C 392 120, 380 120, 374 95
            C 372 82, 384 82, 388 95
            C 384 108, 376 108, 374 95
          "
          stroke="#E67E7E"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
  
        {/* spine */}
        <path
          d="M405 50 L405 140"
          stroke="#1A4B5D"
          strokeWidth="6"
          strokeLinecap="round"
        />
  
        {/* front page (more flared, sketch-like) */}
        <path
          d="
            M408 52
            C 440 25, 485 20, 520 38
            L 505 142
            C 470 128, 435 128, 408 145
            Z
          "
          fill="#F9EAEA"
          stroke="#1A4B5D"
          strokeWidth="6"
          strokeLinejoin="round"
        />
  
        {/* inner curve */}
        <path
          d="
            M408 118
            C 440 102, 470 102, 500 115
          "
          stroke="#1A4B5D"
          strokeWidth="5"
          strokeLinecap="round"
        />
  
        {/* back page */}
        <path
          d="
            M522 45
            L535 145
            C 500 130, 465 130, 430 148
          "
          stroke="#1A4B5D"
          strokeWidth="5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  