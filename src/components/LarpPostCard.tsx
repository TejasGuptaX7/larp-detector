import type { LarpPost } from "../lib/larpPosts";

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return <span className="post-avatar">{initials}</span>;
}

function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="post-net" aria-hidden>
      <path
        fill="currentColor"
        d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"
      />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="post-net" aria-hidden>
      <path
        fill="currentColor"
        d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z"
      />
    </svg>
  );
}

export function LarpPostCard({ post }: { post: LarpPost }) {
  return (
    <article className={`post post--${post.kind}`}>
      <header className="post-head">
        <Avatar name={post.name} />
        <div className="post-id">
          <span className="post-name">{post.name}</span>
          <span className="post-handle">{post.handle}</span>
        </div>
        {post.kind === "linkedin" ? <LinkedInGlyph /> : <XGlyph />}
      </header>
      <p className="post-body">{post.body}</p>
      <footer className="post-foot">{post.reactions}</footer>
      <span className="post-stamp" aria-hidden>
        LARP {post.score}%
      </span>
    </article>
  );
}
