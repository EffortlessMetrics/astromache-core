export function prefersMarkdown(accept?: string): boolean;
export function negotiateMarkdown(
  request: Request,
  fetchAsset: (request: Request) => Promise<Response>,
): Promise<Response>;
