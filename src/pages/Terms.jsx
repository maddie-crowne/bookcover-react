import { useNavigate } from "react-router-dom";

const COLORS = {
  canvas: "#F9EAEA",
  ink: "#122630",
  frame: "#1A4B5D",
  spark: "#E67E7E",
  status: "#F2C94C",
  white: "#FFFFFF",
  border: "rgba(18, 38, 48, 0.12)",
  mutedInk: "rgba(18, 38, 48, 0.72)",
};

const FONTS = {
  headings: '"Merriweather", serif',
  ui: '"Inter", sans-serif',
};

export default function Terms({ darkMode, setDarkMode }) {
  const navigate = useNavigate();

  const THEME = darkMode ? {
    canvas: "#1a1a2e",
    ink: "#e8e8f0",
    mutedInk: "rgba(232,232,240,0.65)",
    white: "#16213e",
    border: "rgba(232,232,240,0.12)",
  } : {
    canvas: COLORS.canvas,
    ink: COLORS.ink,
    mutedInk: COLORS.mutedInk,
    white: COLORS.white,
    border: COLORS.border,
  };

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{
        fontFamily: FONTS.headings,
        fontSize: 18,
        fontWeight: 700,
        color: THEME.ink,
        margin: "0 0 12px",
        paddingBottom: 10,
        borderBottom: `1px solid ${THEME.border}`,
      }}>
        {title}
      </h2>
      <p style={{
        fontFamily: FONTS.ui,
        fontSize: 15,
        lineHeight: 1.8,
        color: THEME.mutedInk,
        margin: 0,
      }}>
        {children}
      </p>
    </div>
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: THEME.canvas,
      color: THEME.ink,
      fontFamily: FONTS.ui,
      padding: "48px 24px 80px",
    }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: COLORS.frame,
            fontFamily: FONTS.ui,
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 40,
            padding: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <h1 style={{
            fontFamily: FONTS.headings,
            fontSize: 42,
            fontWeight: 700,
            color: THEME.ink,
            margin: "0 0 12px",
            letterSpacing: -1,
            lineHeight: 1.1,
          }}>
            Terms of Use
          </h1>
          <p style={{
            fontFamily: FONTS.ui,
            fontSize: 14,
            color: THEME.mutedInk,
            margin: 0,
          }}>
            Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        <Section title="1. About Bookcover">
          Bookcover is a personal library utility that allows authenticated users to lookup, upload, store, and read e-books and audiobooks; as well as
          generating the audio. It is not a distribution platform, or a public-facing service.
        </Section>

        <Section title="2. User-Uploaded Content and User Liability">
          Bookcover does not curate, verify, or take responsibility for the origin, licensing status,
          or provenance of any files manually uploaded by users. Bookcover is not responsible for the origin of
          manually uploaded e-books or audiobooks. Responsibility for compliance with applicable copyright
          law rests solely with the user. Bookcover and its developers shall not be liable for any damages arising from your
          use of the platform, including any claims related to the content you choose to upload or access.
        </Section>

        <Section title="3. Personal Use Only">
          Bookcover is intended exclusively for personal, non-commercial use. 
        </Section>

        <Section title="4. Third-Party Sources">
          Bookcover facilitates access to publicly available open-source content from third-party sources such as
          Project Gutenberg and LibriVox. Such content is provided under their respective licences.
          Bookcover makes no representations about the accuracy, completeness, or legality of content
          obtained from external sources.
        </Section>

        <Section title="5. Data Storage">
          Uploaded files are stored solely for the personal use of the authenticated user who uploaded
          them. Bookcover does not share, sell, or transmit your uploaded files to any third party.
          You may delete your content at any time from your bookshelf.
        </Section>

        <Section title="6. Changes to These Terms">
          These terms may be updated from time to time. Using Bookcover constitutes acceptance of the revised terms.
        </Section>

        {/* Footer note */}
        <div style={{
          marginTop: 48,
          padding: "20px 24px",
          background: darkMode ? "rgba(255,255,255,0.05)" : "rgba(26,75,93,0.06)",
          borderRadius: 16,
          border: `1px solid ${THEME.border}`,
        }}>
          <p style={{
            fontFamily: FONTS.ui,
            fontSize: 13,
            color: THEME.mutedInk,
            margin: 0,
            lineHeight: 1.7,
          }}>
            If you have questions about these terms, please contact the developers directly.
            Bookcover is an independent team project.
          </p>
        </div>

      </div>
    </div>
  );
}