export interface Link {
  label: string;
  href: string;
}

export interface RelatedLink extends Link {
  displayDate?: { datetime: string; label: string };
}
