/**
 * Each screen arrives with a short fade (opacity only, so fixed full-screen views keep their
 * layout). Reduced motion turns it off with every other animation.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-[fade-in_180ms_ease-out]">{children}</div>;
}
