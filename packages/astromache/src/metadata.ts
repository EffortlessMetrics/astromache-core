import { parse, stringify } from "bcp-47";

export interface PublicationMetadata {
  title: string;
  description: string;
  canonical: URL;
  language: string;
}

export function publicationMetadata(input: PublicationMetadata): PublicationMetadata {
  if (!input.title.trim() || !input.description.trim() || !input.language.trim()) {
    throw new Error("Publication metadata requires a title, description and language");
  }
  const language = parse(input.language, { normalize: false });
  const variants = language.variants.map((variant) => variant.toLowerCase());
  const singletons = language.extensions.map((extension) => extension.singleton.toLowerCase());
  if (
    stringify(language).toLowerCase() !== input.language.toLowerCase() ||
    new Set(variants).size !== variants.length ||
    new Set(singletons).size !== singletons.length
  ) {
    throw new Error("Publication language must be a well-formed BCP 47 tag");
  }
  if (!["http:", "https:"].includes(input.canonical.protocol)) {
    throw new Error("Canonical publication URLs must use HTTP or HTTPS");
  }
  if (input.canonical.username || input.canonical.password || input.canonical.hash) {
    throw new Error("Canonical publication URLs cannot contain credentials or fragments");
  }
  return { ...input, canonical: new URL(input.canonical.href) };
}
