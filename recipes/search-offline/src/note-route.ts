// Match Astro's normalized route identity before constructing its public URL.
export const noteLink = (id: string) => {
  const segments = id.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    // eslint-disable-next-line no-control-regex -- These characters change URL/path identity.
    /[\\\u0000-\u001f\u007f]/.test(id)
  ) {
    throw new Error(
      `Invalid note ID ${JSON.stringify(id)}: use nonempty path segments without dot segments, backslashes or control characters.`,
    );
  }
  // Astro retains escaped ?/# in output names, then decodes its route lookup.
  // An additional decoded escape can select another entry or miss the route.
  const artifact = id.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23");
  let lookup: string;
  try {
    lookup = decodeURI(artifact);
  } catch {
    throw new Error(
      `Unsupported note ID ${JSON.stringify(id)}: invalid percent encoding in Astro's route lookup.`,
    );
  }
  if (lookup !== artifact) {
    throw new Error(
      `Unsupported note ID ${JSON.stringify(id)}: percent encoding changes Astro's route identity. Use the Unicode or reserved characters directly.`,
    );
  }
  return (
    "/notes/" +
    artifact
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/") +
    "/"
  );
};
