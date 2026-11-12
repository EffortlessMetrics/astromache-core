export interface ProfileLink {
  label: string;
  href: string;
  /** Identity and relationship tokens are supplied by the consumer, never inferred. */
  rel?: string;
}

export interface ProfileProps {
  title: string;
  links?: ReadonlyArray<ProfileLink>;
  speakingLabel?: string;
  followLabel?: string;
}

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Profile ${field} must contain non-whitespace text`);
  }
  return value;
};

const href = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  ) {
    throw new TypeError("Profile link href must be a root-relative, fragment, HTTP or HTTPS URL");
  }
  if ((value.startsWith("/") && !value.startsWith("//")) || value.startsWith("#")) {
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Profile link href must be a root-relative, fragment, HTTP or HTTPS URL");
  }
  if (
    !/^https?:\/\//iu.test(value) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new TypeError("Profile link href must be a root-relative, fragment, HTTP or HTTPS URL");
  }
  return value;
};

/** Validate runtime-supplied props without rewriting authored text or link identity. */
export function profileProps(input: ProfileProps) {
  const title = text(input.title, "title");
  const speakingLabel = text(input.speakingLabel ?? "Speaking", "speakingLabel");
  const followLabel = text(input.followLabel ?? "Follow me", "followLabel");
  if (input.links !== undefined && !Array.isArray(input.links)) {
    throw new TypeError("Profile links must be an array");
  }
  const links = Array.from(input.links ?? [], (link) => {
    if (link === null || typeof link !== "object") {
      throw new TypeError("Profile links must contain label and href records");
    }
    const label = text(link.label, "link label");
    const url = href(link.href);
    if (link.rel !== undefined && typeof link.rel !== "string") {
      throw new TypeError("Profile link rel must be a string when supplied");
    }
    return { label, href: url, ...(link.rel === undefined ? {} : { rel: link.rel }) };
  });
  return { title, speakingLabel, followLabel, links };
}
