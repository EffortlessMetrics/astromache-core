import { profileProps, type ProfileLink } from "./profile.js";

export interface DirectoryProps {
  title: string;
}

export interface SectionProps {
  id: string;
  title: string;
}

export interface DirectoryLink extends ProfileLink {
  description?: string;
  /** Decorative, locally served icon. The visible label is the accessible name. */
  iconSrc?: string;
  /** Show a decorative external-link arrow without changing navigation behavior. */
  external?: boolean;
}

export interface LinkGroupProps extends SectionProps {
  links: ReadonlyArray<DirectoryLink>;
  layout?: "inline" | "stack";
  /** Omit the visible heading while retaining a programmatically named region. */
  showHeading?: boolean;
}

export function directoryTitle(title: string): string {
  return profileProps({ title }).title;
}

export function sectionProps(input: SectionProps): SectionProps {
  if (typeof input.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input.id)) {
    throw new TypeError("Directory section id must be a nonempty HTML identifier");
  }
  // The visible heading derives its ID from the section ID. Reserve that suffix
  // so one valid directory section can never duplicate another section heading.
  if (input.id.endsWith("-title")) {
    throw new TypeError("Directory section id must not end in the reserved -title suffix");
  }
  return { id: input.id, title: directoryTitle(input.title) };
}

export function linkGroupProps(input: LinkGroupProps) {
  const { id, title } = sectionProps(input);
  const showHeading = input.showHeading === undefined ? true : input.showHeading;
  if (typeof showHeading !== "boolean") {
    throw new TypeError("Directory link group showHeading must be a boolean");
  }
  const layout = input.layout ?? "inline";
  if (layout !== "inline" && layout !== "stack") {
    throw new TypeError("Directory link group layout must be inline or stack");
  }
  if (!Array.isArray(input.links) || !input.links.length) {
    throw new TypeError("Directory link group requires at least one link");
  }
  const links = profileProps({ title, links: input.links }).links.map((link, index) => {
    const { description, iconSrc, external } = input.links[index];
    if (description !== undefined && (typeof description !== "string" || !description.trim())) {
      throw new TypeError("Directory link description must contain non-whitespace text");
    }
    if (
      iconSrc !== undefined &&
      (typeof iconSrc !== "string" || !/^\/(?!\/)[a-zA-Z0-9._~%/-]+$/.test(iconSrc))
    ) {
      throw new TypeError("Directory icon must be a root-relative local asset path");
    }
    if (external !== undefined && typeof external !== "boolean") {
      throw new TypeError("Directory external indicator must be a boolean");
    }
    return { ...link, description, iconSrc, external };
  });
  return { id, title, layout, links, showHeading };
}
